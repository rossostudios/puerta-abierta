use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::{Postgres, QueryBuilder, Row};

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{count_rows, create_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, validate_input, CreateListingInput, ListingPath, ListingsQuery,
        MarketplaceInquiryInput, PublicListingApplicationInput, PublicListingSlugPath,
        PublicListingsQuery, SlugAvailableQuery, UpdateListingInput,
    },
    services::{
        alerting::write_alert_event,
        analytics::write_analytics_event,
        audit::write_audit_log,
        pricing::{compute_pricing_totals, missing_required_fee_types, normalize_fee_lines},
        readiness::{compute_readiness_report, readiness_summary},
    },
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const MARKETPLACE_EDIT_ROLES: &[&str] = &["owner_admin", "operator"];
const MAX_GALLERY_IMAGES: usize = 8;
const MAX_SPATIAL_ASSETS: usize = 16;
const MAX_AMENITIES: usize = 24;

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/listings",
            axum::routing::get(list_listings).post(create_listing),
        )
        .route(
            "/listings/slug-available",
            axum::routing::get(slug_available),
        )
        .route(
            "/listings/{listing_id}",
            axum::routing::get(get_listing).patch(update_listing),
        )
        .route(
            "/listings/{listing_id}/readiness",
            axum::routing::get(listing_readiness),
        )
        .route(
            "/listings/{listing_id}/publish",
            axum::routing::post(publish_listing),
        )
        .route("/public/listings", axum::routing::get(list_public_listings))
        .route(
            "/public/listings/{slug}",
            axum::routing::get(get_public_listing),
        )
        .route(
            "/public/listings/{slug}/apply-start",
            axum::routing::post(start_public_listing_application),
        )
        .route(
            "/public/listings/{slug}/contact-whatsapp",
            axum::routing::post(track_public_listing_whatsapp_contact),
        )
        .route(
            "/public/listings/{slug}/availability",
            axum::routing::get(listing_availability),
        )
        .route(
            "/public/listings/{slug}/inquire",
            axum::routing::post(submit_inquiry),
        )
        .route(
            "/public/listings/applications",
            axum::routing::post(submit_public_listing_application),
        )
        .route(
            "/public/saved-searches",
            axum::routing::get(list_saved_searches)
                .post(create_saved_search)
                .delete(delete_saved_search),
        )
}

async fn list_listings(
    State(state): State<AppState>,
    Query(query): Query<ListingsQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(query.org_id.clone()),
    );
    if let Some(is_published) = query.is_published {
        filters.insert("is_published".to_string(), Value::Bool(is_published));
    }
    if let Some(ref status) = query.status {
        match status.as_str() {
            "published" => {
                filters.insert("is_published".to_string(), Value::Bool(true));
            }
            "draft" => {
                filters.insert("is_published".to_string(), Value::Bool(false));
            }
            _ => {}
        }
    }
    if let Some(integration_id) = non_empty_opt(query.integration_id.as_deref()) {
        filters.insert("integration_id".to_string(), Value::String(integration_id));
    }
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        filters.insert("unit_id".to_string(), Value::String(unit_id));
    }

    let page = query.page.max(1);
    let per_page = query.per_page.clamp(1, 100);
    let offset = (page - 1) * per_page;

    let sort_by =
        non_empty_opt(Some(query.sort_by.as_str())).unwrap_or_else(|| "created_at".to_string());
    let ascending = query.sort_order.eq_ignore_ascii_case("asc");

    let filters_for_total = filters.clone();
    let filters_for_rows = filters;
    let sort_by_for_rows = sort_by.clone();
    let (total, mut rows) = tokio::try_join!(
        async move { count_rows(pool, "listings", Some(&filters_for_total)).await },
        async move {
            list_rows(
                pool,
                "listings",
                Some(&filters_for_rows),
                per_page,
                offset,
                &sort_by_for_rows,
                ascending,
            )
            .await
        }
    )?;

    // Post-hoc text search filter
    if let Some(q) = non_empty_opt(query.q.as_deref()) {
        let needle = q.to_ascii_lowercase();
        rows.retain(|row| {
            value_str(row, "title")
                .to_ascii_lowercase()
                .contains(&needle)
                || value_str(row, "city")
                    .to_ascii_lowercase()
                    .contains(&needle)
                || value_str(row, "property_type")
                    .to_ascii_lowercase()
                    .contains(&needle)
        });
    }

    let mut attached = attach_fee_lines(pool, rows).await?;

    // Inject readiness into each row
    for row in &mut attached {
        if let Some(obj) = row.as_object_mut() {
            let (score, blocking) = readiness_summary(obj);
            obj.insert("readiness_score".to_string(), json!(score));
            obj.insert(
                "readiness_blocking".to_string(),
                Value::Array(blocking.into_iter().map(Value::String).collect()),
            );
        }
    }

    Ok(Json(json!({
        "data": attached,
        "total": total,
        "page": page,
        "per_page": per_page,
    })))
}

async fn create_listing(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateListingInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        MARKETPLACE_EDIT_ROLES,
    )
    .await?;
    let pool = db_pool(&state)?;

    let mut listing_payload = remove_nulls(serialize_payload(&payload));
    listing_payload.remove("fee_lines");
    listing_payload = sanitize_listing_payload(listing_payload, false)?;
    listing_payload.insert(
        "created_by_user_id".to_string(),
        Value::String(user_id.clone()),
    );

    if let Some(integration_id) = listing_payload
        .get("integration_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let integration = get_row(pool, "integrations", integration_id, "id").await?;
        if value_str(&integration, "organization_id") != payload.organization_id {
            return Err(AppError::BadRequest(
                "integration_id does not belong to this organization.".to_string(),
            ));
        }
    }

    if let Some(unit_id) = listing_payload
        .get("unit_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let unit = get_row(pool, "units", unit_id, "id").await?;
        if value_str(&unit, "organization_id") != payload.organization_id {
            return Err(AppError::BadRequest(
                "unit_id does not belong to this organization.".to_string(),
            ));
        }
        if missing_or_blank_map(&listing_payload, "property_id") {
            if let Some(property_id) = unit
                .as_object()
                .and_then(|obj| obj.get("property_id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                listing_payload.insert(
                    "property_id".to_string(),
                    Value::String(property_id.to_string()),
                );
            }
        }
        if !listing_payload.contains_key("bedrooms")
            || listing_payload.get("bedrooms").is_some_and(Value::is_null)
        {
            listing_payload.insert(
                "bedrooms".to_string(),
                unit.get("bedrooms").cloned().unwrap_or(Value::Null),
            );
        }
        if !listing_payload.contains_key("bathrooms")
            || listing_payload.get("bathrooms").is_some_and(Value::is_null)
        {
            listing_payload.insert(
                "bathrooms".to_string(),
                unit.get("bathrooms").cloned().unwrap_or(Value::Null),
            );
        }
        if !listing_payload.contains_key("square_meters")
            || listing_payload
                .get("square_meters")
                .is_some_and(Value::is_null)
        {
            listing_payload.insert(
                "square_meters".to_string(),
                unit.get("square_meters").cloned().unwrap_or(Value::Null),
            );
        }
    }

    if let Some(property_id) = listing_payload
        .get("property_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let property = get_row(pool, "properties", property_id, "id").await?;
        if value_str(&property, "organization_id") != payload.organization_id {
            return Err(AppError::BadRequest(
                "property_id does not belong to this organization.".to_string(),
            ));
        }
        for field in ["city", "neighborhood"] {
            if missing_or_blank_map(&listing_payload, field) {
                if let Some(val) = property.get(field).filter(|v| !v.is_null()) {
                    listing_payload.insert(field.to_string(), val.clone());
                }
            }
        }
    }

    let created = create_row(pool, "listings", &listing_payload).await?;
    let listing_id = value_str(&created, "id");

    let mut source_lines = payload
        .fee_lines
        .iter()
        .filter_map(|line| serde_json::to_value(line).ok())
        .collect::<Vec<_>>();
    if source_lines.is_empty() {
        if let Some(template_id) = non_empty_opt(payload.pricing_template_id.as_deref()) {
            source_lines = template_lines(pool, &payload.organization_id, &template_id).await?;
        }
    }
    let created_lines =
        replace_fee_lines(pool, &payload.organization_id, &listing_id, &source_lines).await?;

    let mut audit_after = created.as_object().cloned().unwrap_or_default();
    audit_after.insert("fee_lines".to_string(), Value::Array(created_lines));
    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "listings",
        Some(&listing_id),
        None,
        Some(Value::Object(audit_after)),
    )
    .await;
    state.public_listings_cache.clear().await;

    let mut rows = attach_fee_lines(pool, vec![created]).await?;
    let item = rows.pop().unwrap_or_else(|| Value::Object(Map::new()));
    Ok((axum::http::StatusCode::CREATED, Json(item)))
}

async fn get_listing(
    State(state): State<AppState>,
    Path(path): Path<ListingPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "listings", &path.listing_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let mut rows = attach_fee_lines(pool, vec![record]).await?;
    Ok(Json(
        rows.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn update_listing(
    State(state): State<AppState>,
    Path(path): Path<ListingPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateListingInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "listings", &path.listing_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, MARKETPLACE_EDIT_ROLES).await?;

    let mut patch = remove_nulls(serialize_payload(&payload));
    patch.remove("fee_lines");
    patch = sanitize_listing_payload(patch, false)?;

    if let Some(integration_id) = patch
        .get("integration_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let integration = get_row(pool, "integrations", integration_id, "id").await?;
        if value_str(&integration, "organization_id") != org_id {
            return Err(AppError::BadRequest(
                "integration_id does not belong to this organization.".to_string(),
            ));
        }
    }

    if let Some(unit_id) = patch
        .get("unit_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let unit = get_row(pool, "units", unit_id, "id").await?;
        if value_str(&unit, "organization_id") != org_id {
            return Err(AppError::BadRequest(
                "unit_id does not belong to this organization.".to_string(),
            ));
        }
        if missing_or_blank_map(&patch, "property_id") {
            if let Some(property_id) = unit
                .as_object()
                .and_then(|obj| obj.get("property_id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                patch.insert(
                    "property_id".to_string(),
                    Value::String(property_id.to_string()),
                );
            }
        }
        if !patch.contains_key("bedrooms") {
            patch.insert(
                "bedrooms".to_string(),
                unit.get("bedrooms").cloned().unwrap_or(Value::Null),
            );
        }
        if !patch.contains_key("bathrooms") {
            patch.insert(
                "bathrooms".to_string(),
                unit.get("bathrooms").cloned().unwrap_or(Value::Null),
            );
        }
        if !patch.contains_key("square_meters") {
            patch.insert(
                "square_meters".to_string(),
                unit.get("square_meters").cloned().unwrap_or(Value::Null),
            );
        }
    }

    if let Some(property_id) = patch
        .get("property_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let property = get_row(pool, "properties", property_id, "id").await?;
        if value_str(&property, "organization_id") != org_id {
            return Err(AppError::BadRequest(
                "property_id does not belong to this organization.".to_string(),
            ));
        }
        for field in ["city", "neighborhood"] {
            if !patch.contains_key(field) {
                if let Some(val) = property.get(field).filter(|v| !v.is_null()) {
                    patch.insert(field.to_string(), val.clone());
                }
            }
        }
    }

    let mut updated = record.clone();
    if !patch.is_empty() {
        updated = update_row(pool, "listings", &path.listing_id, &patch, "id").await?;
    }

    if let Some(fee_lines) = payload.fee_lines.as_ref() {
        let lines = fee_lines
            .iter()
            .filter_map(|line| serde_json::to_value(line).ok())
            .collect::<Vec<_>>();
        let _ = replace_fee_lines(pool, &org_id, &path.listing_id, &lines).await?;
    }

    if payload.is_published == Some(true) {
        assert_publishable(&state, pool, &updated).await?;
    }

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "listings",
        Some(&path.listing_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;
    state.public_listings_cache.clear().await;

    if bool_value(updated.get("is_published")) {
        sync_linked_listing(pool, &updated, true).await;
    }

    let mut rows = attach_fee_lines(pool, vec![updated]).await?;
    Ok(Json(
        rows.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn publish_listing(
    State(state): State<AppState>,
    Path(path): Path<ListingPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "listings", &path.listing_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, MARKETPLACE_EDIT_ROLES).await?;

    assert_publishable(&state, pool, &record).await?;

    let patch = json_map(&[
        ("is_published", Value::Bool(true)),
        ("published_at", Value::String(Utc::now().to_rfc3339())),
    ]);
    let updated = update_row(pool, "listings", &path.listing_id, &patch, "id").await?;

    sync_linked_listing(pool, &updated, true).await;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "status_transition",
        "listings",
        Some(&path.listing_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;
    state.public_listings_cache.clear().await;

    let mut rows = attach_fee_lines(pool, vec![updated]).await?;
    Ok(Json(
        rows.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn list_public_listings(
    State(state): State<AppState>,
    Query(query): Query<PublicListingsQuery>,
) -> AppResult<Json<Value>> {
    ensure_marketplace_public_enabled(&state)?;
    let cache_key = public_listings_cache_key(&query);
    if let Some(cached) = state.public_listings_cache.get(&cache_key).await {
        return Ok(Json(cached));
    }

    let key_lock = state.public_listings_cache.key_lock(&cache_key).await;
    let _guard = key_lock.lock().await;

    if let Some(cached) = state.public_listings_cache.get(&cache_key).await {
        return Ok(Json(cached));
    }

    let pool = db_pool(&state)?;
    let rows = list_public_listing_rows(pool, &query).await?;

    let shaped = rows
        .iter()
        .map(|row| public_shape(&state, row))
        .collect::<Vec<_>>();
    let response = json!({ "data": shaped });
    state
        .public_listings_cache
        .put(cache_key, response.clone())
        .await;
    Ok(Json(response))
}

async fn list_public_listing_rows(
    pool: &sqlx::PgPool,
    query: &PublicListingsQuery,
) -> AppResult<Vec<Value>> {
    let mut builder = QueryBuilder::<Postgres>::new(
        "SELECT row_to_json(t) AS row FROM listings t WHERE t.is_published = true",
    );

    if let Some(org_id) = non_empty_opt(query.org_id.as_deref()) {
        let parsed = uuid::Uuid::parse_str(&org_id)
            .map_err(|_| AppError::BadRequest("Invalid org_id format.".to_string()))?;
        builder.push(" AND t.organization_id = ").push_bind(parsed);
    }
    if let Some(city) = non_empty_opt(query.city.as_deref()) {
        builder
            .push(" AND lower(t.city) = ")
            .push_bind(city.to_ascii_lowercase());
    }
    if let Some(neighborhood) = non_empty_opt(query.neighborhood.as_deref()) {
        builder
            .push(" AND lower(coalesce(t.neighborhood, '')) LIKE ")
            .push_bind(format!("%{}%", neighborhood.to_ascii_lowercase()));
    }
    if let Some(q) = non_empty_opt(query.q.as_deref()) {
        let needle = format!("%{}%", q.to_ascii_lowercase());
        builder
            .push(" AND (lower(coalesce(t.title, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(coalesce(t.summary, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(coalesce(t.neighborhood, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(coalesce(t.description, '')) LIKE ")
            .push_bind(needle)
            .push(")");
    }
    if let Some(property_type) = non_empty_opt(query.property_type.as_deref()) {
        builder
            .push(" AND lower(coalesce(t.property_type, '')) = ")
            .push_bind(property_type.to_ascii_lowercase());
    }
    if let Some(furnished) = query.furnished {
        builder.push(" AND t.furnished = ").push_bind(furnished);
    }
    if let Some(pet_policy) = non_empty_opt(query.pet_policy.as_deref()) {
        builder
            .push(" AND lower(coalesce(t.pet_policy, '')) LIKE ")
            .push_bind(format!("%{}%", pet_policy.to_ascii_lowercase()));
    }
    if let Some(min_parking) = query.min_parking {
        builder
            .push(" AND coalesce(t.parking_spaces, 0) >= ")
            .push_bind(min_parking);
    }
    if let Some(min_bedrooms) = query.min_bedrooms {
        builder
            .push(" AND coalesce(t.bedrooms, 0) >= ")
            .push_bind(min_bedrooms);
    }
    if let Some(min_bathrooms) = query.min_bathrooms {
        builder
            .push(" AND coalesce(t.bathrooms, 0) >= ")
            .push_bind(min_bathrooms);
    }
    if let Some(min_monthly) = query.min_monthly {
        builder
            .push(" AND coalesce(t.monthly_recurring_total, 0) >= ")
            .push_bind(min_monthly);
    }
    if let Some(max_monthly) = query.max_monthly {
        builder
            .push(" AND coalesce(t.monthly_recurring_total, 0) <= ")
            .push_bind(max_monthly);
    }
    if let Some(min_move_in) = query.min_move_in {
        builder
            .push(" AND coalesce(t.total_move_in, 0) >= ")
            .push_bind(min_move_in);
    }
    if let Some(max_move_in) = query.max_move_in {
        builder
            .push(" AND coalesce(t.total_move_in, 0) <= ")
            .push_bind(max_move_in);
    }

    builder
        .push(" ORDER BY t.published_at DESC NULLS LAST, t.created_at DESC LIMIT ")
        .push_bind(clamp_limit_in_range(query.limit, 1, 200));

    let rows = builder.build().fetch_all(pool).await.map_err(|err| {
        tracing::error!(db_error = %err, "Failed listing query");
        AppError::Dependency("Database operation failed.".to_string())
    })?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .collect())
}

async fn get_public_listing(
    State(state): State<AppState>,
    Path(path): Path<PublicListingSlugPath>,
) -> AppResult<Json<Value>> {
    ensure_marketplace_public_enabled(&state)?;
    let pool = db_pool(&state)?;

    let rows = list_rows(
        pool,
        "listings",
        Some(&json_map(&[
            ("public_slug", Value::String(path.slug.clone())),
            ("is_published", Value::Bool(true)),
        ])),
        1,
        0,
        "created_at",
        false,
    )
    .await?;
    if rows.is_empty() {
        return Err(AppError::NotFound("Public listing not found.".to_string()));
    }

    let mut attached = attach_fee_lines(pool, rows).await?;
    let shaped = public_shape(
        &state,
        &attached.pop().unwrap_or_else(|| Value::Object(Map::new())),
    );

    write_analytics_event(
        state.db_pool.as_ref(),
        Some(&value_str(&shaped, "organization_id")),
        "view",
        Some(json!({
            "listing_slug": path.slug,
            "listing_id": shaped.get("id").cloned().unwrap_or(Value::Null),
        })),
    )
    .await;

    Ok(Json(shaped))
}

/// Public availability calendar for a listing by slug.
async fn listing_availability(
    State(state): State<AppState>,
    Path(path): Path<PublicListingSlugPath>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    ensure_marketplace_public_enabled(&state)?;
    let pool = db_pool(&state)?;

    let month_str = query.get("month").cloned().unwrap_or_default();
    let month_first = NaiveDate::parse_from_str(&format!("{month_str}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid month format. Use YYYY-MM.".to_string()))?;

    // Look up the listing by slug
    let rows = list_rows(
        pool,
        "listings",
        Some(&json_map(&[
            ("public_slug", Value::String(path.slug.clone())),
            ("is_published", Value::Bool(true)),
        ])),
        1,
        0,
        "created_at",
        false,
    )
    .await?;
    if rows.is_empty() {
        return Err(AppError::NotFound("Public listing not found.".to_string()));
    }
    let listing = &rows[0];
    let org_id = value_str(listing, "organization_id");
    let unit_id = value_str(listing, "unit_id");

    if unit_id.is_empty() {
        return Ok(Json(json!({ "month": month_str, "days": [] })));
    }

    // Build 42-day grid
    use chrono::Datelike;
    let weekday = month_first.weekday().num_days_from_monday();
    let grid_start = month_first - chrono::Duration::days(weekday as i64);
    let grid_end = grid_start + chrono::Duration::days(42);

    // Fetch reservations
    let mut res_filters = Map::new();
    res_filters.insert("organization_id".to_string(), Value::String(org_id.clone()));
    res_filters.insert("unit_id".to_string(), Value::String(unit_id.clone()));
    let reservations = list_rows(
        pool,
        "reservations",
        Some(&res_filters),
        500,
        0,
        "check_in_date",
        true,
    )
    .await
    .unwrap_or_default();

    let active_statuses = ["pending", "confirmed", "checked_in"];
    let booked_ranges: Vec<(NaiveDate, NaiveDate)> = reservations
        .iter()
        .filter_map(|r| {
            let obj = r.as_object()?;
            let status = obj.get("status")?.as_str()?;
            if !active_statuses.contains(&status) {
                return None;
            }
            let ci =
                NaiveDate::parse_from_str(obj.get("check_in_date")?.as_str()?, "%Y-%m-%d").ok()?;
            let co =
                NaiveDate::parse_from_str(obj.get("check_out_date")?.as_str()?, "%Y-%m-%d").ok()?;
            if co <= grid_start || ci >= grid_end {
                return None;
            }
            Some((ci, co))
        })
        .collect();

    // Fetch calendar blocks
    let mut block_filters = Map::new();
    block_filters.insert("organization_id".to_string(), Value::String(org_id));
    block_filters.insert("unit_id".to_string(), Value::String(unit_id));
    let blocks = list_rows(
        pool,
        "calendar_blocks",
        Some(&block_filters),
        500,
        0,
        "start_date",
        true,
    )
    .await
    .unwrap_or_default();

    let blocked_ranges: Vec<(NaiveDate, NaiveDate)> = blocks
        .iter()
        .filter_map(|b| {
            let obj = b.as_object()?;
            let sd =
                NaiveDate::parse_from_str(obj.get("start_date")?.as_str()?, "%Y-%m-%d").ok()?;
            let ed = NaiveDate::parse_from_str(obj.get("end_date")?.as_str()?, "%Y-%m-%d").ok()?;
            if ed <= grid_start || sd >= grid_end {
                return None;
            }
            Some((sd, ed))
        })
        .collect();

    let today = Utc::now().date_naive();
    let mut days = Vec::new();
    let mut current = grid_start;
    while current < grid_end {
        let status = if current < today {
            "past"
        } else if booked_ranges
            .iter()
            .any(|(ci, co)| current >= *ci && current < *co)
        {
            "booked"
        } else if blocked_ranges
            .iter()
            .any(|(sd, ed)| current >= *sd && current < *ed)
        {
            "blocked"
        } else {
            "available"
        };
        days.push(json!({
            "date": current.to_string(),
            "status": status,
        }));
        current += chrono::Duration::days(1);
    }

    Ok(Json(json!({
        "month": month_str,
        "grid_start": grid_start.to_string(),
        "grid_end": grid_end.to_string(),
        "days": days,
    })))
}

async fn start_public_listing_application(
    State(state): State<AppState>,
    Path(path): Path<PublicListingSlugPath>,
) -> AppResult<Json<Value>> {
    ensure_marketplace_public_enabled(&state)?;
    let pool = db_pool(&state)?;

    let rows = list_rows(
        pool,
        "listings",
        Some(&json_map(&[
            ("public_slug", Value::String(path.slug.clone())),
            ("is_published", Value::Bool(true)),
        ])),
        1,
        0,
        "created_at",
        false,
    )
    .await?;
    if rows.is_empty() {
        return Err(AppError::NotFound("Public listing not found.".to_string()));
    }
    let listing = rows
        .first()
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));

    write_analytics_event(
        state.db_pool.as_ref(),
        Some(&value_str(&listing, "organization_id")),
        "apply_start",
        Some(json!({
            "listing_slug": path.slug,
            "listing_id": listing.get("id").cloned().unwrap_or(Value::Null),
        })),
    )
    .await;

    Ok(Json(json!({ "ok": true })))
}

async fn track_public_listing_whatsapp_contact(
    State(state): State<AppState>,
    Path(path): Path<PublicListingSlugPath>,
) -> AppResult<Json<Value>> {
    ensure_marketplace_public_enabled(&state)?;
    let pool = db_pool(&state)?;

    let rows = list_rows(
        pool,
        "listings",
        Some(&json_map(&[
            ("public_slug", Value::String(path.slug.clone())),
            ("is_published", Value::Bool(true)),
        ])),
        1,
        0,
        "created_at",
        false,
    )
    .await?;
    if rows.is_empty() {
        return Err(AppError::NotFound("Public listing not found.".to_string()));
    }
    let listing = rows
        .first()
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));

    write_analytics_event(
        state.db_pool.as_ref(),
        Some(&value_str(&listing, "organization_id")),
        "contact_whatsapp",
        Some(json!({
            "listing_slug": path.slug,
            "listing_id": listing.get("id").cloned().unwrap_or(Value::Null),
        })),
    )
    .await;

    Ok(Json(json!({
        "ok": true,
        "whatsapp_contact_url": whatsapp_contact_url(&state),
    })))
}

async fn submit_public_listing_application(
    State(state): State<AppState>,
    Json(payload): Json<PublicListingApplicationInput>,
) -> AppResult<impl IntoResponse> {
    validate_input(&payload)?;
    ensure_marketplace_public_enabled(&state)?;
    let pool = db_pool(&state)?;

    let listing = if let Some(listing_id) = non_empty_opt(payload.listing_id.as_deref()) {
        Some(get_row(pool, "listings", &listing_id, "id").await?)
    } else if let Some(slug) = non_empty_opt(payload.listing_slug.as_deref()) {
        let rows = list_rows(
            pool,
            "listings",
            Some(&json_map(&[("public_slug", Value::String(slug))])),
            1,
            0,
            "created_at",
            false,
        )
        .await?;
        rows.first().cloned()
    } else {
        None
    };

    let Some(listing) = listing else {
        return Err(AppError::BadRequest(
            "listing_id or listing_slug is required.".to_string(),
        ));
    };
    if !bool_value(listing.get("is_published")) {
        return Err(AppError::BadRequest(
            "Listing is not published.".to_string(),
        ));
    }

    let org_id = value_str(&listing, "organization_id");
    if org_id.is_empty() {
        return Err(AppError::BadRequest(
            "Listing is missing organization context.".to_string(),
        ));
    }

    let mut application_payload = remove_nulls(serialize_payload(&payload));
    application_payload.insert("organization_id".to_string(), Value::String(org_id.clone()));
    application_payload.insert(
        "listing_id".to_string(),
        listing.get("id").cloned().unwrap_or(Value::Null),
    );
    if !application_payload.contains_key("listing_slug") {
        if let Some(listing_slug) = listing
            .get("public_slug")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            application_payload.insert(
                "listing_slug".to_string(),
                Value::String(listing_slug.to_string()),
            );
        }
    }
    application_payload.remove("org_id");
    application_payload.remove("listing_slug");

    let alert_payload = json!({
        "stage": "application_submission",
        "listing_id": listing.get("id").cloned().unwrap_or(Value::Null),
        "listing_slug": listing.get("public_slug").cloned().unwrap_or(Value::Null),
        "source": application_payload.get("source").cloned().unwrap_or(Value::Null),
    });

    let created = match create_row(pool, "application_submissions", &application_payload).await {
        Ok(item) => item,
        Err(error) => {
            let mut failure_payload = alert_payload.as_object().cloned().unwrap_or_default();
            failure_payload.insert(
                "status_code".to_string(),
                json!(error.status_code().as_u16()),
            );
            write_alert_event(
                state.db_pool.as_ref(),
                Some(&org_id),
                "application_submit_failed",
                Some(Value::Object(failure_payload)),
                "error",
                Some(&error.detail_message()),
            )
            .await;
            return Err(error);
        }
    };

    let event_payload = json_map(&[
        ("organization_id", Value::String(org_id.clone())),
        (
            "application_id",
            created.get("id").cloned().unwrap_or(Value::Null),
        ),
        ("event_type", Value::String("apply_submit".to_string())),
        (
            "event_payload",
            json!({
                "listing_id": listing.get("id").cloned().unwrap_or(Value::Null),
                "listing_slug": listing.get("public_slug").cloned().unwrap_or(Value::Null),
                "source": created.get("source").cloned().unwrap_or(Value::Null),
            }),
        ),
    ]);
    if let Err(error) = create_row(pool, "application_events", &event_payload).await {
        write_alert_event(
            state.db_pool.as_ref(),
            Some(&org_id),
            "application_event_write_failed",
            Some(json!({
                "stage": "application_event_write",
                "listing_id": listing.get("id").cloned().unwrap_or(Value::Null),
                "listing_slug": listing.get("public_slug").cloned().unwrap_or(Value::Null),
                "application_id": created.get("id").cloned().unwrap_or(Value::Null),
            })),
            "warning",
            Some(&error.detail_message()),
        )
        .await;
    }

    write_analytics_event(
        state.db_pool.as_ref(),
        Some(&org_id),
        "apply_submit",
        Some(json!({
            "listing_id": listing.get("id").cloned().unwrap_or(Value::Null),
            "listing_slug": listing.get("public_slug").cloned().unwrap_or(Value::Null),
            "application_id": created.get("id").cloned().unwrap_or(Value::Null),
        })),
    )
    .await;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "id": created.get("id").cloned().unwrap_or(Value::Null),
            "status": created.get("status").cloned().unwrap_or(Value::Null),
            "listing_id": created
                .get("listing_id")
                .cloned()
                .unwrap_or(Value::Null),
        })),
    ))
}

async fn submit_inquiry(
    State(state): State<AppState>,
    Path(path): Path<PublicListingSlugPath>,
    Json(payload): Json<MarketplaceInquiryInput>,
) -> AppResult<impl IntoResponse> {
    validate_input(&payload)?;
    ensure_marketplace_public_enabled(&state)?;
    let pool = db_pool(&state)?;

    let rows = list_rows(
        pool,
        "listings",
        Some(&json_map(&[
            ("public_slug", Value::String(path.slug.clone())),
            ("is_published", Value::Bool(true)),
        ])),
        1,
        0,
        "created_at",
        false,
    )
    .await?;
    if rows.is_empty() {
        return Err(AppError::NotFound("Public listing not found.".to_string()));
    }
    let listing = rows
        .first()
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));

    let org_id = value_str(&listing, "organization_id");
    if org_id.is_empty() {
        return Err(AppError::BadRequest(
            "Listing is missing organization context.".to_string(),
        ));
    }

    let mut msg_payload = Map::new();
    msg_payload.insert("body".to_string(), Value::String(payload.message.clone()));
    msg_payload.insert(
        "subject".to_string(),
        Value::String(format!("Inquiry: {}", value_str(&listing, "title"))),
    );
    msg_payload.insert(
        "sender_name".to_string(),
        Value::String(payload.full_name.clone()),
    );
    msg_payload.insert(
        "sender_email".to_string(),
        Value::String(payload.email.clone()),
    );
    if let Some(phone) = &payload.phone_e164 {
        msg_payload.insert("sender_phone".to_string(), Value::String(phone.clone()));
    }
    msg_payload.insert("listing_slug".to_string(), Value::String(path.slug.clone()));
    msg_payload.insert(
        "listing_id".to_string(),
        listing.get("id").cloned().unwrap_or(Value::Null),
    );

    let mut log = Map::new();
    log.insert("organization_id".to_string(), Value::String(org_id.clone()));
    log.insert(
        "channel".to_string(),
        Value::String("marketplace".to_string()),
    );
    log.insert(
        "recipient".to_string(),
        Value::String(payload.email.clone()),
    );
    log.insert(
        "direction".to_string(),
        Value::String("inbound".to_string()),
    );
    log.insert("status".to_string(), Value::String("delivered".to_string()));
    log.insert(
        "sent_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );
    log.insert("payload".to_string(), Value::Object(msg_payload));

    let created = create_row(pool, "message_logs", &log).await?;

    write_analytics_event(
        state.db_pool.as_ref(),
        Some(&org_id),
        "marketplace_inquiry",
        Some(json!({
            "listing_slug": path.slug,
            "listing_id": listing.get("id").cloned().unwrap_or(Value::Null),
            "sender_email": payload.email,
        })),
    )
    .await;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "ok": true,
            "id": created.get("id").cloned().unwrap_or(Value::Null),
        })),
    ))
}

#[derive(Deserialize)]
struct SavedSearchQuery {
    visitor_id: String,
}

#[derive(Deserialize)]
struct CreateSavedSearchInput {
    visitor_id: String,
    name: String,
    filters: Value,
}

#[derive(Deserialize)]
struct DeleteSavedSearchInput {
    visitor_id: String,
    id: String,
}

async fn list_saved_searches(
    State(state): State<AppState>,
    Query(query): Query<SavedSearchQuery>,
) -> AppResult<Json<Value>> {
    ensure_marketplace_public_enabled(&state)?;
    let pool = db_pool(&state)?;

    let visitor_id = query.visitor_id.trim();
    if visitor_id.is_empty() {
        return Ok(Json(json!({ "data": [] })));
    }

    let rows = list_rows(
        pool,
        "saved_searches",
        Some(&json_map(&[(
            "visitor_id",
            Value::String(visitor_id.to_string()),
        )])),
        50,
        0,
        "created_at",
        false,
    )
    .await?;

    Ok(Json(json!({ "data": rows })))
}

async fn create_saved_search(
    State(state): State<AppState>,
    Json(payload): Json<CreateSavedSearchInput>,
) -> AppResult<impl IntoResponse> {
    ensure_marketplace_public_enabled(&state)?;
    let pool = db_pool(&state)?;

    let visitor_id = payload.visitor_id.trim();
    let name = payload.name.trim();
    if visitor_id.is_empty() || name.is_empty() {
        return Err(AppError::BadRequest(
            "visitor_id and name are required.".to_string(),
        ));
    }

    let record = json_map(&[
        ("visitor_id", Value::String(visitor_id.to_string())),
        ("name", Value::String(name.to_string())),
        ("filters", payload.filters),
    ]);

    let created = create_row(pool, "saved_searches", &record).await?;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn delete_saved_search(
    State(state): State<AppState>,
    Json(payload): Json<DeleteSavedSearchInput>,
) -> AppResult<Json<Value>> {
    ensure_marketplace_public_enabled(&state)?;
    let pool = db_pool(&state)?;

    let id = payload.id.trim();
    let visitor_id = payload.visitor_id.trim();
    if id.is_empty() || visitor_id.is_empty() {
        return Err(AppError::BadRequest(
            "id and visitor_id are required.".to_string(),
        ));
    }

    sqlx::query("DELETE FROM saved_searches WHERE id = $1 AND visitor_id = $2")
        .bind(id)
        .bind(visitor_id)
        .execute(pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Database query failed");
            AppError::Dependency("External service request failed.".to_string())
        })?;

    Ok(Json(json!({ "ok": true })))
}

async fn slug_available(
    State(state): State<AppState>,
    Query(query): Query<SlugAvailableQuery>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_member(&state, &user_id, &query.org_id).await?;
    let pool = db_pool(&state)?;

    let rows = list_rows(
        pool,
        "listings",
        Some(&json_map(&[
            ("public_slug", Value::String(query.slug.clone())),
            ("organization_id", Value::String(query.org_id.clone())),
        ])),
        1,
        0,
        "created_at",
        false,
    )
    .await?;

    let available = if let Some(existing) = rows.first() {
        if let Some(exclude_id) = &query.exclude_listing_id {
            value_str(existing, "id") == *exclude_id
        } else {
            false
        }
    } else {
        true
    };

    Ok(Json(json!({
        "available": available,
        "slug": query.slug,
    })))
}

async fn listing_readiness(
    State(state): State<AppState>,
    Path(path): Path<ListingPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "listings", &path.listing_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let mut rows = attach_fee_lines(pool, vec![record]).await?;
    let row = rows.pop().unwrap_or_else(|| Value::Object(Map::new()));
    let obj = row.as_object().cloned().unwrap_or_default();
    let report = compute_readiness_report(&obj);

    Ok(Json(json!(report)))
}

async fn replace_fee_lines(
    pool: &sqlx::PgPool,
    org_id: &str,
    listing_id: &str,
    lines: &[Value],
) -> AppResult<Vec<Value>> {
    sqlx::query("DELETE FROM listing_fee_lines WHERE listing_id = $1")
        .bind(listing_id)
        .execute(pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Database query failed");
            AppError::Dependency("External service request failed.".to_string())
        })?;

    let normalized = normalize_fee_lines(lines);
    let mut created_lines = Vec::new();
    for (index, line) in normalized.iter().enumerate() {
        let Some(obj) = line.as_object() else {
            continue;
        };
        let payload = json_map(&[
            ("organization_id", Value::String(org_id.to_string())),
            ("listing_id", Value::String(listing_id.to_string())),
            (
                "fee_type",
                obj.get("fee_type").cloned().unwrap_or(Value::Null),
            ),
            ("label", obj.get("label").cloned().unwrap_or(Value::Null)),
            ("amount", obj.get("amount").cloned().unwrap_or(Value::Null)),
            (
                "is_refundable",
                obj.get("is_refundable")
                    .cloned()
                    .unwrap_or(Value::Bool(false)),
            ),
            (
                "is_recurring",
                obj.get("is_recurring")
                    .cloned()
                    .unwrap_or(Value::Bool(false)),
            ),
            ("sort_order", json!((index + 1) as i32)),
        ]);
        let created = create_row(pool, "listing_fee_lines", &payload).await?;
        created_lines.push(created);
    }

    let totals = compute_pricing_totals(&created_lines);
    let pricing_patch = json_map(&[
        ("total_move_in", json!(totals.total_move_in)),
        (
            "monthly_recurring_total",
            json!(totals.monthly_recurring_total),
        ),
    ]);
    let _ = update_row(pool, "listings", listing_id, &pricing_patch, "id").await?;

    Ok(created_lines)
}

async fn template_lines(
    pool: &sqlx::PgPool,
    org_id: &str,
    template_id: &str,
) -> AppResult<Vec<Value>> {
    let rows = list_rows(
        pool,
        "pricing_template_lines",
        Some(&json_map(&[
            ("organization_id", Value::String(org_id.to_string())),
            (
                "pricing_template_id",
                Value::String(template_id.to_string()),
            ),
        ])),
        200,
        0,
        "sort_order",
        true,
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let obj = row.as_object().cloned().unwrap_or_default();
            json!({
                "fee_type": obj.get("fee_type").cloned().unwrap_or(Value::Null),
                "label": obj.get("label").cloned().unwrap_or(Value::Null),
                "amount": obj.get("amount").cloned().unwrap_or(Value::Null),
                "is_refundable": obj.get("is_refundable").cloned().unwrap_or(Value::Null),
                "is_recurring": obj.get("is_recurring").cloned().unwrap_or(Value::Null),
                "sort_order": obj.get("sort_order").cloned().unwrap_or(Value::Null),
            })
        })
        .collect())
}

async fn sync_linked_listing(pool: &sqlx::PgPool, row: &Value, is_publish_state: bool) {
    let integration_id = value_str(row, "integration_id");
    if integration_id.is_empty() {
        return;
    }

    let patch = json_map(&[
        ("marketplace_publishable", Value::Bool(is_publish_state)),
        (
            "public_slug",
            row.get("public_slug").cloned().unwrap_or(Value::Null),
        ),
    ]);
    let _ = update_row(pool, "integrations", &integration_id, &patch, "id").await;
}

async fn attach_fee_lines(pool: &sqlx::PgPool, rows: Vec<Value>) -> AppResult<Vec<Value>> {
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
                obj.insert(
                    "property_name".to_string(),
                    property_name
                        .get(property_id)
                        .cloned()
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                );
            }
            if let Some(unit_id) = obj
                .get("unit_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
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
        attached.push(row);
    }
    Ok(attached)
}

async fn assert_publishable(state: &AppState, pool: &sqlx::PgPool, row: &Value) -> AppResult<()> {
    let row_id = value_str(row, "id");
    if row_id.is_empty() {
        return Err(AppError::BadRequest("Invalid listing id.".to_string()));
    }

    let row_obj = row.as_object().cloned().unwrap_or_default();
    let _ = sanitize_listing_payload(row_obj, true)?;

    if !state.config.transparent_pricing_required {
        ensure_publish_prereqs(row)?;
        return Ok(());
    }

    let lines = list_rows(
        pool,
        "listing_fee_lines",
        Some(&json_map(&[("listing_id", Value::String(row_id))])),
        300,
        0,
        "sort_order",
        true,
    )
    .await?;
    let missing = missing_required_fee_types(&lines);
    if !missing.is_empty() {
        return Err(AppError::BadRequest(
            json!({
                "message": "Listing cannot be published without a full transparent fee breakdown.",
                "missing_required_fee_lines": missing,
            })
            .to_string(),
        ));
    }

    ensure_publish_prereqs(row)
}

fn ensure_publish_prereqs(row: &Value) -> AppResult<()> {
    if missing_or_blank(row, "available_from") {
        return Err(AppError::BadRequest(
            "available_from is required before publishing listings.".to_string(),
        ));
    }

    let minimum_lease_months = row
        .get("minimum_lease_months")
        .and_then(integer_strict_value);
    if minimum_lease_months.is_none_or(|value| value <= 0) {
        return Err(AppError::BadRequest(
            "minimum_lease_months is required before publishing listings.".to_string(),
        ));
    }

    let amenities = normalize_amenities(row.get("amenities"), false)?;
    if amenities.len() < 3 {
        return Err(AppError::BadRequest(
            "At least 3 amenities are required before publishing listings.".to_string(),
        ));
    }

    Ok(())
}

fn public_shape(state: &AppState, row: &Value) -> Value {
    let fee_lines = row
        .get("fee_lines")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    json!({
        "id": row.get("id").cloned().unwrap_or(Value::Null),
        "organization_id": row.get("organization_id").cloned().unwrap_or(Value::Null),
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
    })
}

fn public_listings_cache_key(query: &PublicListingsQuery) -> String {
    serde_json::to_string(query).unwrap_or_else(|_| "default".to_string())
}

fn sanitize_listing_payload(
    mut patch: Map<String, Value>,
    require_cover: bool,
) -> AppResult<Map<String, Value>> {
    if patch.contains_key("gallery_image_urls") {
        let gallery = normalize_gallery_urls(patch.get("gallery_image_urls"), true)?;
        patch.insert(
            "gallery_image_urls".to_string(),
            Value::Array(gallery.into_iter().map(Value::String).collect()),
        );
    }
    if patch.contains_key("amenities") {
        let amenities = normalize_amenities(patch.get("amenities"), true)?;
        patch.insert(
            "amenities".to_string(),
            Value::Array(amenities.into_iter().map(Value::String).collect()),
        );
    }
    if patch.contains_key("floor_plans") {
        let floor_plans = normalize_spatial_assets(patch.get("floor_plans"), "floor_plans", true)?;
        patch.insert(
            "floor_plans".to_string(),
            Value::Array(floor_plans.into_iter().map(Value::String).collect()),
        );
    }
    if patch.contains_key("virtual_tours") {
        let virtual_tours =
            normalize_spatial_assets(patch.get("virtual_tours"), "virtual_tours", true)?;
        patch.insert(
            "virtual_tours".to_string(),
            Value::Array(virtual_tours.into_iter().map(Value::String).collect()),
        );
    }
    if patch.contains_key("poi_context") {
        let context = normalize_poi_context(patch.get("poi_context"), true)?;
        patch.insert("poi_context".to_string(), context);
    }

    trim_to_optional_string(&mut patch, "cover_image_url");
    trim_to_optional_string(&mut patch, "property_type");
    trim_to_optional_string(&mut patch, "pet_policy");
    trim_to_optional_string(&mut patch, "private_space_summary");
    trim_to_optional_string(&mut patch, "shared_space_summary");

    if patch.contains_key("available_from") {
        let normalized = normalize_iso_date(patch.get("available_from"), "available_from")?;
        patch.insert(
            "available_from".to_string(),
            normalized.map(Value::String).unwrap_or(Value::Null),
        );
    }
    if patch.contains_key("walkability_score") {
        let normalized = normalize_score(patch.get("walkability_score"), "walkability_score")?;
        patch.insert(
            "walkability_score".to_string(),
            normalized.map(|value| json!(value)).unwrap_or(Value::Null),
        );
    }
    if patch.contains_key("transit_score") {
        let normalized = normalize_score(patch.get("transit_score"), "transit_score")?;
        patch.insert(
            "transit_score".to_string(),
            normalized.map(|value| json!(value)).unwrap_or(Value::Null),
        );
    }
    if patch.contains_key("maintenance_fee")
        && patch.get("maintenance_fee").is_some_and(Value::is_null)
    {
        patch.insert("maintenance_fee".to_string(), json!(0));
    }

    if require_cover {
        let has_cover = patch
            .get("cover_image_url")
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        if !has_cover {
            return Err(AppError::BadRequest(
                "cover_image_url is required before publishing listings.".to_string(),
            ));
        }
    }
    Ok(patch)
}

fn normalize_spatial_assets(
    value: Option<&Value>,
    field_name: &str,
    strict: bool,
) -> AppResult<Vec<String>> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        if strict {
            return Err(AppError::BadRequest(format!(
                "{field_name} must be an array."
            )));
        }
        return Ok(Vec::new());
    };

    let mut cleaned = items
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if cleaned.len() > MAX_SPATIAL_ASSETS {
        if strict {
            return Err(AppError::BadRequest(format!(
                "{field_name} supports up to {MAX_SPATIAL_ASSETS} items."
            )));
        }
        cleaned.truncate(MAX_SPATIAL_ASSETS);
    }
    Ok(cleaned)
}

fn normalize_poi_context(value: Option<&Value>, strict: bool) -> AppResult<Value> {
    let Some(value) = value else {
        return Ok(json!({}));
    };
    if value.is_null() {
        return Ok(json!({}));
    }
    if !value.is_object() {
        if strict {
            return Err(AppError::BadRequest(
                "poi_context must be an object.".to_string(),
            ));
        }
        return Ok(json!({}));
    }
    Ok(value.clone())
}

fn normalize_score(value: Option<&Value>, field_name: &str) -> AppResult<Option<i64>> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let parsed = match value {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    };
    let Some(parsed) = parsed else {
        return Err(AppError::BadRequest(format!(
            "{field_name} must be a number between 0 and 100."
        )));
    };
    if !(0..=100).contains(&parsed) {
        return Err(AppError::BadRequest(format!(
            "{field_name} must be between 0 and 100."
        )));
    }
    Ok(Some(parsed))
}

fn normalize_gallery_urls(value: Option<&Value>, strict: bool) -> AppResult<Vec<String>> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        if strict {
            return Err(AppError::BadRequest(
                "gallery_image_urls must be an array.".to_string(),
            ));
        }
        return Ok(Vec::new());
    };

    let mut cleaned = items
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if cleaned.len() > MAX_GALLERY_IMAGES {
        if strict {
            return Err(AppError::BadRequest(format!(
                "gallery_image_urls supports up to {MAX_GALLERY_IMAGES} items."
            )));
        }
        cleaned.truncate(MAX_GALLERY_IMAGES);
    }
    Ok(cleaned)
}

fn normalize_amenities(value: Option<&Value>, strict: bool) -> AppResult<Vec<String>> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        if strict {
            return Err(AppError::BadRequest(
                "amenities must be an array.".to_string(),
            ));
        }
        return Ok(Vec::new());
    };

    let mut cleaned = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for item in items {
        let Some(raw) = item.as_str() else {
            continue;
        };
        let candidate = raw.trim();
        if candidate.is_empty() {
            continue;
        }
        let key = candidate.to_ascii_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        cleaned.push(candidate.to_string());
    }

    if cleaned.len() > MAX_AMENITIES {
        if strict {
            return Err(AppError::BadRequest(format!(
                "amenities supports up to {MAX_AMENITIES} items."
            )));
        }
        cleaned.truncate(MAX_AMENITIES);
    }
    Ok(cleaned)
}

fn normalize_iso_date(value: Option<&Value>, field_name: &str) -> AppResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let Some(text) = value.as_str() else {
        return Err(AppError::BadRequest(format!(
            "{field_name} must be a valid date (YYYY-MM-DD)."
        )));
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let parsed = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").map_err(|_| {
        AppError::BadRequest(format!("{field_name} must be a valid date (YYYY-MM-DD)."))
    })?;
    Ok(Some(parsed.to_string()))
}

fn trim_to_optional_string(map: &mut Map<String, Value>, key: &str) {
    if let Some(value) = map.get(key).cloned() {
        if let Some(text) = value.as_str() {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                map.insert(key.to_string(), Value::Null);
            } else {
                map.insert(key.to_string(), Value::String(trimmed.to_string()));
            }
        }
    }
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

fn ensure_marketplace_public_enabled(state: &AppState) -> AppResult<()> {
    if state.config.marketplace_public_enabled {
        return Ok(());
    }
    Err(AppError::NotFound(
        "Marketplace public endpoints are disabled.".to_string(),
    ))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

fn value_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn non_empty_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
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

fn integer_strict_value(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64(),
        _ => None,
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

fn missing_or_blank_map(map: &Map<String, Value>, key: &str) -> bool {
    map.get(key)
        .map(|value| match value {
            Value::Null => true,
            Value::String(text) => text.trim().is_empty(),
            _ => false,
        })
        .unwrap_or(true)
}

fn serialize_payload<T: serde::Serialize>(payload: &T) -> Map<String, Value> {
    serde_json::to_value(payload)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn remove_nulls(mut payload: Map<String, Value>) -> Map<String, Value> {
    payload.retain(|_, value| !value.is_null());
    payload
}

fn json_map(entries: &[(&str, Value)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert((*key).to_string(), value.clone());
    }
    map
}

#[cfg(test)]
mod tests {
    use super::{normalize_poi_context, normalize_score, normalize_spatial_assets};
    use serde_json::json;

    #[test]
    fn normalizes_spatial_assets() {
        let value = json!([
            " https://example.com/floor.png ",
            "",
            "https://example.com/tour"
        ]);
        let cleaned = normalize_spatial_assets(Some(&value), "floor_plans", true)
            .expect("expected valid assets");
        assert_eq!(cleaned.len(), 2);
        assert_eq!(cleaned[0], "https://example.com/floor.png");
    }

    #[test]
    fn validates_scores() {
        let ok = normalize_score(Some(&json!(87)), "walkability_score").expect("valid score");
        assert_eq!(ok, Some(87));
        assert!(normalize_score(Some(&json!(120)), "walkability_score").is_err());
    }

    #[test]
    fn validates_poi_context_shape() {
        let ok = normalize_poi_context(Some(&json!({"transit": []})), true)
            .expect("poi context object is valid");
        assert!(ok.is_object());
        assert!(normalize_poi_context(Some(&json!(["bad"])), true).is_err());
    }
}
