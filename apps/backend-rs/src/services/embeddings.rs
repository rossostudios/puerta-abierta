use std::time::Duration;

use reqwest::Client;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::config::AppConfig;

const CHUNK_MAX_CHARS: usize = 1500;
const CHUNK_OVERLAP_CHARS: usize = 200;

/// Generate embeddings via OpenAI text-embedding-3-small and return the vector.
pub async fn embed_text(
    http_client: &Client,
    config: &AppConfig,
    text: &str,
) -> Result<Vec<f32>, String> {
    let api_key = config
        .openai_api_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "OpenAI API key not configured".to_string())?;

    let base_url = config.openai_api_base_url.trim_end_matches('/');
    let url = format!("{base_url}/v1/embeddings");

    let payload = json!({
        "model": "text-embedding-3-small",
        "input": text.chars().take(8000).collect::<String>(),
    });

    let response = http_client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&payload)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Embedding request failed: {e}"))?;

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse embedding response: {e}"))?;

    if !status.is_success() {
        let err_msg = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown error");
        return Err(format!("Embedding API error ({status}): {err_msg}"));
    }

    let embedding = body
        .get("data")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("embedding"))
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing embedding in response".to_string())?;

    let vector: Vec<f32> = embedding
        .iter()
        .filter_map(|v| v.as_f64().map(|f| f as f32))
        .collect();

    if vector.len() != 1536 {
        return Err(format!(
            "Expected 1536 dimensions, got {}",
            vector.len()
        ));
    }

    Ok(vector)
}

/// Split a document's text content into overlapping chunks suitable for embedding.
pub fn chunk_text(text: &str) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    if text.len() <= CHUNK_MAX_CHARS {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut start = 0;

    while start < chars.len() {
        let end = (start + CHUNK_MAX_CHARS).min(chars.len());
        let slice: String = chars[start..end].iter().collect();

        // Try to break at a sentence or paragraph boundary
        let chunk = if end < chars.len() {
            if let Some(break_pos) = find_break_point(&slice) {
                let trimmed: String = chars[start..start + break_pos + 1].iter().collect();
                trimmed
            } else {
                slice
            }
        } else {
            slice
        };

        let chunk_len = chunk.chars().count();
        chunks.push(chunk.trim().to_string());

        let advance = if chunk_len > CHUNK_OVERLAP_CHARS {
            chunk_len - CHUNK_OVERLAP_CHARS
        } else {
            chunk_len
        };
        start += advance;
    }

    chunks.retain(|c| !c.is_empty());
    chunks
}

/// Find the best break point (paragraph, sentence, or word boundary) in a text slice.
fn find_break_point(text: &str) -> Option<usize> {
    // Prefer paragraph break
    if let Some(pos) = text.rfind("\n\n") {
        if pos > text.len() / 3 {
            return Some(pos + 1);
        }
    }
    // Then sentence break
    for delim in [". ", ".\n", "? ", "!\n", "! ", "?\n"] {
        if let Some(pos) = text.rfind(delim) {
            if pos > text.len() / 3 {
                return Some(pos + delim.len() - 1);
            }
        }
    }
    // Then newline
    if let Some(pos) = text.rfind('\n') {
        if pos > text.len() / 3 {
            return Some(pos);
        }
    }
    None
}

/// Process a knowledge document: split content into chunks, embed each, and upsert into DB.
pub async fn process_and_embed_document(
    pool: &PgPool,
    http_client: &Client,
    config: &AppConfig,
    org_id: &str,
    document_id: &str,
    content: &str,
    title: &str,
) -> Result<usize, String> {
    let chunks = chunk_text(content);
    if chunks.is_empty() {
        return Err("Document has no content to process".to_string());
    }

    // Delete existing chunks for this document before re-processing
    sqlx::query("DELETE FROM knowledge_chunks WHERE document_id = $1::uuid")
        .bind(document_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to clear existing chunks: {e}"))?;

    let mut embedded_count = 0;

    for (index, chunk_text) in chunks.iter().enumerate() {
        // Prefix chunk with title for better embedding context
        let embed_input = if !title.is_empty() {
            format!("{title}\n\n{chunk_text}")
        } else {
            chunk_text.clone()
        };

        let embedding = embed_text(http_client, config, &embed_input).await?;
        let embedding_str = format!(
            "[{}]",
            embedding
                .iter()
                .map(|v| v.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );

        sqlx::query(
            "INSERT INTO knowledge_chunks (organization_id, document_id, chunk_index, content, embedding)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5::vector)
             ON CONFLICT (document_id, chunk_index) DO UPDATE
             SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, updated_at = now()",
        )
        .bind(org_id)
        .bind(document_id)
        .bind(index as i32)
        .bind(chunk_text)
        .bind(&embedding_str)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to insert chunk {index}: {e}"))?;

        embedded_count += 1;
    }

    Ok(embedded_count)
}

/// Embed a single query string for similarity search.
pub async fn embed_query(
    http_client: &Client,
    config: &AppConfig,
    query: &str,
) -> Result<String, String> {
    let vector = embed_text(http_client, config, query).await?;
    Ok(format!(
        "[{}]",
        vector
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    ))
}
