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
// Sprint 4: Self-Driving Maintenance — new tools
// ───────────────────────────────────────────────────────────────────────

/// Dispatch a maintenance request to a vendor by creating a work order
/// and sending a WhatsApp notification.
pub async fn tool_dispatch_to_vendor(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let request_id = args
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let vendor_id = args
        .get("vendor_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let description = args
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let priority = args
        .get("priority")
        .and_then(Value::as_str)
        .unwrap_or("medium");
    let estimated_cost = args.get("estimated_cost").and_then(Value::as_f64);

    if request_id.is_empty() || vendor_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "request_id and vendor_id are required." }));
    }

    // Check vendor availability
    let vendor = sqlx::query(
        "SELECT name, contact_phone, contact_email, max_concurrent_jobs, current_active_jobs
         FROM vendor_roster
         WHERE id = $1::uuid AND organization_id = $2::uuid AND is_active = true",
    )
    .bind(vendor_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to look up vendor");
        AppError::Dependency("Failed to look up vendor.".to_string())
    })?;

    let Some(vrow) = vendor else {
        return Ok(json!({ "ok": false, "error": "Vendor not found or inactive." }));
    };

    let vendor_name: String = vrow.try_get("name").unwrap_or_default();
    let max_jobs = vrow
        .try_get::<Option<i32>, _>("max_concurrent_jobs")
        .ok()
        .flatten()
        .unwrap_or(5);
    let active_jobs = vrow
        .try_get::<Option<i32>, _>("current_active_jobs")
        .ok()
        .flatten()
        .unwrap_or(0);

    if active_jobs >= max_jobs {
        return Ok(json!({
            "ok": false,
            "error": format!("Vendor {} is at capacity ({}/{}). Choose another vendor.", vendor_name, active_jobs, max_jobs),
        }));
    }

    // Get maintenance request description if not provided
    let wo_desc = if description.is_empty() {
        sqlx::query_scalar::<_, String>(
            "SELECT COALESCE(title, '') || ': ' || COALESCE(description, '')
             FROM maintenance_requests
             WHERE id = $1::uuid AND organization_id = $2::uuid",
        )
        .bind(request_id)
        .bind(org_id)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|_| "Maintenance work order".to_string())
    } else {
        description.to_string()
    };

    // Create work order
    let wo = sqlx::query(
        "INSERT INTO vendor_work_orders
            (org_id, maintenance_request_id, vendor_id, description, priority, estimated_cost, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'pending')
         RETURNING id::text",
    )
    .bind(org_id)
    .bind(request_id)
    .bind(vendor_id)
    .bind(&wo_desc)
    .bind(priority)
    .bind(estimated_cost)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to create work order");
        AppError::Dependency("Failed to create work order.".to_string())
    })?;

    let wo_id: String = wo.try_get("id").unwrap_or_default();

    // Increment vendor active jobs
    sqlx::query(
        "UPDATE vendor_roster SET current_active_jobs = current_active_jobs + 1, updated_at = now()
         WHERE id = $1::uuid",
    )
    .bind(vendor_id)
    .execute(pool)
    .await
    .ok();

    // Update maintenance request status
    sqlx::query(
        "UPDATE maintenance_requests SET status = 'dispatched', updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(request_id)
    .bind(org_id)
    .execute(pool)
    .await
    .ok();

    // Notify vendor via WhatsApp
    let phone: String = vrow
        .try_get::<Option<String>, _>("contact_phone")
        .ok()
        .flatten()
        .unwrap_or_default();
    if !phone.is_empty() {
        let body = format!(
            "New work order #{}: {}\nPriority: {}\nPlease reply ACCEPT to confirm.",
            &wo_id[..8.min(wo_id.len())],
            wo_desc,
            priority
        );
        let mut msg = Map::new();
        msg.insert(
            "organization_id".to_string(),
            Value::String(org_id.to_string()),
        );
        msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
        msg.insert("recipient".to_string(), Value::String(phone.clone()));
        msg.insert(
            "direction".to_string(),
            Value::String("outbound".to_string()),
        );
        msg.insert("status".to_string(), Value::String("queued".to_string()));
        let mut payload = Map::new();
        payload.insert("body".to_string(), Value::String(body));
        payload.insert("ai_generated".to_string(), Value::Bool(true));
        payload.insert("work_order_id".to_string(), Value::String(wo_id.clone()));
        msg.insert("payload".to_string(), Value::Object(payload));
        let _ = create_row(pool, "message_logs", &msg).await;
    }

    Ok(json!({
        "ok": true,
        "work_order_id": wo_id,
        "vendor_id": vendor_id,
        "vendor_name": vendor_name,
        "request_id": request_id,
        "priority": priority,
        "status": "pending",
    }))
}

/// Verify completion of a work order — optionally analyze submitted photos.
pub async fn tool_verify_completion(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let work_order_id = args
        .get("work_order_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let verified = args
        .get("verified")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let rating = args
        .get("rating")
        .and_then(Value::as_i64)
        .map(|r| r.clamp(1, 5) as i32);
    let staff_notes = args
        .get("notes")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if work_order_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "work_order_id is required." }));
    }

    // Fetch work order
    let wo = sqlx::query(
        "SELECT vendor_id::text, maintenance_request_id::text, status
         FROM vendor_work_orders
         WHERE id = $1::uuid AND org_id = $2::uuid",
    )
    .bind(work_order_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch work order");
        AppError::Dependency("Failed to fetch work order.".to_string())
    })?;

    let Some(row) = wo else {
        return Ok(json!({ "ok": false, "error": "Work order not found." }));
    };

    let status: String = row.try_get("status").unwrap_or_default();
    if status != "completed" {
        return Ok(
            json!({ "ok": false, "error": format!("Work order is '{}', must be 'completed' to verify.", status) }),
        );
    }

    let vendor_id: String = row.try_get("vendor_id").unwrap_or_default();
    let maint_id: String = row
        .try_get::<Option<String>, _>("maintenance_request_id")
        .ok()
        .flatten()
        .unwrap_or_default();

    let new_status = if verified { "verified" } else { "rejected" };

    // Update work order
    sqlx::query(
        "UPDATE vendor_work_orders
         SET status = $3, verified_at = CASE WHEN $4 THEN now() ELSE NULL END,
             rating = $5, staff_notes = $6, updated_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid",
    )
    .bind(work_order_id)
    .bind(org_id)
    .bind(new_status)
    .bind(verified)
    .bind(rating)
    .bind(staff_notes)
    .execute(pool)
    .await
    .ok();

    // Update vendor stats
    if verified {
        // Decrement active jobs, update rating and completion stats
        sqlx::query(
            "UPDATE vendor_roster SET
                current_active_jobs = GREATEST(current_active_jobs - 1, 0),
                total_jobs = total_jobs + 1,
                avg_rating = CASE
                    WHEN $2::int IS NOT NULL THEN
                        (avg_rating * total_jobs + $2::int) / (total_jobs + 1)
                    ELSE avg_rating
                END,
                completion_rate = CASE
                    WHEN total_jobs > 0 THEN
                        (completion_rate * total_jobs + 1.0) / (total_jobs + 1)
                    ELSE 1.0
                END,
                updated_at = now()
             WHERE id = $1::uuid",
        )
        .bind(&vendor_id)
        .bind(rating)
        .execute(pool)
        .await
        .ok();

        // Close the maintenance request
        if !maint_id.is_empty() {
            sqlx::query(
                "UPDATE maintenance_requests SET status = 'completed', updated_at = now()
                 WHERE id = $1::uuid AND organization_id = $2::uuid",
            )
            .bind(&maint_id)
            .bind(org_id)
            .execute(pool)
            .await
            .ok();
        }
    }

    Ok(json!({
        "ok": true,
        "work_order_id": work_order_id,
        "status": new_status,
        "vendor_id": vendor_id,
        "rating": rating,
    }))
}

/// Get vendor performance metrics for a specific vendor or all vendors.
pub async fn tool_get_vendor_performance(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let vendor_id = args
        .get("vendor_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());

    let vendors = if let Some(vid) = vendor_id {
        sqlx::query(
            "SELECT id::text, name, specialties, avg_rating::float8, total_jobs,
                    avg_response_hours::float8, completion_rate::float8,
                    current_active_jobs, max_concurrent_jobs, is_active
             FROM vendor_roster
             WHERE id = $1::uuid AND organization_id = $2::uuid",
        )
        .bind(vid)
        .bind(org_id)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT id::text, name, specialties, avg_rating::float8, total_jobs,
                    avg_response_hours::float8, completion_rate::float8,
                    current_active_jobs, max_concurrent_jobs, is_active
             FROM vendor_roster
             WHERE organization_id = $1::uuid AND is_active = true
             ORDER BY avg_rating DESC NULLS LAST
             LIMIT 20",
        )
        .bind(org_id)
        .fetch_all(pool)
        .await
    }
    .map_err(|e| {
        tracing::error!(error = %e, "Vendor performance query failed");
        AppError::Dependency("Vendor performance query failed.".to_string())
    })?;

    let results: Vec<Value> = vendors
        .iter()
        .map(|r| {
            json!({
                "vendor_id": r.try_get::<String, _>("id").unwrap_or_default(),
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "avg_rating": r.try_get::<f64, _>("avg_rating").unwrap_or(0.0),
                "total_jobs": r.try_get::<i32, _>("total_jobs").unwrap_or(0),
                "avg_response_hours": r.try_get::<f64, _>("avg_response_hours").unwrap_or(0.0),
                "completion_rate": r.try_get::<f64, _>("completion_rate").unwrap_or(0.0),
                "current_active_jobs": r.try_get::<i32, _>("current_active_jobs").unwrap_or(0),
                "max_concurrent_jobs": r.try_get::<i32, _>("max_concurrent_jobs").unwrap_or(5),
                "is_active": r.try_get::<bool, _>("is_active").unwrap_or(false),
            })
        })
        .collect();

    Ok(json!({
        "ok": true,
        "vendors": results,
        "count": results.len(),
    }))
}

/// Classify a maintenance request by urgency and category using keyword analysis.
pub async fn tool_classify_maintenance_request(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let request_id = args
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if request_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "request_id is required." }));
    }

    let row = sqlx::query(
        "SELECT id::text, title, description, status
         FROM maintenance_requests
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(request_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch maintenance request");
        AppError::Dependency("Failed to fetch maintenance request.".to_string())
    })?;

    let Some(row) = row else {
        return Ok(json!({ "ok": false, "error": "Maintenance request not found." }));
    };

    let title = row
        .try_get::<Option<String>, _>("title")
        .ok()
        .flatten()
        .unwrap_or_default()
        .to_lowercase();
    let description = row
        .try_get::<Option<String>, _>("description")
        .ok()
        .flatten()
        .unwrap_or_default()
        .to_lowercase();
    let combined = format!("{title} {description}");

    // Keyword-based classification
    let category = if combined.contains("plumb")
        || combined.contains("water")
        || combined.contains("leak")
        || combined.contains("drain")
        || combined.contains("faucet")
        || combined.contains("toilet")
        || combined.contains("pipe")
        || combined.contains("caño")
        || combined.contains("agua")
        || combined.contains("fuga")
    {
        "plumbing"
    } else if combined.contains("electri")
        || combined.contains("wire")
        || combined.contains("outlet")
        || combined.contains("light")
        || combined.contains("switch")
        || combined.contains("breaker")
        || combined.contains("luz")
        || combined.contains("enchufe")
    {
        "electrical"
    } else if combined.contains("crack")
        || combined.contains("wall")
        || combined.contains("roof")
        || combined.contains("foundation")
        || combined.contains("ceiling")
        || combined.contains("floor")
        || combined.contains("techo")
        || combined.contains("pared")
    {
        "structural"
    } else if combined.contains("appliance")
        || combined.contains("refriger")
        || combined.contains("stove")
        || combined.contains("washer")
        || combined.contains("dryer")
        || combined.contains("dishwash")
        || combined.contains("ac")
        || combined.contains("air condition")
        || combined.contains("heater")
        || combined.contains("heladera")
        || combined.contains("cocina")
    {
        "appliance"
    } else if combined.contains("pest")
        || combined.contains("bug")
        || combined.contains("roach")
        || combined.contains("mouse")
        || combined.contains("rat")
        || combined.contains("insect")
        || combined.contains("plaga")
        || combined.contains("cucaracha")
    {
        "pest"
    } else {
        "general"
    };

    // Urgency classification
    let urgency = if combined.contains("emergency")
        || combined.contains("flood")
        || combined.contains("fire")
        || combined.contains("gas leak")
        || combined.contains("no water")
        || combined.contains("no electric")
        || combined.contains("emergencia")
        || combined.contains("inundación")
        || combined.contains("incendio")
    {
        "critical"
    } else if combined.contains("urgent")
        || combined.contains("broken")
        || combined.contains("not working")
        || combined.contains("no funciona")
        || combined.contains("roto")
        || combined.contains("leak")
        || combined.contains("fuga")
    {
        "high"
    } else if combined.contains("repair")
        || combined.contains("fix")
        || combined.contains("replace")
        || combined.contains("reparar")
        || combined.contains("arreglar")
    {
        "medium"
    } else {
        "low"
    };

    let confidence = 0.75; // Keyword-based classification confidence

    // Update the maintenance request with classification
    sqlx::query(
        "UPDATE maintenance_requests
         SET ai_category = $3, ai_urgency = $4, ai_confidence = $5, updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(request_id)
    .bind(org_id)
    .bind(category)
    .bind(urgency)
    .bind(confidence)
    .execute(pool)
    .await
    .ok();

    // Set SLA deadlines based on urgency
    let (response_hours, resolution_hours) = match urgency {
        "critical" => (1, 4),
        "high" => (4, 24),
        "medium" => (24, 72),
        _ => (48, 168),
    };

    sqlx::query(
        "UPDATE maintenance_requests
         SET sla_response_deadline = now() + ($3::int || ' hours')::interval,
             sla_resolution_deadline = now() + ($4::int || ' hours')::interval,
             updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(request_id)
    .bind(org_id)
    .bind(response_hours)
    .bind(resolution_hours)
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "ok": true,
        "request_id": request_id,
        "category": category,
        "urgency": urgency,
        "confidence": confidence,
        "sla_response_hours": response_hours,
        "sla_resolution_hours": resolution_hours,
    }))
}

/// Auto-assign a maintenance request using weighted vendor scoring:
/// specialty 40% + rating 30% + availability 20% + proximity 10%.
/// Falls back to staff assignment if no suitable vendor exists.
pub async fn tool_auto_assign_maintenance(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let request_id = args
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if request_id.is_empty() {
        return Ok(json!({ "ok": false, "error": "request_id is required." }));
    }

    // Fetch maintenance request details (category, unit location)
    let req = sqlx::query(
        "SELECT title, description, unit_id::text, ai_category, ai_urgency,
                p.address AS property_address, p.city AS property_city
         FROM maintenance_requests mr
         LEFT JOIN units u ON u.id = mr.unit_id
         LEFT JOIN properties p ON p.id = u.property_id
         WHERE mr.id = $1::uuid AND mr.organization_id = $2::uuid",
    )
    .bind(request_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch maintenance request");
        AppError::Dependency("Failed to fetch maintenance request.".to_string())
    })?;

    let Some(req_row) = req else {
        return Ok(json!({ "ok": false, "error": "Maintenance request not found." }));
    };

    let title = req_row
        .try_get::<Option<String>, _>("title")
        .ok()
        .flatten()
        .unwrap_or_else(|| "Maintenance task".to_string());
    let description = req_row
        .try_get::<Option<String>, _>("description")
        .ok()
        .flatten()
        .unwrap_or_default();
    let unit_id = req_row
        .try_get::<Option<String>, _>("unit_id")
        .ok()
        .flatten();
    let category = req_row
        .try_get::<Option<String>, _>("ai_category")
        .ok()
        .flatten()
        .unwrap_or_else(|| "general".to_string());
    let urgency = req_row
        .try_get::<Option<String>, _>("ai_urgency")
        .ok()
        .flatten()
        .unwrap_or_else(|| "medium".to_string());
    let property_city = req_row
        .try_get::<Option<String>, _>("property_city")
        .ok()
        .flatten()
        .unwrap_or_default()
        .to_lowercase();

    // ── Attempt vendor assignment with weighted scoring ──
    let vendors = sqlx::query(
        "SELECT id::text, name, specialties, avg_rating::float8, total_jobs,
                completion_rate::float8, current_active_jobs, max_concurrent_jobs,
                service_area
         FROM vendor_roster
         WHERE organization_id = $1::uuid AND is_active = true
           AND current_active_jobs < max_concurrent_jobs",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // S18: Configurable vendor scoring weights from guardrail config
    let weights_json = crate::services::ai_agent::get_guardrail_value_json(
        pool,
        org_id,
        "vendor_scoring_weights",
        json!({"specialty": 0.40, "rating": 0.30, "availability": 0.20, "proximity": 0.10}),
    )
    .await;
    let w_specialty = weights_json
        .get("specialty")
        .and_then(Value::as_f64)
        .unwrap_or(0.40);
    let w_rating = weights_json
        .get("rating")
        .and_then(Value::as_f64)
        .unwrap_or(0.30);
    let w_availability = weights_json
        .get("availability")
        .and_then(Value::as_f64)
        .unwrap_or(0.20);
    let w_proximity = weights_json
        .get("proximity")
        .and_then(Value::as_f64)
        .unwrap_or(0.10);

    // Score each vendor with configurable weights
    let mut scored: Vec<(String, String, f64)> = vendors
        .iter()
        .map(|v| {
            let vid: String = v.try_get("id").unwrap_or_default();
            let vname: String = v.try_get("name").unwrap_or_default();

            // Specialty match (40%): check if vendor specialties contain the category
            let specialties_json: Option<Value> = v.try_get::<Value, _>("specialties").ok();
            let specialty_score = match &specialties_json {
                Some(Value::Array(arr)) => {
                    if arr.iter().any(|s| {
                        s.as_str()
                            .map(|sp| sp.to_lowercase() == category.to_lowercase())
                            .unwrap_or(false)
                    }) {
                        1.0
                    } else {
                        0.2 // Generic vendors get partial credit
                    }
                }
                _ => 0.5, // No specialties listed = generalist
            };

            // Rating (30%): normalize to 0-1 (rating is 1-5)
            let rating = v.try_get::<f64, _>("avg_rating").unwrap_or(3.0);
            let rating_score = (rating - 1.0) / 4.0; // 1→0.0, 5→1.0

            // Availability (20%): ratio of free slots
            let max_jobs = v
                .try_get::<Option<i32>, _>("max_concurrent_jobs")
                .ok()
                .flatten()
                .unwrap_or(5) as f64;
            let active = v
                .try_get::<Option<i32>, _>("current_active_jobs")
                .ok()
                .flatten()
                .unwrap_or(0) as f64;
            let availability_score = if max_jobs > 0.0 {
                (max_jobs - active) / max_jobs
            } else {
                0.0
            };

            // Proximity (10%): check if vendor service_area overlaps property city
            let service_area: String = v
                .try_get::<Option<String>, _>("service_area")
                .ok()
                .flatten()
                .unwrap_or_default()
                .to_lowercase();
            let proximity_score = if service_area.is_empty() || property_city.is_empty() {
                0.5 // Unknown = neutral
            } else if service_area.contains(&property_city) || property_city.contains(&service_area)
            {
                1.0
            } else {
                0.2
            };

            let total = specialty_score * w_specialty
                + rating_score * w_rating
                + availability_score * w_availability
                + proximity_score * w_proximity;

            (vid, vname, total)
        })
        .collect();

    scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    // If a good vendor is available (score > 0.3), dispatch to them
    if let Some((vendor_id, vendor_name, score)) = scored.first() {
        if *score > 0.3 {
            // Create work order for the vendor
            let wo_desc = format!("[{}] {}: {}", urgency.to_uppercase(), title, description);
            let wo = sqlx::query(
                "INSERT INTO vendor_work_orders
                    (org_id, maintenance_request_id, vendor_id, description, priority, status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'pending')
                 RETURNING id::text",
            )
            .bind(org_id)
            .bind(request_id)
            .bind(vendor_id.as_str())
            .bind(&wo_desc)
            .bind(&urgency)
            .fetch_one(pool)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Failed to create work order");
                AppError::Dependency("Failed to create work order.".to_string())
            })?;

            let wo_id: String = wo.try_get("id").unwrap_or_default();

            // Increment vendor active jobs
            sqlx::query(
                "UPDATE vendor_roster SET current_active_jobs = current_active_jobs + 1, updated_at = now()
                 WHERE id = $1::uuid",
            )
            .bind(vendor_id.as_str())
            .execute(pool)
            .await
            .ok();

            // Update maintenance request
            sqlx::query(
                "UPDATE maintenance_requests SET status = 'dispatched', updated_at = now()
                 WHERE id = $1::uuid AND organization_id = $2::uuid",
            )
            .bind(request_id)
            .bind(org_id)
            .execute(pool)
            .await
            .ok();

            return Ok(json!({
                "ok": true,
                "assignment_type": "vendor",
                "request_id": request_id,
                "vendor_id": vendor_id,
                "vendor_name": vendor_name,
                "vendor_score": (score * 100.0).round() / 100.0,
                "work_order_id": wo_id,
                "category": category,
                "urgency": urgency,
                "runners_up": scored.iter().skip(1).take(2).map(|(id, name, s)| {
                    json!({"vendor_id": id, "name": name, "score": (s * 100.0).round() / 100.0})
                }).collect::<Vec<_>>(),
            }));
        }
    }

    // ── Fallback: assign to staff member with lowest task count ──
    let staff = sqlx::query(
        "SELECT
            u.id::text AS user_id,
            u.full_name,
            COALESCE(open_tasks.count, 0) AS open_task_count
         FROM organization_members om
         JOIN app_users u ON u.id = om.user_id
         LEFT JOIN (
            SELECT assigned_to_user_id, COUNT(*)::int AS count
            FROM tasks
            WHERE organization_id = $1::uuid AND status IN ('todo', 'in_progress')
            GROUP BY assigned_to_user_id
         ) open_tasks ON open_tasks.assigned_to_user_id = om.user_id
         WHERE om.organization_id = $1::uuid
           AND om.role IN ('operator', 'owner_admin')
         ORDER BY open_task_count ASC
         LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to find available staff");
        AppError::Dependency("Failed to find available staff.".to_string())
    })?;

    let Some(staff_row) = staff else {
        return Ok(json!({ "ok": false, "error": "No available staff or vendors found." }));
    };

    let user_id = staff_row
        .try_get::<String, _>("user_id")
        .unwrap_or_default();
    let full_name = staff_row
        .try_get::<String, _>("full_name")
        .unwrap_or_default();
    let task_count = staff_row.try_get::<i32, _>("open_task_count").unwrap_or(0);

    // Create task from maintenance request
    let mut task = Map::new();
    task.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    task.insert(
        "title".to_string(),
        Value::String(format!("[Maintenance] {title}")),
    );
    task.insert("description".to_string(), Value::String(description));
    task.insert("priority".to_string(), Value::String(urgency.clone()));
    task.insert("status".to_string(), Value::String("todo".to_string()));
    task.insert(
        "category".to_string(),
        Value::String("maintenance".to_string()),
    );
    task.insert(
        "assigned_to_user_id".to_string(),
        Value::String(user_id.clone()),
    );
    task.insert(
        "maintenance_request_id".to_string(),
        Value::String(request_id.to_string()),
    );
    if let Some(uid) = unit_id {
        task.insert("unit_id".to_string(), Value::String(uid));
    }

    let created = crate::repository::table_service::create_row(pool, "tasks", &task).await?;
    let task_id = created
        .as_object()
        .and_then(|o| o.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Update maintenance request status
    sqlx::query(
        "UPDATE maintenance_requests SET status = 'in_progress', updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid AND status = 'open'",
    )
    .bind(request_id)
    .bind(org_id)
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "ok": true,
        "assignment_type": "staff",
        "request_id": request_id,
        "assigned_to": user_id,
        "assigned_name": full_name,
        "task_id": task_id,
        "current_task_load": task_count,
        "category": category,
        "urgency": urgency,
        "note": "No suitable vendor found; assigned to staff member.",
    }))
}

/// Check SLA compliance for open maintenance requests.
pub async fn tool_check_maintenance_sla(state: &AppState, org_id: &str) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let breached = sqlx::query(
        "SELECT id::text, title, ai_urgency, ai_category, status,
                sla_response_deadline::text, sla_resolution_deadline::text
         FROM maintenance_requests
         WHERE organization_id = $1::uuid
           AND status NOT IN ('completed', 'closed')
           AND (
               (sla_response_deadline IS NOT NULL AND sla_response_deadline < now() AND sla_breached = false)
               OR (sla_resolution_deadline IS NOT NULL AND sla_resolution_deadline < now())
           )
         ORDER BY sla_response_deadline ASC NULLS LAST
         LIMIT 50",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "SLA check query failed");
        AppError::Dependency("SLA check query failed.".to_string())
    })?;

    let items: Vec<Value> = breached
        .iter()
        .map(|r| {
            json!({
                "request_id": r.try_get::<String, _>("id").unwrap_or_default(),
                "title": r.try_get::<Option<String>, _>("title").ok().flatten(),
                "urgency": r.try_get::<Option<String>, _>("ai_urgency").ok().flatten(),
                "category": r.try_get::<Option<String>, _>("ai_category").ok().flatten(),
                "status": r.try_get::<String, _>("status").unwrap_or_default(),
                "sla_response_deadline": r.try_get::<Option<String>, _>("sla_response_deadline").ok().flatten(),
                "sla_resolution_deadline": r.try_get::<Option<String>, _>("sla_resolution_deadline").ok().flatten(),
            })
        })
        .collect();

    // Mark breached items
    for item in &items {
        if let Some(req_id) = item.get("request_id").and_then(Value::as_str) {
            sqlx::query(
                "UPDATE maintenance_requests SET sla_breached = true, updated_at = now()
                 WHERE id = $1::uuid AND organization_id = $2::uuid AND sla_breached = false",
            )
            .bind(req_id)
            .bind(org_id)
            .execute(pool)
            .await
            .ok();
        }
    }

    Ok(json!({
        "ok": true,
        "breached_count": items.len(),
        "breached_items": items,
    }))
}

/// Escalate a maintenance request by re-assigning or notifying manager.
pub async fn tool_escalate_maintenance(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let request_id = args
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reason = args
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if request_id.is_empty() || reason.is_empty() {
        return Ok(json!({ "ok": false, "error": "request_id and reason are required." }));
    }

    // Create escalation notification
    sqlx::query(
        "INSERT INTO notifications (organization_id, type, title, body, severity, channel, metadata)
         VALUES ($1::uuid, 'maintenance_escalation',
                 'Maintenance Request Escalated',
                 $3, 'high', 'in_app',
                 jsonb_build_object('request_id', $2, 'reason', $3))",
    )
    .bind(org_id)
    .bind(request_id)
    .bind(reason)
    .execute(pool)
    .await
    .ok();

    // Update request priority to critical
    sqlx::query(
        "UPDATE maintenance_requests
         SET ai_urgency = 'critical', updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(request_id)
    .bind(org_id)
    .execute(pool)
    .await
    .ok();

    Ok(json!({
        "ok": true,
        "request_id": request_id,
        "action": "escalated",
        "new_urgency": "critical",
        "reason": reason,
    }))
}

/// Request a quote from a vendor for maintenance work.
pub async fn tool_request_vendor_quote(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let vendor_id = args
        .get("vendor_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let request_id = args
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let description = args
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if vendor_id.is_empty() || request_id.is_empty() || description.is_empty() {
        return Ok(json!({
            "ok": false,
            "error": "vendor_id, request_id, and description are required.",
        }));
    }

    // Look up vendor contact
    let vendor = sqlx::query(
        "SELECT name, contact_phone, contact_email
         FROM vendor_roster
         WHERE id = $1::uuid AND organization_id = $2::uuid",
    )
    .bind(vendor_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to look up vendor");
        AppError::Dependency("Failed to look up vendor.".to_string())
    })?;

    let Some(vendor_row) = vendor else {
        return Ok(json!({ "ok": false, "error": "Vendor not found." }));
    };

    let vendor_name = vendor_row.try_get::<String, _>("name").unwrap_or_default();
    let contact = vendor_row
        .try_get::<Option<String>, _>("contact_phone")
        .ok()
        .flatten()
        .or_else(|| {
            vendor_row
                .try_get::<Option<String>, _>("contact_email")
                .ok()
                .flatten()
        })
        .unwrap_or_default();

    // Queue message to vendor
    if !contact.is_empty() {
        let channel = if contact.contains('@') {
            "email"
        } else {
            "whatsapp"
        };
        let mut msg = Map::new();
        msg.insert(
            "organization_id".to_string(),
            Value::String(org_id.to_string()),
        );
        msg.insert("channel".to_string(), Value::String(channel.to_string()));
        msg.insert("recipient".to_string(), Value::String(contact.clone()));
        msg.insert(
            "direction".to_string(),
            Value::String("outbound".to_string()),
        );
        msg.insert("status".to_string(), Value::String("queued".to_string()));
        let mut payload = Map::new();
        payload.insert(
            "body".to_string(),
            Value::String(format!(
                "Quote request for maintenance work:\n\n{description}\n\nPlease reply with your quote and estimated timeline."
            )),
        );
        payload.insert("ai_generated".to_string(), Value::Bool(true));
        msg.insert("payload".to_string(), Value::Object(payload));
        let _ = crate::repository::table_service::create_row(pool, "message_logs", &msg).await;
    }

    Ok(json!({
        "ok": true,
        "vendor_id": vendor_id,
        "vendor_name": vendor_name,
        "request_id": request_id,
        "status": "quote_requested",
        "contact": contact,
    }))
}

/// Select the best vendor from the roster for a maintenance category.
pub async fn tool_select_vendor(
    state: &AppState,
    org_id: &str,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    let pool = db_pool(state)?;

    let category = args
        .get("category")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if category.is_empty() {
        return Ok(json!({ "ok": false, "error": "category is required." }));
    }

    // Find vendors matching the category, sorted by rating
    let vendors = sqlx::query(
        "SELECT id::text, name, specialties, avg_rating::float8, total_jobs::int, avg_response_hours::float8
         FROM vendor_roster
         WHERE organization_id = $1::uuid
           AND is_active = true
           AND (specialties @> $2::jsonb OR specialties IS NULL)
         ORDER BY avg_rating DESC NULLS LAST, avg_response_hours ASC NULLS LAST
         LIMIT 5",
    )
    .bind(org_id)
    .bind(json!([category]))
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Vendor search failed");
        AppError::Dependency("Vendor search failed.".to_string())
    })?;

    let results: Vec<Value> = vendors
        .iter()
        .map(|r| {
            json!({
                "vendor_id": r.try_get::<String, _>("id").unwrap_or_default(),
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "avg_rating": r.try_get::<f64, _>("avg_rating").unwrap_or(0.0),
                "total_jobs": r.try_get::<i32, _>("total_jobs").unwrap_or(0),
                "avg_response_hours": r.try_get::<f64, _>("avg_response_hours").unwrap_or(0.0),
            })
        })
        .collect();

    let recommended = results.first().cloned();

    Ok(json!({
        "ok": true,
        "category": category,
        "vendors": results,
        "count": results.len(),
        "recommended": recommended,
    }))
}
