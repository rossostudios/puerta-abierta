use chrono::Utc;
use serde_json::{json, Map, Value};
use sqlx::{Postgres, QueryBuilder, Row};

use crate::{
    error::{AppError, AppResult},
    repository::table_service::{count_rows, list_rows},
    schemas::{ListingsOverviewQuery, PublicListingsQuery},
    services::{
        json_helpers::{json_map, non_empty_opt, value_str},
        pricing::{compute_pricing_totals, missing_required_fee_types},
        readiness::compute_readiness_report,
    },
    state::AppState,
};

const OVERVIEW_ROW_CAP: i64 = 1_000;
const MAX_GALLERY_IMAGES: usize = 8;
const MAX_SPATIAL_ASSETS: usize = 16;
const MAX_AMENITIES: usize = 24;

pub async fn attach_listing_fee_lines(
    pool: &sqlx::PgPool,
    rows: Vec<Value>,
) -> AppResult<Vec<Value>> {
    if rows.is_empty() {
        return Ok(rows);
    }

    let row_ids = rows
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|row| row.get("id"))
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if row_ids.is_empty() {
        return Ok(rows);
    }

    let unit_ids = rows
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|row| row.get("unit_id"))
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let property_ids = rows
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|row| row.get("property_id"))
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    let row_ids_for_query = row_ids.clone();
    let unit_ids_for_query = unit_ids.clone();
    let property_ids_for_query = property_ids.clone();

    let (fee_lines, units, properties) = tokio::try_join!(
        async move {
            list_rows(
                pool,
                "listing_fee_lines",
                Some(&json_map(&[(
                    "listing_id",
                    Value::Array(
                        row_ids_for_query
                            .iter()
                            .cloned()
                            .map(Value::String)
                            .collect(),
                    ),
                )])),
                std::cmp::max(200, (row_ids_for_query.len() as i64) * 20),
                0,
                "sort_order",
                true,
            )
            .await
        },
        async move {
            if unit_ids_for_query.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "units",
                    Some(&json_map(&[(
                        "id",
                        Value::Array(
                            unit_ids_for_query
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    )])),
                    std::cmp::max(200, unit_ids_for_query.len() as i64),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        },
        async move {
            if property_ids_for_query.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "properties",
                    Some(&json_map(&[(
                        "id",
                        Value::Array(
                            property_ids_for_query
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    )])),
                    std::cmp::max(200, property_ids_for_query.len() as i64),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        }
    )?;

    let mut grouped: std::collections::HashMap<String, Vec<Value>> =
        std::collections::HashMap::new();
    for line in fee_lines {
        let key = value_str(&line, "listing_id");
        if key.is_empty() {
            continue;
        }
        grouped.entry(key).or_default().push(line);
    }

    let mut unit_name: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for unit in units {
        let id = value_str(&unit, "id");
        if id.is_empty() {
            continue;
        }
        unit_name.insert(id, value_str(&unit, "name"));
    }

    let mut property_name: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for property in properties {
        let id = value_str(&property, "id");
        if id.is_empty() {
            continue;
        }
        property_name.insert(id, value_str(&property, "name"));
    }

    let mut attached = Vec::with_capacity(rows.len());
    for mut row in rows {
        if let Some(obj) = row.as_object_mut() {
            let listing_id = obj
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .unwrap_or_default();
            let lines = grouped.get(&listing_id).cloned().unwrap_or_default();
            let totals = compute_pricing_totals(&lines);
            let missing = missing_required_fee_types(&lines);

            obj.insert("fee_lines".to_string(), Value::Array(lines));
            obj.insert("total_move_in".to_string(), json!(totals.total_move_in));
            obj.insert(
                "monthly_recurring_total".to_string(),
                json!(totals.monthly_recurring_total),
            );
            obj.insert(
                "fee_breakdown_complete".to_string(),
                Value::Bool(missing.is_empty()),
            );
            obj.insert(
                "missing_required_fee_lines".to_string(),
                Value::Array(missing.into_iter().map(Value::String).collect()),
            );

            if let Some(property_id) = obj
                .get("property_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if !obj.contains_key("property_name") {
                    obj.insert(
                        "property_name".to_string(),
                        property_name
                            .get(property_id)
                            .cloned()
                            .map(Value::String)
                            .unwrap_or(Value::Null),
                    );
                }
            }
            if let Some(unit_id) = obj
                .get("unit_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if !obj.contains_key("unit_name") {
                    obj.insert(
                        "unit_name".to_string(),
                        unit_name
                            .get(unit_id)
                            .cloned()
                            .map(Value::String)
                            .unwrap_or(Value::Null),
                    );
                }
            }
        }
        attached.push(row);
    }

    Ok(attached)
}

pub async fn list_public_listing_rows(
    pool: &sqlx::PgPool,
    query: &PublicListingsQuery,
) -> AppResult<Vec<Value>> {
    let mut builder = QueryBuilder::<Postgres>::new(
        "SELECT row_to_json(t) AS row FROM (
            SELECT l.*, o.name AS organization_name, o.logo_url AS organization_logo_url, o.brand_color AS organization_brand_color, o.org_slug AS organization_slug, o.booking_enabled AS booking_enabled, u.full_name AS host_name
            FROM listings l
            LEFT JOIN organizations o ON l.organization_id = o.id
            LEFT JOIN app_users u ON o.owner_user_id = u.id
            WHERE l.is_published = true",
    );

    if let Some(org_id) = non_empty_opt(query.org_id.as_deref()) {
        builder
            .push(" AND l.organization_id = ")
            .push_bind(parse_uuid(&org_id, "org_id")?);
    }
    if let Some(city) = non_empty_opt(query.city.as_deref()) {
        builder
            .push(" AND lower(l.city) = ")
            .push_bind(city.to_ascii_lowercase());
    }
    if let Some(neighborhood) = non_empty_opt(query.neighborhood.as_deref()) {
        builder
            .push(" AND lower(coalesce(l.neighborhood, '')) LIKE ")
            .push_bind(format!("%{}%", neighborhood.to_ascii_lowercase()));
    }
    if let Some(q) = non_empty_opt(query.q.as_deref()) {
        let needle = format!("%{}%", q.to_ascii_lowercase());
        builder
            .push(" AND (lower(coalesce(l.title, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(coalesce(l.summary, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(coalesce(l.neighborhood, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(coalesce(l.description, '')) LIKE ")
            .push_bind(needle)
            .push(")");
    }
    if let Some(property_type) = non_empty_opt(query.property_type.as_deref()) {
        builder
            .push(" AND lower(coalesce(l.property_type, '')) = ")
            .push_bind(property_type.to_ascii_lowercase());
    }
    if let Some(furnished) = query.furnished {
        builder.push(" AND l.furnished = ").push_bind(furnished);
    }
    if let Some(pet_policy) = non_empty_opt(query.pet_policy.as_deref()) {
        builder
            .push(" AND lower(coalesce(l.pet_policy, '')) LIKE ")
            .push_bind(format!("%{}%", pet_policy.to_ascii_lowercase()));
    }
    if let Some(min_parking) = query.min_parking {
        builder
            .push(" AND coalesce(l.parking_spaces, 0) >= ")
            .push_bind(min_parking);
    }
    if let Some(min_bedrooms) = query.min_bedrooms {
        builder
            .push(" AND coalesce(l.bedrooms, 0) >= ")
            .push_bind(min_bedrooms);
    }
    if let Some(min_bathrooms) = query.min_bathrooms {
        builder
            .push(" AND coalesce(l.bathrooms, 0) >= ")
            .push_bind(min_bathrooms);
    }
    if let Some(max_lease_months) = query.max_lease_months {
        builder
            .push(" AND coalesce(l.minimum_lease_months, 0) <= ")
            .push_bind(max_lease_months);
    }
    if let Some(min_monthly) = query.min_monthly {
        builder
            .push(" AND coalesce(l.monthly_recurring_total, 0) >= ")
            .push_bind(min_monthly);
    }
    if let Some(max_monthly) = query.max_monthly {
        builder
            .push(" AND coalesce(l.monthly_recurring_total, 0) <= ")
            .push_bind(max_monthly);
    }
    if let Some(min_move_in) = query.min_move_in {
        builder
            .push(" AND coalesce(l.total_move_in, 0) >= ")
            .push_bind(min_move_in);
    }
    if let Some(max_move_in) = query.max_move_in {
        builder
            .push(" AND coalesce(l.total_move_in, 0) <= ")
            .push_bind(max_move_in);
    }

    builder
        .push(" ORDER BY l.published_at DESC NULLS LAST, l.created_at DESC LIMIT ")
        .push_bind(query.limit.clamp(1, 200));
    builder.push(") t");

    let rows = builder
        .build()
        .fetch_all(pool)
        .await
        .map_err(map_db_error)?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect())
}

pub async fn get_listing_row_with_context(
    pool: &sqlx::PgPool,
    listing_id: &str,
) -> AppResult<Value> {
    let parsed_id = parse_uuid(listing_id, "listing_id")?;
    let query = "SELECT row_to_json(t) AS row FROM (
        SELECT l.*, p.name AS property_name, u.name AS unit_name, pt.name AS pricing_template_label,
               o.name AS organization_name, o.logo_url AS organization_logo_url, o.brand_color AS organization_brand_color,
               o.org_slug AS organization_slug, o.booking_enabled AS booking_enabled, owner.full_name AS host_name,
               COALESCE(app_stats.total_applications, 0) AS application_count,
               COALESCE(app_stats.open_applications, 0) AS open_application_count,
               app_stats.latest_application_at
        FROM listings l
        LEFT JOIN properties p ON p.id = l.property_id
        LEFT JOIN units u ON u.id = l.unit_id
        LEFT JOIN pricing_templates pt ON pt.id = l.pricing_template_id
        LEFT JOIN organizations o ON o.id = l.organization_id
        LEFT JOIN app_users owner ON owner.id = o.owner_user_id
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS total_applications,
                   COUNT(*) FILTER (
                     WHERE status NOT IN ('rejected', 'lost', 'contract_signed')
                   )::int AS open_applications,
                   MAX(updated_at) AS latest_application_at
            FROM application_submissions
            WHERE listing_id = l.id
        ) app_stats ON TRUE
        WHERE l.id = $1
    ) t LIMIT 1";

    let row = sqlx::query(query)
        .bind(parsed_id)
        .fetch_optional(pool)
        .await
        .map_err(map_db_error)?;

    row.and_then(|value| value.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound("Listing not found.".to_string()))
}

pub async fn get_public_listing_row_by_slug(
    pool: &sqlx::PgPool,
    slug: &str,
    include_drafts: bool,
) -> AppResult<Value> {
    let mut builder = QueryBuilder::<Postgres>::new(
        "SELECT row_to_json(t) AS row FROM (
            SELECT l.*, o.name AS organization_name, o.logo_url AS organization_logo_url, o.brand_color AS organization_brand_color,
                   o.org_slug AS organization_slug, o.booking_enabled AS booking_enabled, u.full_name AS host_name
            FROM listings l
            LEFT JOIN organizations o ON l.organization_id = o.id
            LEFT JOIN app_users u ON o.owner_user_id = u.id
            WHERE l.public_slug = ",
    );
    builder.push_bind(slug.to_string());
    if !include_drafts {
        builder.push(" AND l.is_published = true");
    }
    builder.push(") t LIMIT 1");

    let row = builder
        .build()
        .fetch_optional(pool)
        .await
        .map_err(map_db_error)?;

    row.and_then(|value| value.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound("Public listing not found.".to_string()))
}

pub async fn build_listings_overview(
    state: &AppState,
    pool: &sqlx::PgPool,
    query: &ListingsOverviewQuery,
) -> AppResult<Value> {
    let mut rows =
        attach_listing_fee_lines(pool, list_admin_listing_rows(pool, query).await?).await?;

    let lifecycle_filter = normalized_lifecycle_filter(query.lifecycle_state.as_deref());
    let view_filter = normalized_view_filter(query.view.as_deref());
    let published_filter = normalized_published_filter(query.published_state.as_deref());

    let mut enriched_rows = Vec::with_capacity(rows.len());
    let mut drafts = 0_i64;
    let mut ready_to_publish = 0_i64;
    let mut published = 0_i64;
    let mut blocked = 0_i64;
    let mut applications = 0_i64;
    let mut needs_media = 0_i64;
    let mut has_applications = 0_i64;

    for row in rows.drain(..) {
        let lifecycle = listing_lifecycle_state(state, &row);
        let readiness = listing_readiness_report(&row);
        let application_count = value_i64(&row, "application_count");
        let has_cover = !missing_or_blank(&row, "cover_image_url");

        match lifecycle.as_str() {
            "draft" => drafts += 1,
            "ready_to_publish" => ready_to_publish += 1,
            "published" => published += 1,
            "blocked" => blocked += 1,
            _ => {}
        }
        applications += application_count;
        if !has_cover {
            needs_media += 1;
        }
        if application_count > 0 {
            has_applications += 1;
        }

        let row_published = bool_value(row.get("is_published"));
        if let Some(expected) = published_filter {
            if row_published != expected {
                continue;
            }
        }
        if let Some(expected) = lifecycle_filter.as_deref() {
            if lifecycle != expected {
                continue;
            }
        }
        if let Some(view) = view_filter.as_deref() {
            if !matches_overview_view(view, &lifecycle, has_cover, application_count > 0) {
                continue;
            }
        }

        enriched_rows.push(to_overview_row(&row, &lifecycle, &readiness));
    }

    let offset = query.offset.max(0) as usize;
    let limit = query.limit.clamp(1, 100) as usize;
    let rows = enriched_rows
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();

    let has_units = count_rows(
        pool,
        "units",
        Some(&json_map(&[(
            "organization_id",
            Value::String(query.org_id.clone()),
        )])),
    )
    .await?
        > 0;

    Ok(json!({
        "summary": {
            "total": drafts + ready_to_publish + published + blocked,
            "drafts": drafts,
            "readyToPublish": ready_to_publish,
            "published": published,
            "blocked": blocked,
            "applications": applications,
        },
        "viewCounts": {
            "all": drafts + ready_to_publish + published + blocked,
            "drafts": drafts,
            "ready_to_publish": ready_to_publish,
            "live": published,
            "needs_media": needs_media,
            "has_applications": has_applications,
        },
        "rows": rows,
        "hasUnits": has_units,
    }))
}

pub async fn build_listing_detail_overview(
    state: &AppState,
    pool: &sqlx::PgPool,
    listing_id: &str,
) -> AppResult<Value> {
    let row = get_listing_row_with_context(pool, listing_id).await?;
    let mut attached = attach_listing_fee_lines(pool, vec![row]).await?;
    let row = attached.pop().unwrap_or_else(|| Value::Object(Map::new()));
    let lifecycle = listing_lifecycle_state(state, &row);
    let readiness_report = listing_readiness_report(&row);
    let preview = public_listing_shape(state, &row);

    let unit_id = non_empty_opt(row.get("unit_id").and_then(Value::as_str));
    let listing_uuid = parse_uuid(listing_id, "listing_id")?;
    let today = Utc::now().date_naive();

    let availability = if let Some(unit_id) = unit_id.as_deref() {
        let parsed_unit = parse_uuid(unit_id, "unit_id")?;
        let blocked_dates_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)::bigint
             FROM calendar_blocks
             WHERE unit_id = $1 AND ends_on >= $2",
        )
        .bind(parsed_unit)
        .bind(today)
        .fetch_one(pool)
        .await
        .map_err(map_db_error)?;

        let upcoming_reservations_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)::bigint
             FROM reservations
             WHERE unit_id = $1
               AND status IN ('pending', 'confirmed', 'checked_in')
               AND check_out_date >= $2",
        )
        .bind(parsed_unit)
        .bind(today)
        .fetch_one(pool)
        .await
        .map_err(map_db_error)?;

        json!({
            "availableFrom": row.get("available_from").cloned().unwrap_or(Value::Null),
            "blockedDatesCount": blocked_dates_count,
            "upcomingReservationsCount": upcoming_reservations_count,
        })
    } else {
        json!({
            "availableFrom": row.get("available_from").cloned().unwrap_or(Value::Null),
            "blockedDatesCount": 0,
            "upcomingReservationsCount": 0,
        })
    };

    let applications_row = sqlx::query(
        "SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (
                  WHERE status NOT IN ('rejected', 'lost', 'contract_signed')
                )::bigint AS open
         FROM application_submissions
         WHERE listing_id = $1",
    )
    .bind(listing_uuid)
    .fetch_one(pool)
    .await
    .map_err(map_db_error)?;

    let latest_applications = sqlx::query(
        "SELECT id::text,
                full_name,
                status::text,
                created_at
         FROM application_submissions
         WHERE listing_id = $1
         ORDER BY created_at DESC
         LIMIT 5",
    )
    .bind(listing_uuid)
    .fetch_all(pool)
    .await
    .map_err(map_db_error)?
    .into_iter()
    .map(|application| {
        json!({
            "id": application.try_get::<String, _>("id").unwrap_or_default(),
            "title": application.try_get::<String, _>("full_name").unwrap_or_default(),
            "status": application.try_get::<String, _>("status").unwrap_or_default(),
            "createdAt": application
                .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .map(|value| value.to_rfc3339())
                .unwrap_or_default(),
        })
    })
    .collect::<Vec<_>>();

    Ok(json!({
        "listing": {
            "id": value_str(&row, "id"),
            "title": value_str(&row, "title"),
            "publicSlug": value_str(&row, "public_slug"),
            "propertyId": value_null_or_string(&row, "property_id"),
            "propertyName": value_null_or_string(&row, "property_name"),
            "unitId": value_null_or_string(&row, "unit_id"),
            "unitName": value_null_or_string(&row, "unit_name"),
            "isPublished": bool_value(row.get("is_published")),
            "lifecycleState": lifecycle,
            "readinessScore": readiness_report
                .get("score")
                .cloned()
                .unwrap_or_else(|| json!(0)),
            "monthlyRecurringTotal": value_f64(&row, "monthly_recurring_total"),
            "totalMoveIn": value_f64(&row, "total_move_in"),
            "availableFrom": value_null_or_string(&row, "available_from"),
            "applicationCount": value_i64(&row, "application_count"),
            "updatedAt": value_null_or_string(&row, "updated_at"),
            "primaryHref": format!("/module/listings/{}", value_str(&row, "id")),
            "previewHref": format!("/module/listings/{}?preview=1", value_str(&row, "id")),
            "publicHref": public_href(&row),
            "summary": value_null_or_string(&row, "summary"),
            "description": value_null_or_string(&row, "description"),
            "pricingTemplateId": value_null_or_string(&row, "pricing_template_id"),
            "pricingTemplateLabel": value_null_or_string(&row, "pricing_template_label"),
            "coverImageUrl": value_null_or_string(&row, "cover_image_url"),
            "galleryImageUrls": row.get("gallery_image_urls").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
            "city": value_str(&row, "city"),
            "neighborhood": value_null_or_string(&row, "neighborhood"),
            "currency": value_str(&row, "currency"),
            "propertyType": value_null_or_string(&row, "property_type"),
            "bedrooms": row.get("bedrooms").cloned().unwrap_or(Value::Null),
            "bathrooms": row.get("bathrooms").cloned().unwrap_or(Value::Null),
            "squareMeters": row.get("square_meters").cloned().unwrap_or(Value::Null),
            "furnished": bool_value(row.get("furnished")),
            "petPolicy": value_null_or_string(&row, "pet_policy"),
            "parkingSpaces": row.get("parking_spaces").cloned().unwrap_or(Value::Null),
            "minimumLeaseMonths": row
                .get("minimum_lease_months")
                .cloned()
                .unwrap_or(Value::Null),
            "availableFrom": value_null_or_string(&row, "available_from"),
            "maintenanceFee": row.get("maintenance_fee").cloned().unwrap_or(Value::Null),
            "amenities": row.get("amenities").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        },
        "readiness": readiness_report,
        "pricing": {
            "feeLines": row.get("fee_lines").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
            "monthlyRecurringTotal": value_f64(&row, "monthly_recurring_total"),
            "totalMoveIn": value_f64(&row, "total_move_in"),
        },
        "availability": availability,
        "applications": {
            "total": applications_row.try_get::<i64, _>("total").unwrap_or(0),
            "open": applications_row.try_get::<i64, _>("open").unwrap_or(0),
            "latest": latest_applications,
        },
        "preview": preview,
    }))
}

pub async fn build_listing_preview(
    state: &AppState,
    pool: &sqlx::PgPool,
    listing_id: &str,
) -> AppResult<Value> {
    let row = get_listing_row_with_context(pool, listing_id).await?;
    let mut attached = attach_listing_fee_lines(pool, vec![row]).await?;
    let row = attached.pop().unwrap_or_else(|| Value::Object(Map::new()));
    Ok(public_listing_shape(state, &row))
}

pub fn public_listing_shape(state: &AppState, row: &Value) -> Value {
    let fee_lines = row
        .get("fee_lines")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    json!({
        "id": row.get("id").cloned().unwrap_or(Value::Null),
        "organization_id": row.get("organization_id").cloned().unwrap_or(Value::Null),
        "organization_name": row.get("organization_name").cloned().unwrap_or(Value::Null),
        "organization_logo_url": row.get("organization_logo_url").cloned().unwrap_or(Value::Null),
        "organization_brand_color": row.get("organization_brand_color").cloned().unwrap_or(Value::Null),
        "host_name": row.get("host_name").cloned().unwrap_or(Value::Null),
        "organization_slug": row.get("organization_slug").cloned().unwrap_or(Value::Null),
        "booking_enabled": bool_value(row.get("booking_enabled")),
        "public_slug": row.get("public_slug").cloned().unwrap_or(Value::Null),
        "title": row.get("title").cloned().unwrap_or(Value::Null),
        "summary": row.get("summary").cloned().unwrap_or(Value::Null),
        "description": row.get("description").cloned().unwrap_or(Value::Null),
        "city": row.get("city").cloned().unwrap_or(Value::Null),
        "neighborhood": row.get("neighborhood").cloned().unwrap_or(Value::Null),
        "country_code": row.get("country_code").cloned().unwrap_or(Value::Null),
        "currency": row.get("currency").cloned().unwrap_or(Value::Null),
        "application_url": row.get("application_url").cloned().unwrap_or(Value::Null),
        "cover_image_url": row.get("cover_image_url").cloned().unwrap_or(Value::Null),
        "gallery_image_urls": normalize_gallery_urls(row.get("gallery_image_urls"), false).unwrap_or_default(),
        "floor_plans": normalize_spatial_assets(row.get("floor_plans"), "floor_plans", false).unwrap_or_default(),
        "virtual_tours": normalize_spatial_assets(row.get("virtual_tours"), "virtual_tours", false).unwrap_or_default(),
        "bedrooms": row.get("bedrooms").cloned().unwrap_or(Value::Null),
        "bathrooms": row.get("bathrooms").cloned().unwrap_or(Value::Null),
        "square_meters": row.get("square_meters").cloned().unwrap_or(Value::Null),
        "property_type": row.get("property_type").cloned().unwrap_or(Value::Null),
        "furnished": bool_value(row.get("furnished")),
        "pet_policy": row.get("pet_policy").cloned().unwrap_or(Value::Null),
        "parking_spaces": row.get("parking_spaces").cloned().unwrap_or(Value::Null),
        "minimum_lease_months": row.get("minimum_lease_months").cloned().unwrap_or(Value::Null),
        "available_from": row.get("available_from").cloned().unwrap_or(Value::Null),
        "amenities": normalize_amenities(row.get("amenities"), false).unwrap_or_default(),
        "poi_context": normalize_poi_context(row.get("poi_context"), false).unwrap_or_else(|_| json!({})),
        "walkability_score": row.get("walkability_score").cloned().unwrap_or(Value::Null),
        "transit_score": row.get("transit_score").cloned().unwrap_or(Value::Null),
        "private_space_summary": row.get("private_space_summary").cloned().unwrap_or(Value::Null),
        "shared_space_summary": row.get("shared_space_summary").cloned().unwrap_or(Value::Null),
        "maintenance_fee": row.get("maintenance_fee").cloned().unwrap_or(Value::Null),
        "whatsapp_contact_url": whatsapp_contact_url(state),
        "published_at": row.get("published_at").cloned().unwrap_or(Value::Null),
        "total_move_in": row.get("total_move_in").cloned().unwrap_or(Value::Null),
        "monthly_recurring_total": row.get("monthly_recurring_total").cloned().unwrap_or(Value::Null),
        "fee_lines": fee_lines,
        "fee_breakdown_complete": bool_value(row.get("fee_breakdown_complete")),
        "missing_required_fee_lines": row.get("missing_required_fee_lines").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "property_id": row.get("property_id").cloned().unwrap_or(Value::Null),
        "unit_id": row.get("unit_id").cloned().unwrap_or(Value::Null),
        "created_at": row.get("created_at").cloned().unwrap_or(Value::Null),
    })
}

pub fn listing_lifecycle_state(state: &AppState, row: &Value) -> String {
    if bool_value(row.get("is_published")) {
        return "published".to_string();
    }

    let has_cover = !missing_or_blank(row, "cover_image_url");
    let fee_complete = row
        .get("fee_breakdown_complete")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let publishable = is_publishable(state, row);

    if publishable {
        return "ready_to_publish".to_string();
    }
    if !has_cover || (state.config.transparent_pricing_required && !fee_complete) {
        return "blocked".to_string();
    }
    "draft".to_string()
}

fn listing_readiness_report(row: &Value) -> Value {
    let obj = row.as_object().cloned().unwrap_or_default();
    let report = compute_readiness_report(&obj);
    json!({
        "score": report.score,
        "blocking": report.blocking,
        "issues": report
            .issues
            .into_iter()
            .filter(|issue| !issue.satisfied)
            .collect::<Vec<_>>(),
    })
}

fn is_publishable(state: &AppState, row: &Value) -> bool {
    let has_cover = !missing_or_blank(row, "cover_image_url");
    let available_from = !missing_or_blank(row, "available_from");
    let minimum_lease_months = value_i64(row, "minimum_lease_months") > 0;
    let amenities = row
        .get("amenities")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    let fee_complete = row
        .get("fee_breakdown_complete")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    has_cover
        && available_from
        && minimum_lease_months
        && amenities >= 3
        && (!state.config.transparent_pricing_required || fee_complete)
}

async fn list_admin_listing_rows(
    pool: &sqlx::PgPool,
    query: &ListingsOverviewQuery,
) -> AppResult<Vec<Value>> {
    let org_id = parse_uuid(&query.org_id, "org_id")?;
    let mut builder = QueryBuilder::<Postgres>::new(
        "SELECT row_to_json(t) AS row FROM (
            SELECT l.*, p.name AS property_name, u.name AS unit_name, pt.name AS pricing_template_label,
                   COALESCE(app_stats.total_applications, 0) AS application_count,
                   COALESCE(app_stats.open_applications, 0) AS open_application_count,
                   app_stats.latest_application_at
            FROM listings l
            LEFT JOIN properties p ON p.id = l.property_id
            LEFT JOIN units u ON u.id = l.unit_id
            LEFT JOIN pricing_templates pt ON pt.id = l.pricing_template_id
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS total_applications,
                       COUNT(*) FILTER (
                         WHERE status NOT IN ('rejected', 'lost', 'contract_signed')
                       )::int AS open_applications,
                       MAX(updated_at) AS latest_application_at
                FROM application_submissions
                WHERE listing_id = l.id
            ) app_stats ON TRUE
            WHERE l.organization_id = ",
    );
    builder.push_bind(org_id);

    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        builder
            .push(" AND l.property_id = ")
            .push_bind(parse_uuid(&property_id, "property_id")?);
    }
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        builder
            .push(" AND l.unit_id = ")
            .push_bind(parse_uuid(&unit_id, "unit_id")?);
    }
    if let Some(published) = normalized_published_filter(query.published_state.as_deref()) {
        builder.push(" AND l.is_published = ").push_bind(published);
    }
    if let Some(q) = non_empty_opt(query.q.as_deref()) {
        let needle = format!("%{}%", q.to_ascii_lowercase());
        builder
            .push(" AND (lower(coalesce(l.title, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(coalesce(l.public_slug, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(coalesce(l.city, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(coalesce(p.name, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(coalesce(u.name, '')) LIKE ")
            .push_bind(needle)
            .push(")");
    }

    builder.push(" ORDER BY ");
    builder.push(admin_sort_sql(query.sort.as_deref()));
    builder.push(" LIMIT ").push_bind(OVERVIEW_ROW_CAP);
    builder.push(") t");

    let rows = builder
        .build()
        .fetch_all(pool)
        .await
        .map_err(map_db_error)?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect())
}

fn to_overview_row(row: &Value, lifecycle: &str, readiness: &Value) -> Value {
    json!({
        "id": value_str(row, "id"),
        "title": value_str(row, "title"),
        "publicSlug": value_str(row, "public_slug"),
        "propertyId": value_null_or_string(row, "property_id"),
        "propertyName": value_null_or_string(row, "property_name"),
        "unitId": value_null_or_string(row, "unit_id"),
        "unitName": value_null_or_string(row, "unit_name"),
        "isPublished": bool_value(row.get("is_published")),
        "lifecycleState": lifecycle,
        "readinessScore": readiness.get("score").cloned().unwrap_or_else(|| json!(0)),
        "readinessBlocking": readiness
            .get("issues")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|issue| {
                issue
                    .get("field")
                    .and_then(Value::as_str)
                    .map(|field| field.to_string())
            })
            .collect::<Vec<_>>(),
        "currency": value_str(row, "currency"),
        "monthlyRecurringTotal": value_f64(row, "monthly_recurring_total"),
        "totalMoveIn": value_f64(row, "total_move_in"),
        "availableFrom": value_null_or_string(row, "available_from"),
        "applicationCount": value_i64(row, "application_count"),
        "updatedAt": value_null_or_string(row, "updated_at"),
        "primaryHref": format!("/module/listings/{}", value_str(row, "id")),
        "previewHref": format!("/module/listings/{}?preview=1", value_str(row, "id")),
        "publicHref": public_href(row),
    })
}

fn public_href(row: &Value) -> Value {
    if !bool_value(row.get("is_published")) {
        return Value::Null;
    }
    let slug = value_str(row, "public_slug");
    if slug.is_empty() {
        return Value::Null;
    }
    Value::String(format!("/marketplace/{slug}"))
}

fn normalized_lifecycle_filter(value: Option<&str>) -> Option<String> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some("draft") => Some("draft".to_string()),
        Some("ready_to_publish") => Some("ready_to_publish".to_string()),
        Some("published") => Some("published".to_string()),
        Some("blocked") => Some("blocked".to_string()),
        _ => None,
    }
}

fn normalized_view_filter(value: Option<&str>) -> Option<String> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some("all") | None => None,
        Some(view) => Some(view.to_string()),
    }
}

fn matches_overview_view(
    view: &str,
    lifecycle: &str,
    has_cover: bool,
    has_applications: bool,
) -> bool {
    match view {
        "drafts" => lifecycle == "draft",
        "ready_to_publish" => lifecycle == "ready_to_publish",
        "live" => lifecycle == "published",
        "needs_media" => !has_cover,
        "has_applications" => has_applications,
        _ => true,
    }
}

fn normalized_published_filter(value: Option<&str>) -> Option<bool> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some("published") | Some("live") | Some("true") => Some(true),
        Some("draft") | Some("unpublished") | Some("false") => Some(false),
        _ => None,
    }
}

fn admin_sort_sql(value: Option<&str>) -> &'static str {
    match value.map(str::trim).unwrap_or("updated_desc") {
        "title_asc" => "lower(coalesce(l.title, '')) ASC, l.updated_at DESC",
        "title_desc" => "lower(coalesce(l.title, '')) DESC, l.updated_at DESC",
        "monthly_desc" => "l.monthly_recurring_total DESC NULLS LAST, l.updated_at DESC",
        "monthly_asc" => "l.monthly_recurring_total ASC NULLS LAST, l.updated_at DESC",
        "applications_desc" => "app_stats.total_applications DESC NULLS LAST, l.updated_at DESC",
        "created_desc" => "l.created_at DESC",
        "created_asc" => "l.created_at ASC",
        _ => "l.updated_at DESC",
    }
}

fn parse_uuid(value: &str, field: &str) -> AppResult<uuid::Uuid> {
    uuid::Uuid::parse_str(value)
        .map_err(|_| AppError::BadRequest(format!("Invalid {field} format.")))
}

fn value_null_or_string(row: &Value, key: &str) -> Value {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| Value::String(value.to_string()))
        .unwrap_or(Value::Null)
}

fn value_i64(row: &Value, key: &str) -> i64 {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(|value| match value {
            Value::Number(number) => number.as_i64(),
            Value::String(text) => text.trim().parse::<i64>().ok(),
            _ => None,
        })
        .unwrap_or(0)
}

fn value_f64(row: &Value, key: &str) -> f64 {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(|value| match value {
            Value::Number(number) => number.as_f64(),
            Value::String(text) => text.trim().parse::<f64>().ok(),
            _ => None,
        })
        .unwrap_or(0.0)
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

fn missing_or_blank(row: &Value, key: &str) -> bool {
    row.get(key)
        .map(|value| match value {
            Value::Null => true,
            Value::String(text) => text.trim().is_empty(),
            _ => false,
        })
        .unwrap_or(true)
}

fn map_db_error(error: sqlx::Error) -> AppError {
    tracing::error!(db_error = %error, "Listings query failed");
    AppError::from_database_error(&error, "Database operation failed.")
}

fn whatsapp_contact_url(state: &AppState) -> Value {
    let normalized = state
        .config
        .marketplace_whatsapp_phone_e164
        .as_deref()
        .and_then(normalize_whatsapp_phone);
    normalized
        .map(|phone| Value::String(format!("https://wa.me/{phone}")))
        .unwrap_or(Value::Null)
}

fn normalize_whatsapp_phone(value: &str) -> Option<String> {
    let digits = value
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        return None;
    }
    Some(digits)
}

fn normalize_spatial_assets(
    value: Option<&Value>,
    field: &str,
    strict: bool,
) -> AppResult<Vec<String>> {
    let Some(raw) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = raw.as_array() else {
        return if strict {
            Err(AppError::BadRequest(format!("{field} must be an array.")))
        } else {
            Ok(Vec::new())
        };
    };

    let mut normalized = Vec::new();
    for item in items {
        let Some(text) = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            if strict {
                return Err(AppError::BadRequest(format!(
                    "{field} entries must be non-empty strings."
                )));
            }
            continue;
        };
        normalized.push(text.to_string());
        if normalized.len() == MAX_SPATIAL_ASSETS {
            break;
        }
    }
    Ok(normalized)
}

fn normalize_poi_context(value: Option<&Value>, strict: bool) -> AppResult<Value> {
    match value {
        None | Some(Value::Null) => Ok(json!({})),
        Some(Value::Object(object)) => Ok(Value::Object(object.clone())),
        Some(_) if strict => Err(AppError::BadRequest(
            "poi_context must be an object.".to_string(),
        )),
        Some(_) => Ok(json!({})),
    }
}

fn normalize_gallery_urls(value: Option<&Value>, strict: bool) -> AppResult<Vec<String>> {
    let Some(raw) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = raw.as_array() else {
        return if strict {
            Err(AppError::BadRequest(
                "gallery_image_urls must be an array.".to_string(),
            ))
        } else {
            Ok(Vec::new())
        };
    };

    let mut normalized = Vec::new();
    for item in items {
        let Some(text) = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            if strict {
                return Err(AppError::BadRequest(
                    "gallery_image_urls entries must be non-empty strings.".to_string(),
                ));
            }
            continue;
        };
        normalized.push(text.to_string());
        if normalized.len() == MAX_GALLERY_IMAGES {
            break;
        }
    }
    Ok(normalized)
}

fn normalize_amenities(value: Option<&Value>, strict: bool) -> AppResult<Vec<String>> {
    let Some(raw) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = raw.as_array() else {
        return if strict {
            Err(AppError::BadRequest(
                "amenities must be an array.".to_string(),
            ))
        } else {
            Ok(Vec::new())
        };
    };

    let mut normalized = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in items {
        let Some(text) = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            if strict {
                return Err(AppError::BadRequest(
                    "amenities entries must be non-empty strings.".to_string(),
                ));
            }
            continue;
        };
        let key = text.to_ascii_lowercase();
        if seen.insert(key) {
            normalized.push(text.to_string());
        }
        if normalized.len() == MAX_AMENITIES {
            break;
        }
    }
    Ok(normalized)
}
