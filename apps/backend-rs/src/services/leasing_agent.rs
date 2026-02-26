use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{
    error::{AppError, AppResult},
    repository::table_service::create_row,
    state::AppState,
};

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database is not configured.".to_string()))
}

// ───────────────────────────────────────────────────────────────────────
// Sprint 2: Conversational Leasing Engine — new tools
// ───────────────────────────────────────────────────────────────────────

/// Match an applicant to available units by budget, size, location, and amenities.
/// Writes results to `property_matching_scores` and returns ranked matches.
pub async fn tool_match_applicant_to_units(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let app_id = args
        .get("application_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if app_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "application_id is required." }));
    }

    let max_budget = args
        .get("max_budget")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let min_bedrooms = args
        .get("min_bedrooms")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let preferred_amenities: Vec<String> = args
        .get("preferred_amenities")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(|s| s.to_lowercase())
                .collect()
        })
        .unwrap_or_default();

    // Fetch available units with pricing
    let units = sqlx::query(
        "SELECT u.id::text AS unit_id, u.unit_name, u.bedrooms, u.bathrooms,
                u.square_meters, u.amenities, u.property_id::text,
                p.property_name, p.city, p.neighborhood,
                COALESCE(pt.base_price, 0)::float8 AS base_price
         FROM units u
         JOIN properties p ON p.id = u.property_id
         LEFT JOIN pricing_templates pt ON pt.unit_id = u.id AND pt.is_active = true
         WHERE u.organization_id = $1::uuid
           AND u.is_active = true
           AND u.status IN ('available', 'vacant')
         ORDER BY pt.base_price ASC NULLS LAST
         LIMIT 50",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch available units");
        AppError::Dependency("Failed to fetch available units.".to_string())
    })?;

    let mut matches = Vec::new();
    for row in &units {
        let unit_id = row.try_get::<String, _>("unit_id").unwrap_or_default();
        let unit_name = row.try_get::<String, _>("unit_name").unwrap_or_default();
        let bedrooms = row
            .try_get::<Option<i32>, _>("bedrooms")
            .ok()
            .flatten()
            .unwrap_or(0);
        let base_price = row.try_get::<f64, _>("base_price").unwrap_or(0.0);
        let sqm = row
            .try_get::<Option<f64>, _>("square_meters")
            .ok()
            .flatten()
            .unwrap_or(0.0);
        let property_name = row
            .try_get::<String, _>("property_name")
            .unwrap_or_default();
        let amenities_val = row
            .try_get::<Option<Value>, _>("amenities")
            .ok()
            .flatten()
            .unwrap_or(json!([]));

        // Budget score: 1.0 if within budget, degrade linearly up to 50% over
        let budget_score = if max_budget <= 0.0 || base_price == 0.0 {
            0.5
        } else if base_price <= max_budget {
            1.0
        } else {
            let overage = (base_price - max_budget) / max_budget;
            (1.0 - overage * 2.0).max(0.0)
        };

        // Size score: matches bedroom requirement
        let size_score = if min_bedrooms <= 0 {
            0.7
        } else if bedrooms >= min_bedrooms as i32 {
            1.0
        } else {
            0.3
        };

        // Amenity score: fraction of preferred amenities present
        let amenity_score = if preferred_amenities.is_empty() {
            0.5
        } else {
            let unit_amenities: Vec<String> = amenities_val
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(|s| s.to_lowercase())
                        .collect()
                })
                .unwrap_or_default();
            let matched = preferred_amenities
                .iter()
                .filter(|pa| unit_amenities.iter().any(|ua| ua.contains(pa.as_str())))
                .count();
            matched as f64 / preferred_amenities.len() as f64
        };

        // Location score: placeholder (would use geocoding in future)
        let location_score = 0.5;

        // Weighted overall score
        let overall =
            budget_score * 0.40 + size_score * 0.25 + amenity_score * 0.20 + location_score * 0.15;

        matches.push(json!({
            "unit_id": unit_id,
            "unit_name": unit_name,
            "property_name": property_name,
            "base_price": (base_price * 100.0).round() / 100.0,
            "bedrooms": bedrooms,
            "square_meters": sqm,
            "overall_score": (overall * 100.0).round() / 100.0,
            "budget_score": (budget_score * 100.0).round() / 100.0,
            "size_score": (size_score * 100.0).round() / 100.0,
            "amenity_score": (amenity_score * 100.0).round() / 100.0,
            "location_score": (location_score * 100.0).round() / 100.0,
        }));
    }

    // Sort by overall score descending and assign ranks
    matches.sort_by(|a, b| {
        let sa = a
            .get("overall_score")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let sb = b
            .get("overall_score")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
    });

    // Persist top matches to property_matching_scores
    for (rank, m) in matches.iter().take(10).enumerate() {
        let uid = m.get("unit_id").and_then(Value::as_str).unwrap_or_default();
        let overall = m
            .get("overall_score")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let budget = m.get("budget_score").and_then(Value::as_f64).unwrap_or(0.0);
        let location = m
            .get("location_score")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let amenity = m
            .get("amenity_score")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let size = m.get("size_score").and_then(Value::as_f64).unwrap_or(0.0);

        let _ = sqlx::query(
            "INSERT INTO property_matching_scores
                (org_id, application_id, unit_id, overall_score, budget_score,
                 location_score, amenity_score, size_score, rank)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9)
             ON CONFLICT DO NOTHING",
        )
        .bind(org_id)
        .bind(app_id)
        .bind(uid)
        .bind(overall)
        .bind(budget)
        .bind(location)
        .bind(amenity)
        .bind(size)
        .bind((rank + 1) as i32)
        .execute(pool)
        .await;
    }

    let top_5: Vec<&Value> = matches.iter().take(5).collect();

    Ok(json!({
        "ok": true,
        "application_id": app_id,
        "total_available_units": matches.len(),
        "top_matches": top_5,
    }))
}

/// Auto-qualify a lead based on income-to-rent ratio, document completeness,
/// employment stability, and references. Returns qualification decision.
pub async fn tool_auto_qualify_lead(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let app_id = args
        .get("application_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if app_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "application_id is required." }));
    }

    // Fetch application details
    let app = sqlx::query(
        "SELECT applicant_name, applicant_phone, applicant_email,
                monthly_income::float8, desired_rent::float8,
                employment_status, employer_name,
                has_guarantor, documents_submitted,
                status, metadata
         FROM application_submissions
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(app_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch application for qualification");
        AppError::Dependency("Failed to fetch application.".to_string())
    })?;

    let Some(row) = app else {
        return Ok(json!({ "ok": false, "error": "Application not found." }));
    };

    let name = row
        .try_get::<Option<String>, _>("applicant_name")
        .ok()
        .flatten()
        .unwrap_or_default();
    let income = row
        .try_get::<Option<f64>, _>("monthly_income")
        .ok()
        .flatten()
        .unwrap_or(0.0);
    let desired_rent = row
        .try_get::<Option<f64>, _>("desired_rent")
        .ok()
        .flatten()
        .unwrap_or(0.0);
    let employment = row
        .try_get::<Option<String>, _>("employment_status")
        .ok()
        .flatten()
        .unwrap_or_default();
    let has_guarantor = row
        .try_get::<Option<bool>, _>("has_guarantor")
        .ok()
        .flatten()
        .unwrap_or(false);
    let docs_val = row
        .try_get::<Option<Value>, _>("documents_submitted")
        .ok()
        .flatten()
        .unwrap_or(json!([]));

    // Scoring factors
    let mut factors = Vec::new();
    let mut total_score: f64 = 0.0;

    // 1. Income-to-rent ratio (40% weight)
    let income_ratio = if desired_rent > 0.0 {
        income / desired_rent
    } else {
        0.0
    };
    let income_score = if income_ratio >= 3.0 {
        1.0
    } else if income_ratio >= 2.5 {
        0.8
    } else if income_ratio >= 2.0 {
        0.6
    } else if income_ratio >= 1.5 {
        0.3
    } else {
        0.1
    };
    total_score += income_score * 0.40;
    factors.push(json!({
        "factor": "income_to_rent_ratio",
        "value": (income_ratio * 100.0).round() / 100.0,
        "score": income_score,
        "weight": 0.40,
        "note": format!("Income/rent ratio: {:.1}x (need 3x ideal)", income_ratio),
    }));

    // 2. Document completeness (25% weight)
    let required_docs = ["cedula", "income_proof", "employment_letter"];
    let submitted: Vec<String> = docs_val
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(|s| s.to_lowercase())
                .collect()
        })
        .unwrap_or_default();
    let docs_present = required_docs
        .iter()
        .filter(|d| submitted.iter().any(|s| s.contains(*d)))
        .count();
    let doc_score = docs_present as f64 / required_docs.len() as f64;
    total_score += doc_score * 0.25;
    let missing: Vec<&&str> = required_docs
        .iter()
        .filter(|d| !submitted.iter().any(|s| s.contains(*d)))
        .collect();
    factors.push(json!({
        "factor": "document_completeness",
        "score": doc_score,
        "weight": 0.25,
        "submitted_count": docs_present,
        "required_count": required_docs.len(),
        "missing": missing,
    }));

    // 3. Employment stability (20% weight)
    let employment_score = match employment.to_lowercase().as_str() {
        "employed" | "full_time" | "permanent" => 1.0,
        "self_employed" | "business_owner" => 0.8,
        "contract" | "part_time" => 0.6,
        "retired" | "pension" => 0.7,
        "student" => 0.3,
        _ => 0.2,
    };
    total_score += employment_score * 0.20;
    factors.push(json!({
        "factor": "employment_stability",
        "value": employment,
        "score": employment_score,
        "weight": 0.20,
    }));

    // 4. Guarantor bonus (15% weight)
    let guarantor_score = if has_guarantor { 1.0 } else { 0.4 };
    total_score += guarantor_score * 0.15;
    factors.push(json!({
        "factor": "guarantor",
        "has_guarantor": has_guarantor,
        "score": guarantor_score,
        "weight": 0.15,
    }));

    // Qualification decision
    let lead_score = (total_score * 100.0).round();
    let (qualification, recommendation) = if lead_score >= 75.0 {
        (
            "qualified",
            "Strong candidate. Recommend proceeding to tour scheduling.",
        )
    } else if lead_score >= 50.0 {
        ("conditional", "Conditionally qualified. Missing documents or marginal income ratio. Request additional documentation.")
    } else {
        ("unqualified", "Does not meet minimum qualification criteria. Consider requesting a guarantor or additional income proof.")
    };

    // Update lead score on the leasing conversation if one exists
    let _ = sqlx::query(
        "UPDATE leasing_conversations SET lead_score = $3, updated_at = now()
         WHERE application_id = $1::uuid AND org_id = $2::uuid",
    )
    .bind(app_id)
    .bind(org_id)
    .bind(lead_score)
    .execute(pool)
    .await;

    Ok(json!({
        "ok": true,
        "application_id": app_id,
        "applicant_name": name,
        "lead_score": lead_score,
        "qualification": qualification,
        "recommendation": recommendation,
        "factors": factors,
    }))
}

/// Send a tour reminder via WhatsApp/SMS 24 hours before a scheduled tour.
pub async fn tool_send_tour_reminder(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let tour_id = args
        .get("tour_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if tour_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "tour_id is required." }));
    }

    // Fetch tour details
    let tour = sqlx::query(
        "SELECT ts.id::text, ts.scheduled_at, ts.contact_name, ts.contact_phone,
                ts.contact_email, ts.status, ts.reminder_sent_at,
                u.unit_name, p.property_name, p.address
         FROM tour_schedules ts
         JOIN units u ON u.id = ts.unit_id
         LEFT JOIN properties p ON p.id = ts.property_id
         WHERE ts.id = $1::uuid AND ts.org_id = $2::uuid",
    )
    .bind(tour_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch tour schedule");
        AppError::Dependency("Failed to fetch tour schedule.".to_string())
    })?;

    let Some(row) = tour else {
        return Ok(json!({ "ok": false, "error": "Tour not found." }));
    };

    let status: String = row.try_get("status").unwrap_or_default();
    if status == "cancelled" || status == "completed" || status == "no_show" {
        return Ok(json!({ "ok": false, "error": format!("Tour is already {}.", status) }));
    }

    let already_sent = row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("reminder_sent_at")
        .ok()
        .flatten();
    if already_sent.is_some() {
        return Ok(json!({ "ok": false, "error": "Reminder already sent for this tour." }));
    }

    let contact_name: String = row
        .try_get::<Option<String>, _>("contact_name")
        .ok()
        .flatten()
        .unwrap_or_default();
    let contact_phone: String = row
        .try_get::<Option<String>, _>("contact_phone")
        .ok()
        .flatten()
        .unwrap_or_default();
    let unit_name: String = row
        .try_get::<Option<String>, _>("unit_name")
        .ok()
        .flatten()
        .unwrap_or_default();
    let property_name: String = row
        .try_get::<Option<String>, _>("property_name")
        .ok()
        .flatten()
        .unwrap_or_default();
    let scheduled_at: String = row
        .try_get::<chrono::DateTime<chrono::Utc>, _>("scheduled_at")
        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_default();

    if contact_phone.is_empty() {
        return Ok(
            json!({ "ok": false, "error": "No contact phone number on file for this tour." }),
        );
    }

    let body = format!(
        "Hi {}! This is a reminder about your property viewing tomorrow at {}. Property: {} — Unit: {}. See you there!",
        if contact_name.is_empty() { "there" } else { &contact_name },
        scheduled_at,
        property_name,
        unit_name,
    );

    // Queue WhatsApp reminder
    let mut msg = Map::new();
    msg.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
    msg.insert(
        "recipient".to_string(),
        Value::String(contact_phone.clone()),
    );
    msg.insert(
        "direction".to_string(),
        Value::String("outbound".to_string()),
    );
    msg.insert("status".to_string(), Value::String("queued".to_string()));
    let mut payload = Map::new();
    payload.insert("body".to_string(), Value::String(body));
    payload.insert("ai_generated".to_string(), Value::Bool(true));
    payload.insert("tour_id".to_string(), Value::String(tour_id.to_string()));
    msg.insert("payload".to_string(), Value::Object(payload));
    let _ = create_row(pool, "message_logs", &msg).await;

    // Mark reminder as sent
    sqlx::query("UPDATE tour_schedules SET reminder_sent_at = now() WHERE id = $1::uuid")
        .bind(tour_id)
        .execute(pool)
        .await
        .ok();

    Ok(json!({
        "ok": true,
        "tour_id": tour_id,
        "recipient": contact_phone,
        "channel": "whatsapp",
        "status": "queued",
    }))
}

/// Advance a rental application through the leasing funnel stages.
pub async fn tool_advance_application_stage(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let app_id = args
        .get("application_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if app_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "application_id is required." }));
    }

    let new_stage = args
        .get("new_stage")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if new_stage.is_empty() {
        return Ok(json!({ "ok": false, "error": "new_stage is required." }));
    }

    let valid_stages = [
        "screening",
        "qualified",
        "visit_scheduled",
        "offer_sent",
        "signed",
        "rejected",
    ];
    if !valid_stages.contains(&new_stage) {
        return Ok(json!({
            "ok": false,
            "error": format!("Invalid stage. Must be one of: {}", valid_stages.join(", ")),
        }));
    }

    let notes = args
        .get("notes")
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Update application status
    let result = sqlx::query(
        "UPDATE application_submissions
         SET status = $3, updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid
         RETURNING id::text, status, applicant_name, unit_id::text",
    )
    .bind(app_id)
    .bind(org_id)
    .bind(new_stage)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to advance application stage");
        AppError::Dependency("Failed to advance application stage.".to_string())
    })?;

    let Some(row) = result else {
        return Ok(json!({ "ok": false, "error": "Application not found." }));
    };

    let app_id_result = row.try_get::<String, _>("id").unwrap_or_default();
    let applicant = row
        .try_get::<Option<String>, _>("applicant_name")
        .ok()
        .flatten()
        .unwrap_or_default();

    // Create an application event for audit trail
    let mut event = Map::new();
    event.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    event.insert(
        "application_id".to_string(),
        Value::String(app_id.to_string()),
    );
    event.insert(
        "event_type".to_string(),
        Value::String("stage_changed".to_string()),
    );
    event.insert(
        "details".to_string(),
        json!({ "new_stage": new_stage, "notes": notes }),
    );
    let _ = create_row(pool, "application_events", &event).await;

    // Fire workflow trigger
    let mut ctx = Map::new();
    ctx.insert(
        "application_id".to_string(),
        Value::String(app_id.to_string()),
    );
    ctx.insert(
        "new_stage".to_string(),
        Value::String(new_stage.to_string()),
    );
    crate::services::workflows::fire_trigger(
        pool,
        org_id,
        "application_status_changed",
        &ctx,
        state.config.workflow_engine_mode,
    )
    .await;

    Ok(json!({
        "ok": true,
        "application_id": app_id_result,
        "new_stage": new_stage,
        "applicant": applicant,
        "notes": notes,
    }))
}

/// Schedule a property viewing with calendar block and confirmation.
pub async fn tool_schedule_property_viewing(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let app_id = args
        .get("application_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let datetime = args
        .get("datetime")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if app_id.is_empty() || unit_id.is_empty() || datetime.is_empty() {
        return Ok(
            json!({ "ok": false, "error": "application_id, unit_id, and datetime are required." }),
        );
    }

    // Check calendar_blocks availability — reject if overlapping block exists
    let conflict: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM calendar_blocks
         WHERE organization_id = $1::uuid AND unit_id = $2::uuid
           AND starts_at::date = ($3::timestamptz)::date
           AND block_type IN ('reservation', 'maintenance', 'owner_block')
         LIMIT 1",
    )
    .bind(org_id)
    .bind(unit_id)
    .bind(datetime)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some((block_id,)) = conflict {
        return Ok(json!({
            "ok": false,
            "error": "Unit is not available on this date — an existing calendar block conflicts.",
            "conflicting_block_id": block_id,
        }));
    }

    // Also write to tour_schedules table
    let property_id: Option<(String,)> =
        sqlx::query_as("SELECT property_id::text FROM units WHERE id = $1::uuid")
            .bind(unit_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();

    let prop_id = property_id.map(|(id,)| id).unwrap_or_default();
    let contact_name = args
        .get("contact_name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let contact_phone_val = args
        .get("contact_phone")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let contact_email = args
        .get("contact_email")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let _ = sqlx::query(
        "INSERT INTO tour_schedules
            (org_id, application_id, unit_id, property_id, scheduled_at,
             contact_name, contact_phone, contact_email, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid,
                 CASE WHEN $4 = '' THEN NULL ELSE $4::uuid END,
                 $5::timestamptz, $6, $7, $8, 'scheduled')",
    )
    .bind(org_id)
    .bind(app_id)
    .bind(unit_id)
    .bind(&prop_id)
    .bind(datetime)
    .bind(contact_name)
    .bind(contact_phone_val)
    .bind(contact_email)
    .execute(pool)
    .await;

    // Create calendar block for the viewing
    let mut block = Map::new();
    block.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    block.insert("unit_id".to_string(), Value::String(unit_id.to_string()));
    block.insert(
        "block_type".to_string(),
        Value::String("viewing".to_string()),
    );
    block.insert("starts_at".to_string(), Value::String(datetime.to_string()));
    block.insert(
        "notes".to_string(),
        Value::String(format!("Property viewing for application {app_id}")),
    );

    let created = create_row(pool, "calendar_blocks", &block).await?;
    let block_id = created
        .as_object()
        .and_then(|o| o.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Update application stage
    sqlx::query(
        "UPDATE application_submissions
         SET status = 'visit_scheduled', updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(app_id)
    .bind(org_id)
    .execute(pool)
    .await
    .ok();

    // Send confirmation if phone provided
    if let Some(phone) = args.get("contact_phone").and_then(Value::as_str) {
        if !phone.is_empty() {
            let mut msg = Map::new();
            msg.insert(
                "organization_id".to_string(),
                Value::String(org_id.to_string()),
            );
            msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
            msg.insert("recipient".to_string(), Value::String(phone.to_string()));
            msg.insert(
                "direction".to_string(),
                Value::String("outbound".to_string()),
            );
            msg.insert("status".to_string(), Value::String("queued".to_string()));
            let mut payload = Map::new();
            payload.insert(
                "body".to_string(),
                Value::String(format!(
                    "Your property viewing has been scheduled for {}. We look forward to seeing you!",
                    datetime
                )),
            );
            payload.insert("ai_generated".to_string(), Value::Bool(true));
            msg.insert("payload".to_string(), Value::Object(payload));
            let _ = create_row(pool, "message_logs", &msg).await;
        }
    }

    Ok(json!({
        "ok": true,
        "calendar_block_id": block_id,
        "application_id": app_id,
        "unit_id": unit_id,
        "datetime": datetime,
        "stage": "visit_scheduled",
    }))
}

/// Generate a lease offer with computed move-in costs.
pub async fn tool_generate_lease_offer(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let app_id = args
        .get("application_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let unit_id = args
        .get("unit_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let lease_start = args
        .get("lease_start")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let lease_months = args
        .get("lease_months")
        .and_then(Value::as_i64)
        .unwrap_or(12)
        .clamp(1, 60);

    if app_id.is_empty() || unit_id.is_empty() || lease_start.is_empty() {
        return Ok(json!({
            "ok": false,
            "error": "application_id, unit_id, and lease_start are required.",
        }));
    }

    // Get pricing template for the unit
    let pricing = sqlx::query(
        "SELECT base_price::float8, security_deposit::float8, cleaning_fee::float8
         FROM pricing_templates
         WHERE organization_id = $1::uuid AND unit_id = $2::uuid AND is_active = true
         ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(org_id)
    .bind(unit_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch pricing template");
        AppError::Dependency("Failed to fetch pricing template.".to_string())
    })?;

    let (monthly_rent, deposit, cleaning_fee) = if let Some(row) = pricing {
        (
            row.try_get::<f64, _>("base_price").unwrap_or(0.0),
            row.try_get::<f64, _>("security_deposit").unwrap_or(0.0),
            row.try_get::<f64, _>("cleaning_fee").unwrap_or(0.0),
        )
    } else {
        return Ok(json!({
            "ok": false,
            "error": "No active pricing template found for this unit.",
        }));
    };

    let first_month_rent = monthly_rent;
    let move_in_total = first_month_rent + deposit + cleaning_fee;

    // Update application stage to offer_sent
    sqlx::query(
        "UPDATE application_submissions
         SET status = 'offer_sent', updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(app_id)
    .bind(org_id)
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "ok": true,
        "application_id": app_id,
        "unit_id": unit_id,
        "lease_start": lease_start,
        "lease_months": lease_months,
        "monthly_rent": (monthly_rent * 100.0).round() / 100.0,
        "security_deposit": (deposit * 100.0).round() / 100.0,
        "cleaning_fee": (cleaning_fee * 100.0).round() / 100.0,
        "first_month_rent": (first_month_rent * 100.0).round() / 100.0,
        "move_in_total": (move_in_total * 100.0).round() / 100.0,
        "stage": "offer_sent",
    }))
}

/// Send a status update to an applicant.
pub async fn tool_send_application_update(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let app_id = args
        .get("application_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let message = args
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let channel = args
        .get("channel")
        .and_then(Value::as_str)
        .unwrap_or("whatsapp");

    if app_id.is_empty() || message.is_empty() {
        return Ok(json!({ "ok": false, "error": "application_id and message are required." }));
    }

    // Look up applicant contact
    let contact = sqlx::query(
        "SELECT applicant_phone, applicant_email
         FROM application_submissions
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(app_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to look up applicant");
        AppError::Dependency("Failed to look up applicant.".to_string())
    })?;

    let Some(row) = contact else {
        return Ok(json!({ "ok": false, "error": "Application not found." }));
    };

    let recipient = if channel == "email" {
        row.try_get::<Option<String>, _>("applicant_email")
            .ok()
            .flatten()
            .unwrap_or_default()
    } else {
        row.try_get::<Option<String>, _>("applicant_phone")
            .ok()
            .flatten()
            .unwrap_or_default()
    };

    if recipient.is_empty() {
        return Ok(json!({
            "ok": false,
            "error": format!("No {} contact found for this applicant.", channel),
        }));
    }

    let mut msg = Map::new();
    msg.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    msg.insert("channel".to_string(), Value::String(channel.to_string()));
    msg.insert("recipient".to_string(), Value::String(recipient.clone()));
    msg.insert(
        "direction".to_string(),
        Value::String("outbound".to_string()),
    );
    msg.insert("status".to_string(), Value::String("queued".to_string()));
    let mut payload = Map::new();
    payload.insert("body".to_string(), Value::String(message.to_string()));
    payload.insert("ai_generated".to_string(), Value::Bool(true));
    payload.insert(
        "application_id".to_string(),
        Value::String(app_id.to_string()),
    );
    msg.insert("payload".to_string(), Value::Object(payload));

    let created = create_row(pool, "message_logs", &msg).await?;
    let msg_id = created
        .as_object()
        .and_then(|o| o.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    Ok(json!({
        "ok": true,
        "message_id": msg_id,
        "recipient": recipient,
        "channel": channel,
        "status": "queued",
    }))
}
