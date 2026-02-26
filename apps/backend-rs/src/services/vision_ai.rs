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

/// Analyze inspection photos using OpenAI Vision API.
pub async fn tool_analyze_inspection_photos(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let photo_urls = args
        .get("photo_urls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let inspection_type = args
        .get("inspection_type")
        .and_then(Value::as_str)
        .unwrap_or("routine");

    if unit_id.is_empty() || photo_urls.is_empty() {
        return Ok(json!({
            "ok": false,
            "error": "unit_id and photo_urls are required.",
        }));
    }

    let api_key = state
        .config
        .openai_api_key
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            AppError::ServiceUnavailable(
                "OPENAI_API_KEY is required for vision analysis.".to_string(),
            )
        })?;

    // Build vision API request with photo URLs
    let mut content_parts: Vec<Value> = vec![json!({
        "type": "text",
        "text": format!(
            "You are a property inspection assistant. Analyze these photos from a {} inspection of a rental unit. \
             For each room/area visible, provide:\n\
             1. Room identification\n\
             2. Condition score (1-5, where 5 is excellent)\n\
             3. Any defects or damage found\n\
             4. Maintenance recommendations\n\n\
             Return a JSON object with: overall_score (1-5), rooms (array of {{room, score, defects[], recommendations[]}}), \
             summary (text), urgent_issues (array of strings).",
            inspection_type
        )
    })];

    for url in &photo_urls {
        if let Some(url_str) = url.as_str() {
            content_parts.push(json!({
                "type": "image_url",
                "image_url": { "url": url_str }
            }));
        }
    }

    let base_url = state.config.openai_api_base_url.trim_end_matches('/');
    let chat_url = format!("{base_url}/v1/chat/completions");

    let response = state
        .http_client
        .post(&chat_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&json!({
            "model": "gpt-4o",
            "messages": [{
                "role": "user",
                "content": content_parts,
            }],
            "max_tokens": 2000,
            "response_format": { "type": "json_object" },
        }))
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Vision API request failed");
            AppError::Dependency("Vision API request failed.".to_string())
        })?;

    let status = response.status();
    let body: Value = response.json().await.map_err(|e| {
        tracing::error!(error = %e, "Failed to parse vision response");
        AppError::Dependency("Failed to parse vision response.".to_string())
    })?;

    if !status.is_success() {
        let err = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown error");
        return Ok(json!({
            "ok": false,
            "error": format!("Vision API error: {err}"),
        }));
    }

    let analysis_text = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(Value::as_object)
        .and_then(|c| c.get("message"))
        .and_then(Value::as_object)
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("{}");

    let analysis: Value =
        serde_json::from_str(analysis_text).unwrap_or_else(|_| json!({ "error": "parse_failed" }));

    let overall_score = analysis
        .get("overall_score")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    // Extract structured room data and defects
    let rooms = analysis.get("rooms").cloned().unwrap_or_else(|| json!([]));
    let urgent_issues = analysis
        .get("urgent_issues")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let all_defects = rooms
        .as_array()
        .map(|rooms| {
            let defects: Vec<Value> = rooms
                .iter()
                .filter_map(|r| r.get("defects"))
                .filter_map(Value::as_array)
                .flatten()
                .cloned()
                .collect();
            Value::Array(defects)
        })
        .unwrap_or_else(|| json!([]));

    // Store inspection report with room-level data
    let report = sqlx::query(
        "INSERT INTO inspection_reports (
            organization_id, unit_id, inspection_type,
            photos, ai_analysis, condition_score, defects,
            rooms, urgent_issues
         ) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb)
         RETURNING id::text",
    )
    .bind(org_id)
    .bind(unit_id)
    .bind(inspection_type)
    .bind(&Value::Array(photo_urls.clone()))
    .bind(&analysis)
    .bind(overall_score)
    .bind(&all_defects)
    .bind(&rooms)
    .bind(&urgent_issues)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let report_id = report
        .and_then(|r| r.try_get::<String, _>("id").ok())
        .unwrap_or_default();

    // If this is a move_in inspection, store room baselines
    if inspection_type == "move_in" {
        if let Some(room_arr) = rooms.as_array() {
            for room in room_arr {
                let room_name = room
                    .get("room")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let room_score = room.get("score").and_then(Value::as_i64).map(|s| s as i16);
                sqlx::query(
                    "INSERT INTO condition_baselines (organization_id, unit_id, room_name, condition_score, inspection_id)
                     VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)
                     ON CONFLICT DO NOTHING",
                )
                .bind(org_id)
                .bind(unit_id)
                .bind(room_name)
                .bind(room_score)
                .bind(&report_id)
                .execute(pool)
                .await
                .ok();
            }
        }
    }

    Ok(json!({
        "ok": true,
        "report_id": report_id,
        "unit_id": unit_id,
        "inspection_type": inspection_type,
        "overall_score": overall_score,
        "analysis": analysis,
        "photos_analyzed": photo_urls.len(),
    }))
}

// ───────────────────────────────────────────────────────────────────────
// Sprint 5: Vision AI — additional tools
// ───────────────────────────────────────────────────────────────────────

/// Compare a current inspection against the baseline (move-in) to highlight degradation.
pub async fn tool_compare_inspections(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let current_report_id = args
        .get("current_report_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let baseline_report_id = args
        .get("baseline_report_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if current_report_id.is_empty() && unit_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "current_report_id or unit_id is required." }));
    }

    // Fetch the current inspection
    let current = if !current_report_id.is_empty() {
        sqlx::query(
            "SELECT id::text, unit_id::text, condition_score, rooms, defects, ai_analysis, inspection_type
             FROM inspection_reports
             WHERE id = $1::uuid AND organization_id = $2::uuid",
        )
        .bind(current_report_id)
        .bind(org_id)
        .fetch_optional(pool)
        .await
    } else {
        // Get latest inspection for the unit
        sqlx::query(
            "SELECT id::text, unit_id::text, condition_score, rooms, defects, ai_analysis, inspection_type
             FROM inspection_reports
             WHERE unit_id = $1::uuid AND organization_id = $2::uuid
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(unit_id)
        .bind(org_id)
        .fetch_optional(pool)
        .await
    }
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch current inspection");
        AppError::Dependency("Failed to fetch current inspection.".to_string())
    })?;

    let Some(curr) = current else {
        return Ok(json!({ "ok": false, "error": "Current inspection report not found." }));
    };

    let curr_unit_id: String = curr.try_get("unit_id").unwrap_or_default();
    let curr_score: Option<i16> = curr.try_get("condition_score").ok();
    let curr_rooms: Value = curr.try_get("rooms").unwrap_or_else(|_| json!([]));
    let curr_defects: Value = curr.try_get("defects").unwrap_or_else(|_| json!([]));

    // Fetch baseline — either explicit or find the move_in inspection
    let baseline = if let Some(bid) = baseline_report_id {
        sqlx::query(
            "SELECT id::text, condition_score, rooms, defects, inspection_type
             FROM inspection_reports
             WHERE id = $1::uuid AND organization_id = $2::uuid",
        )
        .bind(bid)
        .bind(org_id)
        .fetch_optional(pool)
        .await
    } else {
        sqlx::query(
            "SELECT id::text, condition_score, rooms, defects, inspection_type
             FROM inspection_reports
             WHERE unit_id = $1::uuid AND organization_id = $2::uuid
               AND inspection_type = 'move_in'
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(&curr_unit_id)
        .bind(org_id)
        .fetch_optional(pool)
        .await
    }
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch baseline inspection");
        AppError::Dependency("Failed to fetch baseline.".to_string())
    })?;

    let (base_score, _base_rooms, comparison_details) = if let Some(base) = &baseline {
        let bs: Option<i16> = base.try_get("condition_score").ok();
        let br: Value = base.try_get("rooms").unwrap_or_else(|_| json!([]));

        // Compare room by room
        let mut room_comparisons = Vec::new();
        if let (Some(curr_arr), Some(base_arr)) = (curr_rooms.as_array(), br.as_array()) {
            let base_map: std::collections::HashMap<String, &Value> = base_arr
                .iter()
                .filter_map(|r| {
                    r.get("room")
                        .and_then(Value::as_str)
                        .map(|name| (name.to_lowercase(), r))
                })
                .collect();

            for room in curr_arr {
                let room_name = room
                    .get("room")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let curr_room_score = room.get("score").and_then(Value::as_f64).unwrap_or(0.0);
                let base_room = base_map.get(&room_name.to_lowercase());
                let base_room_score = base_room
                    .and_then(|r| r.get("score"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                let delta = curr_room_score - base_room_score;

                room_comparisons.push(json!({
                    "room": room_name,
                    "current_score": curr_room_score,
                    "baseline_score": base_room_score,
                    "delta": delta,
                    "degraded": delta < -0.5,
                    "current_defects": room.get("defects").cloned().unwrap_or(json!([])),
                }));
            }
        }

        (
            bs,
            br,
            Value::Array(room_comparisons.into_iter().map(|v| v).collect()),
        )
    } else {
        (None, json!([]), json!("No baseline found for comparison."))
    };

    // Calculate overall degradation
    let degradation = match (curr_score, base_score) {
        (Some(c), Some(b)) => Some((b as f64) - (c as f64)),
        _ => None,
    };

    // Update the inspection report with comparison data
    if let Some(base) = &baseline {
        let base_id: String = base.try_get("id").unwrap_or_default();
        sqlx::query(
            "UPDATE inspection_reports
             SET comparison_baseline_id = $3::uuid, degradation_score = $4, updated_at = now()
             WHERE id = $1::uuid AND organization_id = $2::uuid",
        )
        .bind(current_report_id)
        .bind(org_id)
        .bind(&base_id)
        .bind(degradation)
        .execute(pool)
        .await
        .ok();
    }

    Ok(json!({
        "ok": true,
        "unit_id": curr_unit_id,
        "current_score": curr_score,
        "baseline_score": base_score,
        "degradation": degradation,
        "has_baseline": baseline.is_some(),
        "room_comparisons": comparison_details,
        "current_defects": curr_defects,
    }))
}

/// Auto-create maintenance request tickets from inspection defects.
pub async fn tool_create_defect_tickets(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let report_id = args
        .get("report_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let min_severity = args
        .get("min_severity")
        .and_then(Value::as_str)
        .unwrap_or("medium");

    if report_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "report_id is required." }));
    }

    // Fetch inspection report
    let report = sqlx::query(
        "SELECT unit_id::text, rooms, defects, urgent_issues, condition_score
         FROM inspection_reports
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(report_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch inspection report");
        AppError::Dependency("Failed to fetch inspection report.".to_string())
    })?;

    let Some(report_row) = report else {
        return Ok(json!({ "ok": false, "error": "Inspection report not found." }));
    };

    let unit_id: String = report_row.try_get("unit_id").unwrap_or_default();
    let rooms: Value = report_row.try_get("rooms").unwrap_or_else(|_| json!([]));
    let urgent_issues: Value = report_row
        .try_get("urgent_issues")
        .unwrap_or_else(|_| json!([]));

    let severity_rank = |s: &str| -> i32 {
        match s.to_lowercase().as_str() {
            "critical" | "urgent" => 4,
            "high" | "major" => 3,
            "medium" | "moderate" => 2,
            "low" | "minor" => 1,
            _ => 2,
        }
    };
    let min_rank = severity_rank(min_severity);

    let mut created_tickets = Vec::new();

    // Create tickets from urgent issues
    if let Some(urgent_arr) = urgent_issues.as_array() {
        for issue in urgent_arr {
            let desc = issue.as_str().unwrap_or_default();
            if desc.is_empty() {
                continue;
            }

            let maint = sqlx::query(
                "INSERT INTO maintenance_requests (organization_id, unit_id, title, description, status, ai_category, ai_urgency)
                 VALUES ($1::uuid, $2::uuid, $3, $4, 'open', 'general', 'high')
                 RETURNING id::text",
            )
            .bind(org_id)
            .bind(&unit_id)
            .bind(format!("[Inspection] {}", &desc[..desc.len().min(80)]))
            .bind(format!("Auto-created from inspection report {report_id}: {desc}"))
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();

            if let Some(m) = maint {
                let mid: String = m.try_get("id").unwrap_or_default();
                created_tickets.push(json!({"id": mid, "title": desc, "urgency": "high"}));
            }
        }
    }

    // Create tickets from room defects
    if let Some(room_arr) = rooms.as_array() {
        for room in room_arr {
            let room_name = room
                .get("room")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let defects = room.get("defects").and_then(Value::as_array);

            if let Some(defect_list) = defects {
                for defect in defect_list {
                    let defect_str = defect.as_str().unwrap_or_default();
                    if defect_str.is_empty() {
                        continue;
                    }

                    // Estimate severity from defect text
                    let lower = defect_str.to_lowercase();
                    let urgency = if lower.contains("water")
                        || lower.contains("mold")
                        || lower.contains("structural")
                        || lower.contains("fire")
                    {
                        "high"
                    } else if lower.contains("crack")
                        || lower.contains("broken")
                        || lower.contains("leak")
                    {
                        "medium"
                    } else {
                        "low"
                    };

                    if severity_rank(urgency) < min_rank {
                        continue;
                    }

                    // Classify category
                    let category = if lower.contains("plumb")
                        || lower.contains("water")
                        || lower.contains("leak")
                        || lower.contains("pipe")
                    {
                        "plumbing"
                    } else if lower.contains("electri")
                        || lower.contains("wire")
                        || lower.contains("light")
                    {
                        "electrical"
                    } else if lower.contains("wall")
                        || lower.contains("floor")
                        || lower.contains("ceiling")
                        || lower.contains("crack")
                    {
                        "structural"
                    } else {
                        "general"
                    };

                    let maint = sqlx::query(
                        "INSERT INTO maintenance_requests (organization_id, unit_id, title, description, status, ai_category, ai_urgency)
                         VALUES ($1::uuid, $2::uuid, $3, $4, 'open', $5, $6)
                         RETURNING id::text",
                    )
                    .bind(org_id)
                    .bind(&unit_id)
                    .bind(format!("[{room_name}] {}", &defect_str[..defect_str.len().min(80)]))
                    .bind(format!("Defect in {room_name} (inspection {report_id}): {defect_str}"))
                    .bind(category)
                    .bind(urgency)
                    .fetch_optional(pool)
                    .await
                    .ok()
                    .flatten();

                    if let Some(m) = maint {
                        let mid: String = m.try_get("id").unwrap_or_default();
                        created_tickets.push(json!({
                            "id": mid,
                            "room": room_name,
                            "defect": defect_str,
                            "category": category,
                            "urgency": urgency,
                        }));
                    }
                }
            }
        }
    }

    Ok(json!({
        "ok": true,
        "report_id": report_id,
        "unit_id": unit_id,
        "tickets_created": created_tickets.len(),
        "tickets": created_tickets,
    }))
}

/// Verify cleaning quality by analyzing post-cleaning photos.
pub async fn tool_verify_cleaning(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let photo_urls = args
        .get("photo_urls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if unit_id.is_empty() || photo_urls.is_empty() {
        return Ok(json!({ "ok": false, "error": "unit_id and photo_urls are required." }));
    }

    let api_key = state
        .config
        .openai_api_key
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            AppError::ServiceUnavailable(
                "OPENAI_API_KEY is required for cleaning verification.".to_string(),
            )
        })?;

    // Build vision API request for cleaning verification
    let mut content_parts: Vec<Value> = vec![json!({
        "type": "text",
        "text": "You are a cleaning quality inspector for a rental property. Analyze these post-cleaning photos.\n\
                 Rate the cleanliness from 1-5 (5 = spotless).\n\
                 Identify any areas that still need attention.\n\n\
                 Return a JSON object with:\n\
                 - cleanliness_score (1-5)\n\
                 - passed (boolean, true if score >= 4)\n\
                 - areas_needing_attention (array of {area, issue, severity})\n\
                 - summary (text)"
    })];

    for url in &photo_urls {
        if let Some(url_str) = url.as_str() {
            content_parts.push(json!({
                "type": "image_url",
                "image_url": { "url": url_str }
            }));
        }
    }

    let base_url = state.config.openai_api_base_url.trim_end_matches('/');
    let chat_url = format!("{base_url}/v1/chat/completions");

    let response = state
        .http_client
        .post(&chat_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&json!({
            "model": "gpt-4o",
            "messages": [{
                "role": "user",
                "content": content_parts,
            }],
            "max_tokens": 1500,
            "response_format": { "type": "json_object" },
        }))
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Cleaning verification API failed");
            AppError::Dependency("Cleaning verification API failed.".to_string())
        })?;

    let status = response.status();
    let body: Value = response.json().await.map_err(|e| {
        tracing::error!(error = %e, "Failed to parse cleaning response");
        AppError::Dependency("Failed to parse cleaning response.".to_string())
    })?;

    if !status.is_success() {
        let err = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown error");
        return Ok(json!({ "ok": false, "error": format!("Vision API error: {err}") }));
    }

    let analysis_text = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(Value::as_object)
        .and_then(|c| c.get("message"))
        .and_then(Value::as_object)
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("{}");

    let analysis: Value =
        serde_json::from_str(analysis_text).unwrap_or_else(|_| json!({ "error": "parse_failed" }));

    let cleanliness_score = analysis
        .get("cleanliness_score")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let passed = analysis
        .get("passed")
        .and_then(Value::as_bool)
        .unwrap_or(cleanliness_score >= 4.0);

    // Store as a cleaning inspection report
    sqlx::query(
        "INSERT INTO inspection_reports (
            organization_id, unit_id, inspection_type,
            photos, ai_analysis, condition_score, rooms
         ) VALUES ($1::uuid, $2::uuid, 'routine', $3::jsonb, $4::jsonb, $5, '[]'::jsonb)",
    )
    .bind(org_id)
    .bind(unit_id)
    .bind(&Value::Array(photo_urls.clone()))
    .bind(&json!({"cleaning_verification": analysis}))
    .bind(cleanliness_score as i16)
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "ok": true,
        "unit_id": unit_id,
        "cleanliness_score": cleanliness_score,
        "passed": passed,
        "analysis": analysis,
        "photos_analyzed": photo_urls.len(),
    }))
}
