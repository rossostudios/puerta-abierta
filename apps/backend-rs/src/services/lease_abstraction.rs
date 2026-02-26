use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database is not configured.".to_string()))
}

/// Extract key terms from a lease document using LLM structured extraction.
pub async fn tool_abstract_lease_document(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let document_id = args
        .get("document_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let lease_id = args.get("lease_id").and_then(Value::as_str);

    if document_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "document_id is required." }));
    }

    // Fetch document content from knowledge_chunks
    let chunks = sqlx::query(
        "SELECT content FROM knowledge_chunks
         WHERE document_id = $1::uuid AND organization_id = $2::uuid
         ORDER BY chunk_index ASC",
    )
    .bind(document_id)
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch document chunks");
        AppError::Dependency("Failed to fetch document chunks.".to_string())
    })?;

    if chunks.is_empty() {
        return Ok(json!({
            "ok": false,
            "error": "No content found for this document. Ensure it has been processed and embedded.",
        }));
    }

    let full_text: String = chunks
        .iter()
        .filter_map(|r| r.try_get::<String, _>("content").ok())
        .collect::<Vec<_>>()
        .join("\n\n");

    // Use LLM to extract structured terms
    let api_key = state
        .config
        .openai_api_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::ServiceUnavailable(
                "OPENAI_API_KEY is required for lease abstraction.".to_string(),
            )
        })?;

    let base_url = state.config.openai_api_base_url.trim_end_matches('/');
    let chat_url = format!("{base_url}/v1/chat/completions");

    let extraction_prompt = format!(
        "Extract ALL key terms from this lease/rental agreement (Paraguay context). Return a JSON object with these fields:\n\
         **Parties & Identification:**\n\
         - parties: array of {{name, role, ruc, cedula, address}} (landlord, tenant, guarantor/fiador)\n\
         - landlord_ruc: string or null (RUC tax ID)\n\
         - tenant_cedula: string or null\n\
         - guarantor: {{name, cedula, address, relationship}} or null\n\
         **Property:**\n\
         - property_address: string\n\
         - property_type: string (apartment, house, commercial, etc.)\n\
         - property_size_m2: number or null\n\
         - furnished: boolean\n\
         - parking_included: boolean\n\
         **Dates & Duration:**\n\
         - lease_start: string (YYYY-MM-DD)\n\
         - lease_end: string (YYYY-MM-DD)\n\
         - duration_months: number\n\
         - renewal_type: 'automatic' | 'manual' | 'none'\n\
         - renewal_terms: string or null\n\
         - notice_period_days: number or null\n\
         **Financial:**\n\
         - monthly_rent: number\n\
         - currency: string (PYG, USD, etc.)\n\
         - security_deposit: number\n\
         - deposit_months: number\n\
         - payment_due_day: number\n\
         - late_fee: number or null\n\
         - late_fee_type: 'fixed' | 'percentage' | null\n\
         - iva_included: boolean\n\
         - iva_percentage: number or null\n\
         - rent_increase_clause: string or null\n\
         - rent_increase_percentage: number or null\n\
         - utilities_included: array of strings\n\
         - common_expenses: number or null\n\
         **Clauses:**\n\
         - clauses: array of {{type, title, text, importance}} where type is one of: termination, renewal, maintenance, subletting, pets, modifications, insurance, dispute_resolution, force_majeure, governing_law\n\
         - termination_clause: string or null\n\
         - subletting_allowed: boolean\n\
         - pets_allowed: boolean\n\
         - modification_rules: string or null\n\
         **Obligations:**\n\
         - obligations_landlord: array of strings\n\
         - obligations_tenant: array of strings\n\
         **Deadlines:**\n\
         - deadlines: array of {{type, date, description}} covering all dates found (expiry, renewal notice, insurance, inspections, etc.)\n\
         **Confidence:**\n\
         - confidence_scores: object mapping each field name to a confidence 0.0-1.0\n\n\
         Document text:\n{}", &full_text[..full_text.len().min(12000)]
    );

    let response = state
        .http_client
        .post(&chat_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&json!({
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": "You are a legal document analyst specializing in lease agreements. Extract structured data accurately."},
                {"role": "user", "content": extraction_prompt}
            ],
            "temperature": 0.1,
            "response_format": { "type": "json_object" },
        }))
        .timeout(std::time::Duration::from_secs(45))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Lease extraction API failed");
            AppError::Dependency("Lease extraction API failed.".to_string())
        })?;

    let body: Value = response.json().await.map_err(|e| {
        tracing::error!(error = %e, "Failed to parse extraction response");
        AppError::Dependency("Failed to parse extraction response.".to_string())
    })?;

    let extracted_text = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(Value::as_object)
        .and_then(|c| c.get("message"))
        .and_then(Value::as_object)
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("{}");

    let extracted: Value =
        serde_json::from_str(extracted_text).unwrap_or_else(|_| json!({"error": "parse_failed"}));

    // Derive clauses, deadlines, confidence_scores from extracted data
    let clauses = extracted
        .get("clauses")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let deadlines = extracted
        .get("deadlines")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let confidence_scores = extracted
        .get("confidence_scores")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let field_count = extracted.as_object().map(|o| o.len() as i32).unwrap_or(0);

    // Compute average confidence
    let avg_confidence = confidence_scores
        .as_object()
        .map(|m| {
            if m.is_empty() {
                0.85
            } else {
                let sum: f64 = m.values().filter_map(Value::as_f64).sum();
                sum / m.len() as f64
            }
        })
        .unwrap_or(0.85);

    // Store abstraction
    let abstraction = sqlx::query(
        "INSERT INTO lease_abstractions (
            organization_id, document_id, lease_id,
            extracted_terms, confidence, reviewed,
            clauses, deadlines, compliance_flags, confidence_scores,
            field_count, extraction_model
         ) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, false,
                   $6::jsonb, $7::jsonb, '[]'::jsonb, $8::jsonb, $9, 'gpt-4o-mini')
         RETURNING id::text",
    )
    .bind(org_id)
    .bind(document_id)
    .bind(lease_id)
    .bind(&extracted)
    .bind(avg_confidence)
    .bind(&clauses)
    .bind(&deadlines)
    .bind(&confidence_scores)
    .bind(field_count)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let abstraction_id = abstraction
        .and_then(|r| r.try_get::<String, _>("id").ok())
        .unwrap_or_default();

    // Auto-create deadline_alerts from extracted deadlines
    if let Some(dl_arr) = deadlines.as_array() {
        for dl in dl_arr {
            let dl_type = dl.get("type").and_then(Value::as_str).unwrap_or("custom");
            let dl_date = dl.get("date").and_then(Value::as_str).unwrap_or_default();
            let dl_desc = dl
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if dl_date.is_empty() {
                continue;
            }
            let _ = sqlx::query(
                "INSERT INTO deadline_alerts
                    (organization_id, lease_id, abstraction_id, deadline_type, deadline_date, description)
                 VALUES ($1::uuid, $2, $3::uuid, $4, $5::date, $6)
                 ON CONFLICT DO NOTHING",
            )
            .bind(org_id)
            .bind(lease_id)
            .bind(&abstraction_id)
            .bind(dl_type)
            .bind(dl_date)
            .bind(dl_desc)
            .execute(pool)
            .await;
        }
    }

    Ok(json!({
        "ok": true,
        "abstraction_id": abstraction_id,
        "document_id": document_id,
        "lease_id": lease_id,
        "extracted_terms": extracted,
        "clauses_count": clauses.as_array().map(|a| a.len()).unwrap_or(0),
        "deadlines_count": deadlines.as_array().map(|a| a.len()).unwrap_or(0),
        "field_count": field_count,
        "avg_confidence": avg_confidence,
        "reviewed": false,
    }))
}

/// Check a lease for compliance issues using compliance_rules table.
pub async fn tool_check_lease_compliance(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let lease_id = args
        .get("lease_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if lease_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "lease_id is required." }));
    }

    // Fetch lease data
    let lease = sqlx::query(
        "SELECT id::text, tenant_name, unit_id::text, starts_on::text, ends_on::text,
                lease_status, monthly_rent::float8, security_deposit::float8
         FROM leases
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(lease_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch lease");
        AppError::Dependency("Failed to fetch lease.".to_string())
    })?;

    let Some(row) = lease else {
        return Ok(json!({ "ok": false, "error": "Lease not found." }));
    };

    let tenant = row
        .try_get::<Option<String>, _>("tenant_name")
        .ok()
        .flatten()
        .unwrap_or_default();
    let starts_on = row
        .try_get::<Option<String>, _>("starts_on")
        .ok()
        .flatten()
        .unwrap_or_default();
    let ends_on = row
        .try_get::<Option<String>, _>("ends_on")
        .ok()
        .flatten()
        .unwrap_or_default();
    let status = row.try_get::<String, _>("lease_status").unwrap_or_default();
    let monthly_rent = row.try_get::<f64, _>("monthly_rent").unwrap_or(0.0);
    let deposit = row.try_get::<f64, _>("security_deposit").unwrap_or(0.0);

    // Fetch abstraction if exists
    let abstraction = sqlx::query(
        "SELECT extracted_terms, clauses, compliance_flags
         FROM lease_abstractions
         WHERE lease_id = $1::uuid AND organization_id = $2::uuid
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(lease_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let extracted = abstraction
        .as_ref()
        .and_then(|r| r.try_get::<Value, _>("extracted_terms").ok())
        .unwrap_or_else(|| json!({}));
    let clauses = abstraction
        .as_ref()
        .and_then(|r| r.try_get::<Value, _>("clauses").ok())
        .unwrap_or_else(|| json!([]));

    // Fetch compliance rules (global + org-specific)
    let rules = sqlx::query(
        "SELECT id::text, rule_type, category, name, description, severity, legal_reference
         FROM compliance_rules
         WHERE is_active = true
           AND (organization_id IS NULL OR organization_id = $1::uuid)
         ORDER BY severity ASC, category ASC",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut flags: Vec<Value> = Vec::new();

    // Run rule-based checks
    for rule in &rules {
        let rule_id = rule.try_get::<String, _>("id").unwrap_or_default();
        let category = rule.try_get::<String, _>("category").unwrap_or_default();
        let severity = rule.try_get::<String, _>("severity").unwrap_or_default();
        let name = rule.try_get::<String, _>("name").unwrap_or_default();
        let description = rule.try_get::<String, _>("description").unwrap_or_default();
        let legal_ref = rule
            .try_get::<Option<String>, _>("legal_reference")
            .ok()
            .flatten();

        let violated = match category.as_str() {
            "deposit" => deposit > monthly_rent * 1.1 && monthly_rent > 0.0,
            "tax" => {
                let has_iva = extracted
                    .get("iva_included")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    || clause_mentions(&clauses, &["iva", "impuesto", "tax"]);
                !has_iva
            }
            "financial" => {
                let has_ruc = extracted
                    .get("landlord_ruc")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .is_some()
                    || clause_mentions(&clauses, &["ruc"]);
                !has_ruc
            }
            "guarantor" => {
                let has_guarantor = extracted.get("guarantor").is_some()
                    || clause_mentions(&clauses, &["fiador", "guarantor", "garante"]);
                !has_guarantor
            }
            "duration" => {
                if !starts_on.is_empty() && !ends_on.is_empty() {
                    if let (Ok(s), Ok(e)) = (
                        chrono::NaiveDate::parse_from_str(&starts_on, "%Y-%m-%d"),
                        chrono::NaiveDate::parse_from_str(&ends_on, "%Y-%m-%d"),
                    ) {
                        let months = (e - s).num_days() as f64 / 30.44;
                        months < 24.0
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            "termination" => {
                let has_notice = extracted
                    .get("notice_period_days")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    >= 60
                    || clause_mentions(&clauses, &["notice", "preaviso", "notificación"]);
                !has_notice
            }
            "maintenance" => !clause_mentions(
                &clauses,
                &["maintenance", "mantenimiento", "repair", "reparación"],
            ),
            "general" => !clause_mentions(&clauses, &["inventory", "inventario", "checklist"]),
            _ => false,
        };

        if violated {
            flags.push(json!({
                "rule_id": rule_id,
                "category": category,
                "severity": severity,
                "name": name,
                "description": description,
                "legal_reference": legal_ref,
                "resolved": false,
            }));
        }
    }

    // Structural checks (always run)
    let mut issues = Vec::new();
    let mut warnings = Vec::new();

    if !ends_on.is_empty() {
        if let Ok(end_date) = chrono::NaiveDate::parse_from_str(&ends_on, "%Y-%m-%d") {
            let today = chrono::Utc::now().date_naive();
            let days_remaining = (end_date - today).num_days();
            if days_remaining < 0 {
                issues.push("Lease has expired and needs renewal or termination.".to_string());
            } else if days_remaining < 30 {
                warnings.push(format!(
                    "Lease expires in {days_remaining} days. Initiate renewal process."
                ));
            } else if days_remaining < 60 {
                warnings.push(format!(
                    "Lease expires in {days_remaining} days. Consider sending renewal offer."
                ));
            }
        }
    }
    if tenant.is_empty() {
        issues.push("Tenant name is missing from lease record.".to_string());
    }
    if starts_on.is_empty() {
        issues.push("Lease start date is not set.".to_string());
    }
    if ends_on.is_empty() {
        warnings.push("Lease has no end date. Consider setting a definite term.".to_string());
    }
    if monthly_rent <= 0.0 {
        issues.push("Monthly rent is not set or is zero.".to_string());
    }
    if status == "active" && !ends_on.is_empty() {
        if let Ok(end_date) = chrono::NaiveDate::parse_from_str(&ends_on, "%Y-%m-%d") {
            if end_date < chrono::Utc::now().date_naive() {
                issues.push(
                    "Lease is marked as active but has already expired. Update status.".to_string(),
                );
            }
        }
    }

    let critical_count = flags
        .iter()
        .filter(|f| f.get("severity").and_then(Value::as_str) == Some("critical"))
        .count();
    let compliance_score = if issues.is_empty() && flags.is_empty() && warnings.is_empty() {
        100
    } else {
        let penalty = issues.len() * 15
            + critical_count * 20
            + (flags.len() - critical_count) * 5
            + warnings.len() * 2;
        (100_usize).saturating_sub(penalty).max(0)
    };

    // Store compliance flags back on the abstraction
    if !flags.is_empty() {
        let _ = sqlx::query(
            "UPDATE lease_abstractions SET compliance_flags = $3::jsonb
             WHERE lease_id = $1::uuid AND organization_id = $2::uuid",
        )
        .bind(lease_id)
        .bind(org_id)
        .bind(&json!(flags))
        .execute(pool)
        .await;
    }

    Ok(json!({
        "ok": true,
        "lease_id": lease_id,
        "tenant": tenant,
        "status": status,
        "compliance_score": compliance_score,
        "issues": issues,
        "warnings": warnings,
        "compliance_flags": flags,
        "flags_count": flags.len(),
        "issue_count": issues.len(),
        "warning_count": warnings.len(),
    }))
}

/// Helper: check if any clause text mentions any of the given keywords.
fn clause_mentions(clauses: &Value, keywords: &[&str]) -> bool {
    if let Some(arr) = clauses.as_array() {
        for clause in arr {
            let text = clause
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            let title = clause
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            for kw in keywords {
                if text.contains(kw) || title.contains(kw) {
                    return true;
                }
            }
        }
    }
    false
}

/// Check for documents approaching expiry.
pub async fn tool_check_document_expiry(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let days_ahead = args
        .get("days_ahead")
        .and_then(Value::as_i64)
        .unwrap_or(30)
        .clamp(1, 180);

    let rows = sqlx::query(
        "SELECT id::text, title, source_url, expires_at::text,
                (expires_at::date - current_date) AS days_remaining
         FROM knowledge_documents
         WHERE organization_id = $1::uuid
           AND expires_at IS NOT NULL
           AND expires_at <= current_date + ($2::int || ' days')::interval
         ORDER BY expires_at ASC
         LIMIT 50",
    )
    .bind(org_id)
    .bind(days_ahead as i32)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Document expiry check failed");
        AppError::Dependency("Document expiry check failed.".to_string())
    })?;

    let documents: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "document_id": r.try_get::<String, _>("id").unwrap_or_default(),
                "title": r.try_get::<String, _>("title").unwrap_or_default(),
                "source_url": r.try_get::<Option<String>, _>("source_url").ok().flatten(),
                "expires_at": r.try_get::<Option<String>, _>("expires_at").ok().flatten(),
                "days_remaining": r.try_get::<i32, _>("days_remaining").unwrap_or(0),
            })
        })
        .collect();

    let expired_count = documents
        .iter()
        .filter(|d| d.get("days_remaining").and_then(Value::as_i64).unwrap_or(0) < 0)
        .count();

    Ok(json!({
        "ok": true,
        "days_ahead": days_ahead,
        "total_flagged": documents.len(),
        "already_expired": expired_count,
        "documents": documents,
    }))
}

// ───────────────────────────────────────────────────────────────────────
// Sprint 8: Lease Abstraction & Compliance — enhanced tools
// ───────────────────────────────────────────────────────────────────────

/// Check a lease against Paraguayan law and org-specific compliance rules.
pub async fn tool_check_paraguayan_compliance(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let lease_id = args
        .get("lease_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if lease_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "lease_id is required." }));
    }

    // Fetch abstraction
    let abstraction = sqlx::query(
        "SELECT id::text, extracted_terms, clauses, compliance_flags
         FROM lease_abstractions
         WHERE lease_id = $1::uuid AND organization_id = $2::uuid
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(lease_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let Some(abs_row) = abstraction else {
        return Ok(json!({
            "ok": false,
            "error": "No lease abstraction found. Run abstract_lease_document first.",
        }));
    };

    let abs_id = abs_row.try_get::<String, _>("id").unwrap_or_default();
    let extracted = abs_row
        .try_get::<Value, _>("extracted_terms")
        .unwrap_or_else(|_| json!({}));
    let clauses = abs_row
        .try_get::<Value, _>("clauses")
        .unwrap_or_else(|_| json!([]));

    // Fetch only Paraguayan law rules
    let rules = sqlx::query(
        "SELECT id::text, category, name, description, severity, legal_reference
         FROM compliance_rules
         WHERE is_active = true AND rule_type = 'paraguayan_law'
         ORDER BY severity ASC",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut violations: Vec<Value> = Vec::new();
    let mut passed: Vec<Value> = Vec::new();

    for rule in &rules {
        let rule_id = rule.try_get::<String, _>("id").unwrap_or_default();
        let category = rule.try_get::<String, _>("category").unwrap_or_default();
        let severity = rule.try_get::<String, _>("severity").unwrap_or_default();
        let name = rule.try_get::<String, _>("name").unwrap_or_default();
        let description = rule.try_get::<String, _>("description").unwrap_or_default();
        let legal_ref = rule
            .try_get::<Option<String>, _>("legal_reference")
            .ok()
            .flatten();

        let rent = extracted
            .get("monthly_rent")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let deposit_val = extracted
            .get("security_deposit")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);

        let violated = match category.as_str() {
            "deposit" => deposit_val > rent * 1.1 && rent > 0.0,
            "tax" => {
                !extracted
                    .get("iva_included")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    && !clause_mentions(&clauses, &["iva", "impuesto al valor agregado"])
            }
            "financial" => extracted
                .get("landlord_ruc")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .is_none(),
            "guarantor" => {
                extracted.get("guarantor").is_none()
                    && !clause_mentions(&clauses, &["fiador", "garante"])
            }
            "duration" => extracted
                .get("duration_months")
                .and_then(Value::as_f64)
                .map(|m| m < 24.0)
                .unwrap_or(false),
            "termination" => {
                extracted
                    .get("notice_period_days")
                    .and_then(Value::as_i64)
                    .map(|d| d < 60)
                    .unwrap_or(true)
                    && !clause_mentions(&clauses, &["preaviso", "60 días", "sesenta días"])
            }
            _ => false,
        };

        let entry = json!({
            "rule_id": rule_id,
            "category": category,
            "severity": severity,
            "name": name,
            "description": description,
            "legal_reference": legal_ref,
        });

        if violated {
            violations.push(entry);
        } else {
            passed.push(entry);
        }
    }

    // Store flags on abstraction
    let _ = sqlx::query(
        "UPDATE lease_abstractions SET compliance_flags = $2::jsonb WHERE id = $1::uuid",
    )
    .bind(&abs_id)
    .bind(&json!(violations))
    .execute(pool)
    .await;

    Ok(json!({
        "ok": true,
        "lease_id": lease_id,
        "abstraction_id": abs_id,
        "violations": violations,
        "passed": passed,
        "violation_count": violations.len(),
        "passed_count": passed.len(),
        "total_rules_checked": violations.len() + passed.len(),
    }))
}

/// Track all critical lease deadlines and create alerts.
pub async fn tool_track_lease_deadlines(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let lease_id = args
        .get("lease_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if lease_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "lease_id is required." }));
    }

    // Fetch lease dates
    let lease = sqlx::query(
        "SELECT starts_on::text, ends_on::text, lease_status
         FROM leases WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(lease_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let Some(row) = lease else {
        return Ok(json!({ "ok": false, "error": "Lease not found." }));
    };

    let ends_on = row
        .try_get::<Option<String>, _>("ends_on")
        .ok()
        .flatten()
        .unwrap_or_default();

    let mut created_count = 0u32;

    // Create expiry deadline
    if !ends_on.is_empty() {
        let result = sqlx::query(
            "INSERT INTO deadline_alerts
                (organization_id, lease_id, deadline_type, deadline_date, description, reminder_days)
             VALUES ($1::uuid, $2::uuid, 'expiry', $3::date, 'Lease expiration date', '{60,30,7}')
             ON CONFLICT DO NOTHING
             RETURNING id",
        )
        .bind(org_id)
        .bind(lease_id)
        .bind(&ends_on)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        if result.is_some() {
            created_count += 1;
        }

        // Renewal notice deadline (60 days before expiry)
        if let Ok(end_date) = chrono::NaiveDate::parse_from_str(&ends_on, "%Y-%m-%d") {
            let notice_date = end_date - chrono::Duration::days(60);
            let result = sqlx::query(
                "INSERT INTO deadline_alerts
                    (organization_id, lease_id, deadline_type, deadline_date, description, reminder_days)
                 VALUES ($1::uuid, $2::uuid, 'notice_period', $3::date, 'Renewal decision deadline (60-day notice)', '{30,14,7}')
                 ON CONFLICT DO NOTHING
                 RETURNING id",
            )
            .bind(org_id)
            .bind(lease_id)
            .bind(notice_date.to_string())
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
            if result.is_some() {
                created_count += 1;
            }
        }
    }

    // Fetch abstraction deadlines too
    let abs_deadlines = sqlx::query(
        "SELECT deadlines FROM lease_abstractions
         WHERE lease_id = $1::uuid AND organization_id = $2::uuid
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(lease_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(abs_row) = abs_deadlines {
        if let Ok(dl_val) = abs_row.try_get::<Value, _>("deadlines") {
            if let Some(arr) = dl_val.as_array() {
                for dl in arr {
                    let dl_type = dl.get("type").and_then(Value::as_str).unwrap_or("custom");
                    let dl_date = dl.get("date").and_then(Value::as_str).unwrap_or_default();
                    let dl_desc = dl
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("Lease deadline");
                    if dl_date.is_empty() {
                        continue;
                    }
                    let result = sqlx::query(
                        "INSERT INTO deadline_alerts
                            (organization_id, lease_id, deadline_type, deadline_date, description)
                         VALUES ($1::uuid, $2::uuid, $3, $4::date, $5)
                         ON CONFLICT DO NOTHING
                         RETURNING id",
                    )
                    .bind(org_id)
                    .bind(lease_id)
                    .bind(dl_type)
                    .bind(dl_date)
                    .bind(dl_desc)
                    .fetch_optional(pool)
                    .await
                    .ok()
                    .flatten();
                    if result.is_some() {
                        created_count += 1;
                    }
                }
            }
        }
    }

    // Fetch all alerts for this lease
    let alerts = sqlx::query(
        "SELECT id::text, deadline_type, deadline_date::text, description, status,
                (deadline_date - current_date) AS days_remaining
         FROM deadline_alerts
         WHERE lease_id = $1::uuid AND organization_id = $2::uuid
         ORDER BY deadline_date ASC",
    )
    .bind(lease_id)
    .bind(org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let alert_list: Vec<Value> = alerts
        .iter()
        .map(|r| {
            json!({
                "alert_id": r.try_get::<String, _>("id").unwrap_or_default(),
                "type": r.try_get::<String, _>("deadline_type").unwrap_or_default(),
                "date": r.try_get::<Option<String>, _>("deadline_date").ok().flatten(),
                "description": r.try_get::<String, _>("description").unwrap_or_default(),
                "status": r.try_get::<String, _>("status").unwrap_or_default(),
                "days_remaining": r.try_get::<i32, _>("days_remaining").unwrap_or(0),
            })
        })
        .collect();

    let overdue = alert_list
        .iter()
        .filter(|a| a.get("days_remaining").and_then(Value::as_i64).unwrap_or(0) < 0)
        .count();

    Ok(json!({
        "ok": true,
        "lease_id": lease_id,
        "alerts_created": created_count,
        "total_alerts": alert_list.len(),
        "overdue_count": overdue,
        "alerts": alert_list,
    }))
}

/// Auto-populate lease charges from abstracted terms.
pub async fn tool_auto_populate_lease_charges(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let lease_id = args
        .get("lease_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if lease_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "lease_id is required." }));
    }

    // Fetch abstraction
    let abstraction = sqlx::query(
        "SELECT extracted_terms FROM lease_abstractions
         WHERE lease_id = $1::uuid AND organization_id = $2::uuid
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(lease_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let Some(abs_row) = abstraction else {
        return Ok(json!({
            "ok": false,
            "error": "No abstraction found for this lease. Run abstract_lease_document first.",
        }));
    };

    let terms = abs_row
        .try_get::<Value, _>("extracted_terms")
        .unwrap_or_else(|_| json!({}));
    let monthly_rent = terms
        .get("monthly_rent")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let currency = terms
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or("PYG");
    let deposit = terms
        .get("security_deposit")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let common_expenses = terms
        .get("common_expenses")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let iva_pct = terms
        .get("iva_percentage")
        .and_then(Value::as_f64)
        .unwrap_or(10.0);
    let iva_included = terms
        .get("iva_included")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let mut charges_created = Vec::new();

    // Monthly rent charge
    if monthly_rent > 0.0 {
        let result = sqlx::query(
            "INSERT INTO lease_charges
                (organization_id, lease_id, charge_type, label, amount, currency, frequency, is_recurring)
             VALUES ($1::uuid, $2::uuid, 'rent', 'Monthly Rent', $3, $4, 'monthly', true)
             ON CONFLICT DO NOTHING
             RETURNING id::text",
        )
        .bind(org_id)
        .bind(lease_id)
        .bind(monthly_rent)
        .bind(currency)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        if result.is_some() {
            charges_created
                .push(json!({"type": "rent", "amount": monthly_rent, "currency": currency}));
        }
    }

    // Security deposit
    if deposit > 0.0 {
        let result = sqlx::query(
            "INSERT INTO lease_charges
                (organization_id, lease_id, charge_type, label, amount, currency, frequency, is_recurring)
             VALUES ($1::uuid, $2::uuid, 'deposit', 'Security Deposit', $3, $4, 'one_time', false)
             ON CONFLICT DO NOTHING
             RETURNING id::text",
        )
        .bind(org_id)
        .bind(lease_id)
        .bind(deposit)
        .bind(currency)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        if result.is_some() {
            charges_created
                .push(json!({"type": "deposit", "amount": deposit, "currency": currency}));
        }
    }

    // IVA charge if not included
    if !iva_included && monthly_rent > 0.0 {
        let iva_amount = monthly_rent * (iva_pct / 100.0);
        let result = sqlx::query(
            "INSERT INTO lease_charges
                (organization_id, lease_id, charge_type, label, amount, currency, frequency, is_recurring)
             VALUES ($1::uuid, $2::uuid, 'tax', $3, $4, $5, 'monthly', true)
             ON CONFLICT DO NOTHING
             RETURNING id::text",
        )
        .bind(org_id)
        .bind(lease_id)
        .bind(format!("IVA ({iva_pct}%)"))
        .bind(iva_amount)
        .bind(currency)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        if result.is_some() {
            charges_created.push(
                json!({"type": "tax", "label": format!("IVA ({iva_pct}%)"), "amount": iva_amount}),
            );
        }
    }

    // Common expenses
    if common_expenses > 0.0 {
        let result = sqlx::query(
            "INSERT INTO lease_charges
                (organization_id, lease_id, charge_type, label, amount, currency, frequency, is_recurring)
             VALUES ($1::uuid, $2::uuid, 'common_expenses', 'Common Area Expenses', $3, $4, 'monthly', true)
             ON CONFLICT DO NOTHING
             RETURNING id::text",
        )
        .bind(org_id)
        .bind(lease_id)
        .bind(common_expenses)
        .bind(currency)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        if result.is_some() {
            charges_created.push(json!({"type": "common_expenses", "amount": common_expenses}));
        }
    }

    Ok(json!({
        "ok": true,
        "lease_id": lease_id,
        "charges_created": charges_created.len(),
        "charges": charges_created,
        "source": "lease_abstraction",
    }))
}

/// Daily deadline alert scanner — fires notifications at 60d, 30d, 7d.
pub async fn run_daily_deadline_scan(state: &AppState) {
    let pool = match state.db_pool.as_ref() {
        Some(p) => p,
        None => return,
    };

    // Find alerts where (deadline_date - today) matches one of the reminder_days
    let alerts = sqlx::query(
        "SELECT da.id::text, da.organization_id::text, da.lease_id::text,
                da.deadline_type, da.deadline_date::text, da.description,
                (da.deadline_date - current_date) AS days_remaining,
                l.tenant_name
         FROM deadline_alerts da
         LEFT JOIN leases l ON l.id = da.lease_id
         WHERE da.status IN ('pending', 'notified')
           AND (da.deadline_date - current_date) = ANY(da.reminder_days)
         ORDER BY da.deadline_date ASC
         LIMIT 200",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut notified = 0u32;
    for alert in &alerts {
        let alert_id = alert.try_get::<String, _>("id").unwrap_or_default();
        let _ = sqlx::query(
            "UPDATE deadline_alerts SET status = 'notified', last_notified_at = now()
             WHERE id = $1::uuid",
        )
        .bind(&alert_id)
        .execute(pool)
        .await;
        notified += 1;
    }

    tracing::info!(notified, "Scheduler: deadline alert scan completed");
}
