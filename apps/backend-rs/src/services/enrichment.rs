use chrono::DateTime;
use serde_json::{json, Map, Value};
use sqlx::PgPool;

use crate::{
    cache::org_key, error::AppResult, repository::table_service::list_rows, state::AppState,
};

const AUTO_TURNOVER_TASK_TYPES: &[&str] = &["check_in", "check_out", "cleaning", "inspection"];

// ---------------------------------------------------------------------------
// Cached enrichment helpers — property/unit name maps change rarely, so we
// cache the full per-org map (typically <200 entries per org).
// ---------------------------------------------------------------------------

/// Generic helper: fetch an org-scoped map from cache, or compute it from DB.
async fn cached_org_map(
    state: &AppState,
    pool: &PgPool,
    org_id: &str,
    discriminator: &str,
    table: &str,
    mapper: fn(&[Value]) -> std::collections::HashMap<String, String>,
) -> AppResult<std::collections::HashMap<String, String>> {
    let cache_key = org_key(org_id, discriminator);
    let value = state
        .enrichment_cache
        .get_or_try_init(&cache_key, || async {
            let mut filters = Map::new();
            filters.insert(
                "organization_id".to_string(),
                Value::String(org_id.to_string()),
            );
            let rows = list_rows(pool, table, Some(&filters), 1000, 0, "created_at", false).await?;
            let map = mapper(&rows);
            Ok(serde_json::to_value(&map).unwrap_or_default())
        })
        .await?;

    Ok(serde_json::from_value(value).unwrap_or_default())
}

pub async fn cached_property_names(
    state: &AppState,
    pool: &PgPool,
    org_id: &str,
) -> AppResult<std::collections::HashMap<String, String>> {
    cached_org_map(
        state,
        pool,
        org_id,
        "property_names",
        "properties",
        |rows| map_by_id_string_field(rows, "name"),
    )
    .await
}

/// Fetch both unit name and unit→property maps from a single DB query.
/// Avoids the duplicate units fetch that occurred when cached_unit_names and
/// cached_unit_property_map each independently queried the `units` table.
pub async fn cached_unit_maps(
    state: &AppState,
    pool: &PgPool,
    org_id: &str,
) -> AppResult<(
    std::collections::HashMap<String, String>,
    std::collections::HashMap<String, String>,
)> {
    let cache_key = org_key(org_id, "unit_maps");
    let value = state
        .enrichment_cache
        .get_or_try_init(&cache_key, || async {
            let mut filters = Map::new();
            filters.insert(
                "organization_id".to_string(),
                Value::String(org_id.to_string()),
            );
            let units =
                list_rows(pool, "units", Some(&filters), 1000, 0, "created_at", false).await?;
            let names = map_by_id_string_field(&units, "name");
            let property_map = map_unit_property(&units);
            Ok(serde_json::json!({ "names": names, "property_map": property_map }))
        })
        .await?;

    let names: std::collections::HashMap<String, String> =
        serde_json::from_value(value.get("names").cloned().unwrap_or_default()).unwrap_or_default();
    let property_map: std::collections::HashMap<String, String> =
        serde_json::from_value(value.get("property_map").cloned().unwrap_or_default())
            .unwrap_or_default();
    Ok((names, property_map))
}

/// Convenience: fetch all three enrichment maps (unit names, unit→property, property names).
async fn cached_enrichment_maps(
    state: &AppState,
    pool: &PgPool,
    org_id: &str,
) -> AppResult<(
    std::collections::HashMap<String, String>,
    std::collections::HashMap<String, String>,
    std::collections::HashMap<String, String>,
)> {
    let ((unit_name, unit_property), property_name) = tokio::try_join!(
        cached_unit_maps(state, pool, org_id),
        cached_property_names(state, pool, org_id),
    )?;
    Ok((unit_name, unit_property, property_name))
}

pub async fn enrich_units(
    state: &AppState,
    pool: &PgPool,
    units: Vec<Value>,
    org_id: &str,
) -> AppResult<Vec<Value>> {
    let property_ids = extract_ids(&units, "property_id");
    if property_ids.is_empty() {
        return Ok(units);
    }

    let property_names = cached_property_names(state, pool, org_id).await?;

    let mut enriched = Vec::with_capacity(units.len());
    for mut row in units {
        if let Some(obj) = row.as_object_mut() {
            if let Some(property_id) = value_string(obj.get("property_id")) {
                if let Some(property_name) = property_names.get(&property_id) {
                    obj.insert(
                        "property_name".to_string(),
                        Value::String(property_name.clone()),
                    );
                }
            }
        }
        enriched.push(row);
    }
    Ok(enriched)
}

pub async fn enrich_integrations(
    state: &AppState,
    pool: &PgPool,
    integrations: Vec<Value>,
    org_id: &str,
) -> AppResult<Vec<Value>> {
    let unit_ids = extract_ids(&integrations, "unit_id");

    let (unit_name, unit_property, property_name) = if !unit_ids.is_empty() {
        cached_enrichment_maps(state, pool, org_id).await?
    } else {
        Default::default()
    };

    let mut enriched = Vec::with_capacity(integrations.len());
    for mut integration in integrations {
        if let Some(obj) = integration.as_object_mut() {
            if let Some(unit_id) = value_string(obj.get("unit_id")) {
                if let Some(name) = unit_name.get(&unit_id) {
                    obj.insert("unit_name".to_string(), Value::String(name.clone()));
                }
                if let Some(property_id) = unit_property.get(&unit_id) {
                    obj.insert(
                        "property_id".to_string(),
                        Value::String(property_id.clone()),
                    );
                    if let Some(name) = property_name.get(property_id) {
                        obj.insert("property_name".to_string(), Value::String(name.clone()));
                    }
                }
            }
        }
        enriched.push(integration);
    }
    Ok(enriched)
}

pub async fn enrich_reservations(
    state: &AppState,
    pool: &PgPool,
    reservations: Vec<Value>,
    org_id: &str,
) -> AppResult<Vec<Value>> {
    let unit_ids = extract_ids(&reservations, "unit_id");
    let guest_ids = extract_ids(&reservations, "guest_id");
    let integration_ids = extract_ids(&reservations, "integration_id");

    // Fetch cached unit/property name maps
    let (unit_name, unit_property, property_name) = if !unit_ids.is_empty() {
        cached_enrichment_maps(state, pool, org_id).await?
    } else {
        Default::default()
    };

    // Fetch guests, integrations, and listings in parallel (not cacheable — per-request)
    let guest_fut = async {
        if guest_ids.is_empty() {
            return Ok((std::collections::HashMap::new(),));
        }
        let guests = list_rows(
            pool,
            "guests",
            Some(&filter_org_ids(
                org_id,
                guest_ids.iter().cloned().collect::<Vec<_>>(),
            )),
            5000,
            0,
            "created_at",
            false,
        )
        .await?;
        Ok::<_, crate::error::AppError>((map_by_id_string_field(&guests, "full_name"),))
    };

    let integration_fut = async {
        if integration_ids.is_empty() {
            return Ok((
                std::collections::HashMap::new(),
                std::collections::HashMap::new(),
            ));
        }
        let integrations = list_rows(
            pool,
            "integrations",
            Some(&filter_org_ids(
                org_id,
                integration_ids.iter().cloned().collect::<Vec<_>>(),
            )),
            5000,
            0,
            "created_at",
            false,
        )
        .await?;
        Ok::<_, crate::error::AppError>((
            map_by_id_string_field(&integrations, "public_name"),
            map_by_id_string_field(&integrations, "channel_name"),
        ))
    };

    let listing_fut = async {
        if unit_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        let mut listing_filters = Map::new();
        listing_filters.insert(
            "organization_id".to_string(),
            Value::String(org_id.to_string()),
        );
        listing_filters.insert("is_published".to_string(), Value::Bool(true));
        listing_filters.insert(
            "unit_id".to_string(),
            Value::Array(
                unit_ids
                    .iter()
                    .map(|id| Value::String(id.clone()))
                    .collect(),
            ),
        );
        let listings = list_rows(
            pool,
            "listings",
            Some(&listing_filters),
            5000,
            0,
            "created_at",
            false,
        )
        .await
        .unwrap_or_default();

        let mut slug_map = std::collections::HashMap::new();
        for listing in &listings {
            if let Some(obj) = listing.as_object() {
                let uid = value_string(obj.get("unit_id")).unwrap_or_default();
                let slug = value_string(obj.get("public_slug")).unwrap_or_default();
                if !uid.is_empty() && !slug.is_empty() {
                    slug_map.entry(uid).or_insert(slug);
                }
            }
        }
        Ok::<_, crate::error::AppError>(slug_map)
    };

    let ((guest_name,), (integration_name, integration_kind), listing_slug_by_unit) =
        tokio::try_join!(guest_fut, integration_fut, listing_fut)?;

    let reservation_ids = extract_ids(&reservations, "id");
    let reservation_lookup = reservations
        .iter()
        .filter_map(|row| {
            let obj = row.as_object()?;
            let id = value_string(obj.get("id"))?;
            Some((id, row.clone()))
        })
        .collect::<std::collections::HashMap<_, _>>();

    let mut auto_source_by_reservation: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut auto_count_by_reservation: std::collections::HashMap<String, i32> =
        std::collections::HashMap::new();

    if !reservation_ids.is_empty() {
        let task_limit = ((reservation_ids.len() as i64) * 20).clamp(3_000, 20_000);
        let related_tasks = list_rows(
            pool,
            "tasks",
            Some(&filter_org_field_values(
                org_id,
                "reservation_id",
                reservation_ids.iter().cloned().collect::<Vec<_>>(),
            )),
            task_limit,
            0,
            "created_at",
            false,
        )
        .await?;

        for task in &related_tasks {
            let Some(task_obj) = task.as_object() else {
                continue;
            };
            let Some(reservation_id) = value_string(task_obj.get("reservation_id")) else {
                continue;
            };
            let task_type = value_string(task_obj.get("type"))
                .unwrap_or_default()
                .to_lowercase();
            if !AUTO_TURNOVER_TASK_TYPES.contains(&task_type.as_str()) {
                continue;
            }

            *auto_count_by_reservation
                .entry(reservation_id.clone())
                .or_insert(0) += 1;

            let source = infer_automation_source(
                task_obj,
                reservation_lookup
                    .get(&reservation_id)
                    .and_then(Value::as_object),
            );
            if let Some(source_value) = source {
                if source_value == "reservation_create" {
                    auto_source_by_reservation.insert(reservation_id, source_value.to_string());
                } else {
                    auto_source_by_reservation
                        .entry(reservation_id)
                        .or_insert_with(|| source_value.to_string());
                }
            }
        }
    }

    let mut enriched = Vec::with_capacity(reservations.len());
    for mut reservation in reservations {
        if let Some(obj) = reservation.as_object_mut() {
            if let Some(unit_id) = value_string(obj.get("unit_id")) {
                obj.insert(
                    "unit_name".to_string(),
                    optional_string_value(unit_name.get(&unit_id).cloned()),
                );
                obj.insert(
                    "listing_public_slug".to_string(),
                    optional_string_value(listing_slug_by_unit.get(&unit_id).cloned()),
                );
                if let Some(property_id) = unit_property.get(&unit_id) {
                    obj.insert(
                        "property_id".to_string(),
                        Value::String(property_id.clone()),
                    );
                    obj.insert(
                        "property_name".to_string(),
                        optional_string_value(property_name.get(property_id).cloned()),
                    );
                }
            }

            if let Some(guest_id) = value_string(obj.get("guest_id")) {
                obj.insert(
                    "guest_name".to_string(),
                    optional_string_value(guest_name.get(&guest_id).cloned()),
                );
            }

            if let Some(iid) = value_string(obj.get("integration_id")) {
                obj.insert(
                    "integration_name".to_string(),
                    optional_string_value(integration_name.get(&iid).cloned()),
                );
                obj.insert(
                    "channel_name".to_string(),
                    optional_string_value(integration_kind.get(&iid).cloned()),
                );
            }

            if let Some(reservation_id) = value_string(obj.get("id")) {
                let automation_source = auto_source_by_reservation.get(&reservation_id).cloned();
                obj.insert(
                    "automation_source".to_string(),
                    optional_string_value(automation_source),
                );
                let count = *auto_count_by_reservation.get(&reservation_id).unwrap_or(&0);
                obj.insert("auto_generated_task_count".to_string(), json!(count));
                obj.insert(
                    "has_auto_generated_tasks".to_string(),
                    Value::Bool(count > 0),
                );
            } else {
                obj.insert("automation_source".to_string(), Value::Null);
                obj.insert("auto_generated_task_count".to_string(), json!(0));
                obj.insert("has_auto_generated_tasks".to_string(), Value::Bool(false));
            }
        }
        enriched.push(reservation);
    }

    Ok(enriched)
}

pub async fn enrich_calendar_blocks(
    state: &AppState,
    pool: &PgPool,
    blocks: Vec<Value>,
    org_id: &str,
) -> AppResult<Vec<Value>> {
    let unit_ids = extract_ids(&blocks, "unit_id");
    if unit_ids.is_empty() {
        return Ok(blocks);
    }

    let (unit_name, unit_property, property_name) =
        cached_enrichment_maps(state, pool, org_id).await?;

    let mut enriched = Vec::with_capacity(blocks.len());
    for mut block in blocks {
        if let Some(obj) = block.as_object_mut() {
            if let Some(unit_id) = value_string(obj.get("unit_id")) {
                obj.insert(
                    "unit_name".to_string(),
                    optional_string_value(unit_name.get(&unit_id).cloned()),
                );
                if let Some(property_id) = unit_property.get(&unit_id) {
                    obj.insert(
                        "property_id".to_string(),
                        Value::String(property_id.clone()),
                    );
                    obj.insert(
                        "property_name".to_string(),
                        optional_string_value(property_name.get(property_id).cloned()),
                    );
                }
            }
        }
        enriched.push(block);
    }

    Ok(enriched)
}

pub async fn enrich_tasks(
    state: &AppState,
    pool: &PgPool,
    tasks: Vec<Value>,
    org_id: &str,
) -> AppResult<Vec<Value>> {
    let task_ids = extract_ids(&tasks, "id");
    let reservation_ids = extract_ids(&tasks, "reservation_id");

    // Use cached name maps
    let (unit_name, unit_property, property_name) =
        cached_enrichment_maps(state, pool, org_id).await?;

    let mut checklist_counts: std::collections::HashMap<String, ChecklistCounts> =
        std::collections::HashMap::new();
    if !task_ids.is_empty() {
        let limit = ((task_ids.len() as i64) * 20).clamp(2_000, 20_000);
        let items = list_rows(
            pool,
            "task_items",
            Some(&filter_ids(task_ids.iter().cloned().collect::<Vec<_>>())),
            limit,
            0,
            "created_at",
            false,
        )
        .await?;

        for item in items {
            let Some(obj) = item.as_object() else {
                continue;
            };
            let Some(task_id) = value_string(obj.get("task_id")) else {
                continue;
            };
            let counts = checklist_counts.entry(task_id).or_default();
            counts.total += 1;

            let completed = bool_value(obj.get("is_completed"));
            let required = bool_value(obj.get("is_required"));
            if completed {
                counts.completed += 1;
            }
            if required {
                counts.required_total += 1;
                if completed {
                    counts.required_completed += 1;
                }
            }
        }
    }

    let mut reservations_by_id: std::collections::HashMap<String, Value> =
        std::collections::HashMap::new();
    if !reservation_ids.is_empty() {
        let reservations = list_rows(
            pool,
            "reservations",
            Some(&filter_org_ids(
                org_id,
                reservation_ids.iter().cloned().collect::<Vec<_>>(),
            )),
            5000,
            0,
            "created_at",
            false,
        )
        .await?;
        for reservation in reservations {
            if let Some(obj) = reservation.as_object() {
                if let Some(reservation_id) = value_string(obj.get("id")) {
                    reservations_by_id.insert(reservation_id, reservation);
                }
            }
        }
    }

    let mut enriched = Vec::with_capacity(tasks.len());
    for mut task in tasks {
        if let Some(obj) = task.as_object_mut() {
            if let Some(property_id) = value_string(obj.get("property_id")) {
                obj.insert(
                    "property_name".to_string(),
                    optional_string_value(property_name.get(&property_id).cloned()),
                );
            }

            if let Some(unit_id) = value_string(obj.get("unit_id")) {
                obj.insert(
                    "unit_name".to_string(),
                    optional_string_value(unit_name.get(&unit_id).cloned()),
                );
                if !has_non_empty_string(obj.get("property_id")) {
                    if let Some(derived_property) = unit_property.get(&unit_id) {
                        obj.insert(
                            "property_id".to_string(),
                            Value::String(derived_property.clone()),
                        );
                        obj.insert(
                            "property_name".to_string(),
                            optional_string_value(property_name.get(derived_property).cloned()),
                        );
                    }
                }
            }

            if let Some(task_id) = value_string(obj.get("id")) {
                let counts = checklist_counts.get(&task_id).cloned().unwrap_or_default();
                obj.insert("checklist_total".to_string(), json!(counts.total));
                obj.insert("checklist_completed".to_string(), json!(counts.completed));
                obj.insert(
                    "checklist_required_total".to_string(),
                    json!(counts.required_total),
                );
                obj.insert(
                    "checklist_required_remaining".to_string(),
                    json!((counts.required_total - counts.required_completed).max(0)),
                );
            }

            let reservation = value_string(obj.get("reservation_id"))
                .and_then(|reservation_id| reservations_by_id.get(&reservation_id))
                .and_then(Value::as_object);
            let automation_source = infer_automation_source(obj, reservation);
            obj.insert(
                "automation_source".to_string(),
                optional_string_value(automation_source.map(ToOwned::to_owned)),
            );
            obj.insert(
                "auto_generated".to_string(),
                Value::Bool(automation_source.is_some()),
            );
        }
        enriched.push(task);
    }

    Ok(enriched)
}

pub async fn enrich_expenses(
    state: &AppState,
    pool: &PgPool,
    expenses: Vec<Value>,
    org_id: &str,
) -> AppResult<Vec<Value>> {
    let (unit_name, unit_property, property_name) =
        cached_enrichment_maps(state, pool, org_id).await?;

    let mut enriched = Vec::with_capacity(expenses.len());
    for mut expense in expenses {
        if let Some(obj) = expense.as_object_mut() {
            if let Some(property_id) = value_string(obj.get("property_id")) {
                obj.insert(
                    "property_name".to_string(),
                    optional_string_value(property_name.get(&property_id).cloned()),
                );
            }

            if let Some(unit_id) = value_string(obj.get("unit_id")) {
                obj.insert(
                    "unit_name".to_string(),
                    optional_string_value(unit_name.get(&unit_id).cloned()),
                );
                if !has_non_empty_string(obj.get("property_id")) {
                    if let Some(derived_property) = unit_property.get(&unit_id) {
                        obj.insert(
                            "property_id".to_string(),
                            Value::String(derived_property.clone()),
                        );
                        obj.insert(
                            "property_name".to_string(),
                            optional_string_value(property_name.get(derived_property).cloned()),
                        );
                    }
                }
            }
        }
        enriched.push(expense);
    }

    Ok(enriched)
}

pub async fn enrich_owner_statements(
    state: &AppState,
    pool: &PgPool,
    statements: Vec<Value>,
    org_id: &str,
) -> AppResult<Vec<Value>> {
    let (unit_name, unit_property, property_name) =
        cached_enrichment_maps(state, pool, org_id).await?;

    let mut enriched = Vec::with_capacity(statements.len());
    for mut statement in statements {
        if let Some(obj) = statement.as_object_mut() {
            if let Some(property_id) = value_string(obj.get("property_id")) {
                obj.insert(
                    "property_name".to_string(),
                    optional_string_value(property_name.get(&property_id).cloned()),
                );
            }
            if let Some(unit_id) = value_string(obj.get("unit_id")) {
                obj.insert(
                    "unit_name".to_string(),
                    optional_string_value(unit_name.get(&unit_id).cloned()),
                );
                if !has_non_empty_string(obj.get("property_id")) {
                    if let Some(derived_property) = unit_property.get(&unit_id) {
                        obj.insert(
                            "property_id".to_string(),
                            Value::String(derived_property.clone()),
                        );
                        obj.insert(
                            "property_name".to_string(),
                            optional_string_value(property_name.get(derived_property).cloned()),
                        );
                    }
                }
            }
        }
        enriched.push(statement);
    }

    Ok(enriched)
}

#[derive(Debug, Clone, Default)]
struct ChecklistCounts {
    total: i32,
    completed: i32,
    required_total: i32,
    required_completed: i32,
}

fn extract_ids(rows: &[Value], key: &str) -> std::collections::HashSet<String> {
    let mut ids = std::collections::HashSet::new();
    for row in rows {
        if let Some(value) = row
            .as_object()
            .and_then(|obj| obj.get(key))
            .and_then(value_string_from_value)
        {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                ids.insert(trimmed.to_string());
            }
        }
    }
    ids
}

fn map_by_id_string_field(
    rows: &[Value],
    value_key: &str,
) -> std::collections::HashMap<String, String> {
    let mut mapping = std::collections::HashMap::new();
    for row in rows {
        let Some(obj) = row.as_object() else {
            continue;
        };
        let id = value_string(obj.get("id")).unwrap_or_default();
        let value = value_string(obj.get(value_key)).unwrap_or_default();
        if !id.is_empty() && !value.is_empty() {
            mapping.insert(id, value);
        }
    }
    mapping
}

fn map_unit_property(rows: &[Value]) -> std::collections::HashMap<String, String> {
    let mut mapping = std::collections::HashMap::new();
    for row in rows {
        let Some(obj) = row.as_object() else {
            continue;
        };
        let Some(unit_id) = value_string(obj.get("id")) else {
            continue;
        };
        let Some(property_id) = value_string(obj.get("property_id")) else {
            continue;
        };
        if !unit_id.is_empty() && !property_id.is_empty() {
            mapping.insert(unit_id, property_id);
        }
    }
    mapping
}

fn filter_ids(ids: Vec<String>) -> Map<String, Value> {
    let mut filters = Map::new();
    filters.insert(
        "task_id".to_string(),
        Value::Array(ids.into_iter().map(Value::String).collect()),
    );
    filters
}

fn filter_org_ids(org_id: &str, ids: Vec<String>) -> Map<String, Value> {
    filter_org_field_values(org_id, "id", ids)
}

fn filter_org_field_values(org_id: &str, field: &str, values: Vec<String>) -> Map<String, Value> {
    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    filters.insert(
        field.to_string(),
        Value::Array(values.into_iter().map(Value::String).collect()),
    );
    filters
}

fn value_string(value: Option<&Value>) -> Option<String> {
    value.and_then(value_string_from_value)
}

fn value_string_from_value(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn optional_string_value(value: Option<String>) -> Value {
    match value {
        Some(text) if !text.trim().is_empty() => Value::String(text),
        _ => Value::Null,
    }
}

fn bool_value(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(flag)) => *flag,
        Some(Value::String(text)) => {
            let lower = text.trim().to_ascii_lowercase();
            lower == "true" || lower == "1"
        }
        Some(Value::Number(number)) => number.as_i64().is_some_and(|value| value != 0),
        _ => false,
    }
}

fn has_non_empty_string(value: Option<&Value>) -> bool {
    value_string(value).is_some()
}

fn parse_iso_datetime(value: Option<&Value>) -> Option<DateTime<chrono::FixedOffset>> {
    let mut text = value_string(value)?;
    if text.ends_with('Z') {
        text.truncate(text.len().saturating_sub(1));
        text.push_str("+00:00");
    }
    DateTime::parse_from_rfc3339(&text).ok()
}

fn infer_automation_source(
    task: &Map<String, Value>,
    reservation: Option<&Map<String, Value>>,
) -> Option<&'static str> {
    let task_type = value_string(task.get("type"))
        .unwrap_or_default()
        .to_lowercase();
    let reservation_id = value_string(task.get("reservation_id")).unwrap_or_default();
    if !AUTO_TURNOVER_TASK_TYPES.contains(&task_type.as_str()) || reservation_id.is_empty() {
        return None;
    }

    let task_created_at = parse_iso_datetime(task.get("created_at"));
    let reservation_created_at =
        reservation.and_then(|item| parse_iso_datetime(item.get("created_at")));
    let reservation_status = reservation
        .and_then(|item| value_string(item.get("status")))
        .unwrap_or_default()
        .to_lowercase();

    if task_type == "check_in"
        && task_created_at.is_some()
        && reservation_created_at.is_some()
        && task_created_at
            .zip(reservation_created_at)
            .is_some_and(|(task_dt, reservation_dt)| {
                (task_dt - reservation_dt).num_seconds().abs() <= 300
            })
        && matches!(reservation_status.as_str(), "pending" | "confirmed")
    {
        return Some("reservation_create");
    }

    Some("reservation_status_transition")
}
