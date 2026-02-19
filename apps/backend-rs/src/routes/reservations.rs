use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::{Datelike, NaiveDate, NaiveTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use serde_json::{json, Map, Value};
use sha1::Digest;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, delete_row, get_row, list_rows, update_row},
    schemas::{
        clamp_limit_in_range, remove_nulls, serialize_to_map, AddReservationGuestInput,
        CreateReservationInput, DepositRefundInput, ReservationGuestPath, ReservationPath,
        ReservationStatusInput, ReservationsQuery, UpdateReservationInput,
    },
    services::{
        audit::write_audit_log, enrichment::enrich_reservations, sequences::enroll_in_sequences,
        workflows::fire_trigger,
    },
    state::AppState,
    tenancy::{assert_org_member, assert_org_role},
};

const ACTIVE_BOOKING_STATUSES: &[&str] = &["pending", "confirmed", "checked_in"];
const DEFAULT_ORG_TIMEZONE: &str = "America/Asuncion";
const AUTO_TURNOVER_TASK_TYPES: &[&str] = &["check_in", "check_out", "cleaning", "inspection"];

const AUTO_CLEANING_CHECKLIST: &[&str] = &[
    "Retirar basura y reponer bolsas.",
    "Cambiar sabanas y toallas.",
    "Desinfectar bano y cocina.",
    "Reponer amenities y consumibles.",
    "Registrar fotos del estado final.",
];
const AUTO_CHECK_IN_CHECKLIST: &[&str] = &[
    "Validar limpieza final y olor del ambiente.",
    "Confirmar acceso (llaves, cerradura o codigo).",
    "Verificar wifi, agua caliente y aire acondicionado.",
    "Enviar instrucciones de llegada al huesped.",
];
const AUTO_CHECK_OUT_CHECKLIST: &[&str] = &[
    "Confirmar hora estimada de salida.",
    "Solicitar reporte de incidentes del huesped.",
    "Verificar consumos o cargos pendientes.",
];
const AUTO_INSPECTION_CHECKLIST: &[&str] = &[
    "Inspeccionar danos visibles y faltantes.",
    "Registrar evidencias fotograficas.",
    "Crear ticket de mantenimiento si aplica.",
];

#[derive(Clone, Copy)]
struct TaskBlueprint {
    task_type: &'static str,
    title: &'static str,
    priority: &'static str,
    description: &'static str,
    date_field: &'static str,
    time_field: &'static str,
    fallback_time: &'static str,
    checklist: &'static [&'static str],
}

const CONFIRMED_BLUEPRINTS: &[TaskBlueprint] = &[TaskBlueprint {
    task_type: "check_in",
    title: "Preparar check-in",
    priority: "high",
    description: "Checklist operativo previo a la llegada del huesped.",
    date_field: "check_in_date",
    time_field: "check_in_time",
    fallback_time: "15:00:00",
    checklist: AUTO_CHECK_IN_CHECKLIST,
}];

const CHECKED_IN_BLUEPRINTS: &[TaskBlueprint] = &[TaskBlueprint {
    task_type: "check_out",
    title: "Planificar check-out",
    priority: "medium",
    description: "Asegurar salida ordenada y preparacion para turnover.",
    date_field: "check_out_date",
    time_field: "check_out_time",
    fallback_time: "11:00:00",
    checklist: AUTO_CHECK_OUT_CHECKLIST,
}];

const CHECKED_OUT_BLUEPRINTS: &[TaskBlueprint] = &[
    TaskBlueprint {
        task_type: "cleaning",
        title: "Turnover: limpieza",
        priority: "high",
        description: "Limpieza completa posterior al check-out.",
        date_field: "check_out_date",
        time_field: "check_out_time",
        fallback_time: "11:00:00",
        checklist: AUTO_CLEANING_CHECKLIST,
    },
    TaskBlueprint {
        task_type: "inspection",
        title: "Turnover: inspeccion",
        priority: "high",
        description: "Inspeccion de danos e inventario post estadia.",
        date_field: "check_out_date",
        time_field: "check_out_time",
        fallback_time: "13:00:00",
        checklist: AUTO_INSPECTION_CHECKLIST,
    },
];

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/reservations",
            axum::routing::get(list_reservations).post(create_reservation),
        )
        .route(
            "/reservations/{reservation_id}/refund-deposit",
            axum::routing::post(refund_deposit),
        )
        .route(
            "/reservations/{reservation_id}/guest-portal-link",
            axum::routing::post(send_guest_portal_link),
        )
        .route(
            "/reservations/{reservation_id}",
            axum::routing::get(get_reservation).patch(update_reservation),
        )
        .route(
            "/reservations/{reservation_id}/status",
            axum::routing::post(transition_status),
        )
        .route(
            "/reservations/{reservation_id}/guests",
            axum::routing::get(list_reservation_guests).post(add_reservation_guest),
        )
        .route(
            "/reservations/{reservation_id}/guests/{reservation_guest_id}",
            axum::routing::delete(remove_reservation_guest),
        )
}

async fn list_reservations(
    State(state): State<AppState>,
    Query(query): Query<ReservationsQuery>,
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
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        filters.insert("unit_id".to_string(), Value::String(unit_id));
    }
    if let Some(integration_id) = non_empty_opt(query.integration_id.as_deref()) {
        filters.insert("integration_id".to_string(), Value::String(integration_id));
    }
    if let Some(guest_id) = non_empty_opt(query.guest_id.as_deref()) {
        filters.insert("guest_id".to_string(), Value::String(guest_id));
    }
    if let Some(status) = non_empty_opt(query.status.as_deref()) {
        filters.insert("status".to_string(), Value::String(status));
    }

    let rows = list_rows(
        pool,
        "reservations",
        Some(&filters),
        clamp_limit_in_range(query.limit, 1, 1000),
        0,
        "check_in_date",
        true,
    )
    .await?;
    let enriched = enrich_reservations(pool, rows, &query.org_id).await?;
    Ok(Json(json!({ "data": enriched })))
}

async fn create_reservation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateReservationInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    assert_org_role(
        &state,
        &user_id,
        &payload.organization_id,
        &["owner_admin", "operator"],
    )
    .await?;
    let pool = db_pool(&state)?;

    if has_overlap(
        pool,
        &payload.unit_id,
        &payload.check_in_date,
        &payload.check_out_date,
        &payload.organization_id,
    )
    .await?
    {
        return Err(AppError::Conflict(
            "Reservation overlaps an existing active reservation.".to_string(),
        ));
    }

    let record = remove_nulls(serialize_to_map(&payload));
    let created = create_row(pool, "reservations", &record).await?;
    let entity_id = value_str(&created, "id");

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&payload.organization_id),
        Some(&user_id),
        "create",
        "reservations",
        Some(&entity_id),
        None,
        Some(created.clone()),
    )
    .await;

    let _ = sync_turnover_tasks_for_status(pool, &created, &user_id).await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn get_reservation(
    State(state): State<AppState>,
    Path(path): Path<ReservationPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;
    let record = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let mut enriched = enrich_reservations(pool, vec![record], &org_id).await?;
    Ok(Json(
        enriched.pop().unwrap_or_else(|| Value::Object(Map::new())),
    ))
}

async fn update_reservation(
    State(state): State<AppState>,
    Path(path): Path<ReservationPath>,
    headers: HeaderMap,
    Json(payload): Json<UpdateReservationInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let patch = remove_nulls(serialize_to_map(&payload));
    let updated = update_row(pool, "reservations", &path.reservation_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "update",
        "reservations",
        Some(&path.reservation_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
}

async fn transition_status(
    State(state): State<AppState>,
    Path(path): Path<ReservationPath>,
    headers: HeaderMap,
    Json(payload): Json<ReservationStatusInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let reservation = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = value_str(&reservation, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let current_status = value_str(&reservation, "status");
    if payload.status == current_status {
        return Ok(Json(reservation));
    }

    if !allowed_transition(&current_status, &payload.status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Invalid status transition: {current_status} -> {}",
            payload.status
        )));
    }

    let mut patch = Map::new();
    patch.insert("status".to_string(), Value::String(payload.status.clone()));
    if payload.status == "cancelled" {
        patch.insert(
            "cancel_reason".to_string(),
            payload.reason.map(Value::String).unwrap_or(Value::Null),
        );
    }

    let updated = update_row(pool, "reservations", &path.reservation_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "status_transition",
        "reservations",
        Some(&path.reservation_id),
        Some(reservation),
        Some(updated.clone()),
    )
    .await;

    let _ = sync_turnover_tasks_for_status(pool, &updated, &user_id).await;

    // Auto-release deposit on checkout
    if payload.status == "checked_out" {
        crate::routes::deposits::auto_release_deposit_on_checkout(pool, &updated).await;
    }

    // Fire workflow triggers based on new status
    let trigger_event = match payload.status.as_str() {
        "confirmed" => Some("reservation_confirmed"),
        "checked_in" => Some("checked_in"),
        "checked_out" => Some("checked_out"),
        _ => None,
    };
    if let Some(trigger) = trigger_event {
        let mut ctx = Map::new();
        ctx.insert(
            "reservation_id".to_string(),
            Value::String(path.reservation_id.clone()),
        );
        if let Some(obj) = updated.as_object() {
            for field in &[
                "property_id",
                "unit_id",
                "guest_id",
                "check_in_date",
                "check_out_date",
                "notes",
            ] {
                if let Some(val) = obj.get(*field) {
                    if !val.is_null() {
                        ctx.insert(field.to_string(), val.clone());
                    }
                }
            }
            // Add guest name from notes or a lookup
            if let Some(guest_name) = obj.get("guest_name").and_then(Value::as_str) {
                ctx.insert(
                    "guest_name".to_string(),
                    Value::String(guest_name.to_string()),
                );
            }
        }

        // Look up guest phone for sequences
        let guest_id_str = ctx
            .get("guest_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if !guest_id_str.is_empty() {
            if let Ok(guest) = get_row(pool, "guests", &guest_id_str, "id").await {
                let phone = value_str(&guest, "phone_e164");
                if !phone.is_empty() {
                    ctx.insert("guest_phone_e164".to_string(), Value::String(phone.clone()));
                }
                let name = value_str(&guest, "full_name");
                if !name.is_empty() && !ctx.contains_key("guest_name") {
                    ctx.insert("guest_name".to_string(), Value::String(name));
                }
            }
        }

        fire_trigger(
            pool,
            &org_id,
            trigger,
            &ctx,
            state.config.workflow_engine_mode,
        )
        .await;

        // Enroll in communication sequences matching this trigger
        let guest_phone = ctx
            .get("guest_phone_e164")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if !guest_phone.is_empty() {
            enroll_in_sequences(
                pool,
                &org_id,
                trigger,
                "reservation",
                &path.reservation_id,
                &guest_phone,
                &ctx,
            )
            .await;
        }
    }

    Ok(Json(updated))
}

async fn has_overlap(
    pool: &sqlx::PgPool,
    unit_id: &str,
    check_in_date: &str,
    check_out_date: &str,
    org_id: &str,
) -> AppResult<bool> {
    let reservations = list_rows(
        pool,
        "reservations",
        Some(&json_map(&[
            ("organization_id", Value::String(org_id.to_string())),
            ("unit_id", Value::String(unit_id.to_string())),
        ])),
        1000,
        0,
        "created_at",
        false,
    )
    .await?;

    let new_start = parse_date(check_in_date)?;
    let new_end = parse_date(check_out_date)?;

    for reservation in reservations {
        let Some(obj) = reservation.as_object() else {
            continue;
        };
        let status = value_string(obj.get("status")).unwrap_or_default();
        if !ACTIVE_BOOKING_STATUSES.contains(&status.as_str()) {
            continue;
        }

        let Some(existing_start_raw) = value_string(obj.get("check_in_date")) else {
            continue;
        };
        let Some(existing_end_raw) = value_string(obj.get("check_out_date")) else {
            continue;
        };
        let existing_start = parse_date(&existing_start_raw)?;
        let existing_end = parse_date(&existing_end_raw)?;

        if !(new_end <= existing_start || new_start >= existing_end) {
            return Ok(true);
        }
    }

    Ok(false)
}

async fn sync_turnover_tasks_for_status(
    pool: &sqlx::PgPool,
    reservation_row: &Value,
    actor_user_id: &str,
) -> AppResult<()> {
    let Some(reservation) = reservation_row.as_object() else {
        return Ok(());
    };

    let status = value_string(reservation.get("status"))
        .unwrap_or_default()
        .to_lowercase();
    if status == "cancelled" || status == "no_show" {
        cancel_open_turnover_tasks(pool, reservation).await?;
        return Ok(());
    }

    let blueprints = match status.as_str() {
        "confirmed" => CONFIRMED_BLUEPRINTS,
        "checked_in" => CHECKED_IN_BLUEPRINTS,
        "checked_out" => CHECKED_OUT_BLUEPRINTS,
        _ => return Ok(()),
    };

    let unit_id = value_string(reservation.get("unit_id")).unwrap_or_default();
    let org_id = value_string(reservation.get("organization_id")).unwrap_or_default();
    if unit_id.is_empty() || org_id.is_empty() {
        return Ok(());
    }

    let unit_row = get_row(pool, "units", &unit_id, "id").await?;
    let Some(unit) = unit_row.as_object() else {
        return Ok(());
    };

    let org_timezone = resolve_org_timezone(pool, &org_id).await;

    for blueprint in blueprints {
        upsert_turnover_task(
            pool,
            reservation,
            unit,
            &org_timezone,
            actor_user_id,
            blueprint,
        )
        .await?;
    }

    Ok(())
}

async fn cancel_open_turnover_tasks(
    pool: &sqlx::PgPool,
    reservation: &Map<String, Value>,
) -> AppResult<()> {
    let org_id = value_string(reservation.get("organization_id")).unwrap_or_default();
    let reservation_id = value_string(reservation.get("id")).unwrap_or_default();
    if org_id.is_empty() || reservation_id.is_empty() {
        return Ok(());
    }

    let existing_tasks = list_rows(
        pool,
        "tasks",
        Some(&json_map(&[
            ("organization_id", Value::String(org_id)),
            ("reservation_id", Value::String(reservation_id)),
        ])),
        200,
        0,
        "created_at",
        false,
    )
    .await?;

    for task in existing_tasks {
        let Some(task_obj) = task.as_object() else {
            continue;
        };
        let task_type = value_string(task_obj.get("type"))
            .unwrap_or_default()
            .to_lowercase();
        let task_status = value_string(task_obj.get("status"))
            .unwrap_or_default()
            .to_lowercase();
        if !AUTO_TURNOVER_TASK_TYPES.contains(&task_type.as_str()) {
            continue;
        }
        if task_status == "done" || task_status == "cancelled" {
            continue;
        }
        let Some(task_id) = value_string(task_obj.get("id")) else {
            continue;
        };

        let mut patch = Map::new();
        patch.insert("status".to_string(), Value::String("cancelled".to_string()));
        patch.insert(
            "completion_notes".to_string(),
            Value::String("Cancelada automaticamente por cambio de estado de reserva.".to_string()),
        );
        let _ = update_row(pool, "tasks", &task_id, &patch, "id").await;
    }

    Ok(())
}

async fn upsert_turnover_task(
    pool: &sqlx::PgPool,
    reservation: &Map<String, Value>,
    unit: &Map<String, Value>,
    org_timezone: &str,
    actor_user_id: &str,
    blueprint: &TaskBlueprint,
) -> AppResult<()> {
    let org_id = value_string(reservation.get("organization_id")).unwrap_or_default();
    let reservation_id = value_string(reservation.get("id")).unwrap_or_default();
    let unit_id = value_string(reservation.get("unit_id")).unwrap_or_default();
    let due_date = value_string(reservation.get(blueprint.date_field)).unwrap_or_default();
    if org_id.is_empty() || reservation_id.is_empty() || unit_id.is_empty() || due_date.is_empty() {
        return Ok(());
    }

    let due_at = as_utc_iso(
        &due_date,
        unit.get(blueprint.time_field),
        blueprint.fallback_time,
        org_timezone,
    )?;

    let property_id = value_string(unit.get("property_id"));

    let existing_tasks = list_rows(
        pool,
        "tasks",
        Some(&json_map(&[
            ("organization_id", Value::String(org_id.clone())),
            ("reservation_id", Value::String(reservation_id.clone())),
            ("type", Value::String(blueprint.task_type.to_string())),
        ])),
        20,
        0,
        "created_at",
        false,
    )
    .await?;

    let open_task = existing_tasks.iter().find(|task| {
        task.as_object()
            .and_then(|obj| obj.get("status"))
            .and_then(Value::as_str)
            .map(str::trim)
            .map(|status| !status.eq_ignore_ascii_case("cancelled"))
            .unwrap_or(false)
    });

    if let Some(task) = open_task {
        if let Some(task_id) = task
            .as_object()
            .and_then(|obj| obj.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            ensure_task_items(pool, task_id, blueprint.checklist).await?;
        }
        return Ok(());
    }

    let reusable_cancelled = existing_tasks.iter().find(|task| {
        task.as_object()
            .and_then(|obj| obj.get("status"))
            .and_then(Value::as_str)
            .map(str::trim)
            .map(|status| status.eq_ignore_ascii_case("cancelled"))
            .unwrap_or(false)
    });

    let mut task_id = String::new();
    if let Some(cancelled) = reusable_cancelled {
        if let Some(cancelled_id) = cancelled
            .as_object()
            .and_then(|obj| obj.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let mut patch = Map::new();
            patch.insert(
                "title".to_string(),
                Value::String(blueprint.title.to_string()),
            );
            patch.insert(
                "description".to_string(),
                Value::String(blueprint.description.to_string()),
            );
            patch.insert("status".to_string(), Value::String("todo".to_string()));
            patch.insert(
                "priority".to_string(),
                Value::String(blueprint.priority.to_string()),
            );
            patch.insert("due_at".to_string(), Value::String(due_at.clone()));
            patch.insert("sla_due_at".to_string(), Value::String(due_at.clone()));
            patch.insert("sla_breached_at".to_string(), Value::Null);
            patch.insert("completed_at".to_string(), Value::Null);
            patch.insert("completion_notes".to_string(), Value::Null);

            if let Ok(updated) = update_row(pool, "tasks", cancelled_id, &patch, "id").await {
                task_id = value_str(&updated, "id");
                if task_id.is_empty() {
                    task_id = cancelled_id.to_string();
                }
            }
        }
    }

    if task_id.is_empty() {
        let mut payload = Map::new();
        payload.insert("organization_id".to_string(), Value::String(org_id));
        if let Some(property) = property_id {
            payload.insert("property_id".to_string(), Value::String(property));
        }
        payload.insert("unit_id".to_string(), Value::String(unit_id));
        payload.insert("reservation_id".to_string(), Value::String(reservation_id));
        payload.insert(
            "type".to_string(),
            Value::String(blueprint.task_type.to_string()),
        );
        payload.insert("status".to_string(), Value::String("todo".to_string()));
        payload.insert(
            "priority".to_string(),
            Value::String(blueprint.priority.to_string()),
        );
        payload.insert(
            "title".to_string(),
            Value::String(blueprint.title.to_string()),
        );
        payload.insert(
            "description".to_string(),
            Value::String(blueprint.description.to_string()),
        );
        payload.insert("due_at".to_string(), Value::String(due_at.clone()));
        payload.insert("sla_due_at".to_string(), Value::String(due_at));
        payload.insert(
            "created_by_user_id".to_string(),
            Value::String(actor_user_id.to_string()),
        );

        let created = create_row(pool, "tasks", &payload).await?;
        task_id = value_str(&created, "id");
    }

    if !task_id.is_empty() {
        ensure_task_items(pool, &task_id, blueprint.checklist).await?;
    }

    Ok(())
}

async fn ensure_task_items(
    pool: &sqlx::PgPool,
    task_id: &str,
    checklist: &[&str],
) -> AppResult<()> {
    if checklist.is_empty() {
        return Ok(());
    }

    let existing_items = list_rows(
        pool,
        "task_items",
        Some(&json_map(&[(
            "task_id",
            Value::String(task_id.to_string()),
        )])),
        1,
        0,
        "sort_order",
        true,
    )
    .await?;
    if !existing_items.is_empty() {
        return Ok(());
    }

    for (index, label) in checklist.iter().enumerate() {
        let mut payload = Map::new();
        payload.insert("task_id".to_string(), Value::String(task_id.to_string()));
        payload.insert("sort_order".to_string(), json!((index + 1) as i32));
        payload.insert("label".to_string(), Value::String((*label).to_string()));
        payload.insert("is_required".to_string(), Value::Bool(true));
        payload.insert("is_completed".to_string(), Value::Bool(false));
        let _ = create_row(pool, "task_items", &payload).await;
    }

    Ok(())
}

async fn resolve_org_timezone(pool: &sqlx::PgPool, org_id: &str) -> String {
    let organization = get_row(pool, "organizations", org_id, "id").await;
    let Ok(org) = organization else {
        return DEFAULT_ORG_TIMEZONE.to_string();
    };

    org.as_object()
        .and_then(|obj| obj.get("timezone"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| DEFAULT_ORG_TIMEZONE.to_string())
}

fn as_utc_iso(
    local_date: &str,
    local_time: Option<&Value>,
    fallback_time: &str,
    timezone_name: &str,
) -> AppResult<String> {
    let due_date = parse_date(local_date)?;
    let due_time = parse_time(local_time, fallback_time);

    let timezone = timezone_name
        .parse::<Tz>()
        .unwrap_or(chrono_tz::America::Asuncion);

    let local_due = timezone
        .with_ymd_and_hms(
            due_date.year(),
            due_date.month(),
            due_date.day(),
            due_time.hour(),
            due_time.minute(),
            due_time.second(),
        )
        .earliest()
        .ok_or_else(|| {
            AppError::BadRequest("Invalid due date/time for task automation.".to_string())
        })?;

    Ok(local_due.with_timezone(&Utc).to_rfc3339())
}

fn parse_date(value: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid ISO date format.".to_string()))
}

fn parse_time(value: Option<&Value>, fallback: &str) -> NaiveTime {
    if let Some(raw) = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        if let Ok(parsed) = NaiveTime::parse_from_str(raw, "%H:%M:%S") {
            return parsed;
        }
        if let Ok(parsed) = NaiveTime::parse_from_str(raw, "%H:%M") {
            return parsed;
        }
        if let Ok(parsed) = NaiveTime::parse_from_str(raw, "%H:%M:%S%.f") {
            return parsed;
        }
    }

    NaiveTime::parse_from_str(fallback, "%H:%M:%S").unwrap_or(NaiveTime::MIN)
}

fn allowed_transition(current_status: &str, next_status: &str) -> bool {
    match current_status {
        "pending" => matches!(next_status, "confirmed" | "cancelled"),
        "confirmed" => matches!(next_status, "checked_in" | "cancelled" | "no_show"),
        "checked_in" => next_status == "checked_out",
        "checked_out" | "cancelled" | "no_show" => false,
        _ => false,
    }
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}

async fn refund_deposit(
    State(state): State<AppState>,
    Path(path): Path<ReservationPath>,
    headers: HeaderMap,
    Json(_payload): Json<DepositRefundInput>,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let record = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = value_str(&record, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let deposit_status = value_str(&record, "deposit_status");
    if deposit_status != "held" && deposit_status != "collected" {
        return Err(AppError::BadRequest(
            "Deposit must be in 'held' or 'collected' status to refund.".to_string(),
        ));
    }

    let mut patch = Map::new();
    patch.insert(
        "deposit_status".to_string(),
        Value::String("refunded".to_string()),
    );
    patch.insert(
        "deposit_refunded_at".to_string(),
        Value::String(Utc::now().to_rfc3339()),
    );

    let updated = update_row(pool, "reservations", &path.reservation_id, &patch, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "refund_deposit",
        "reservations",
        Some(&path.reservation_id),
        Some(record),
        Some(updated.clone()),
    )
    .await;

    Ok(Json(updated))
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

fn value_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn non_empty_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn json_map(entries: &[(&str, Value)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert((*key).to_string(), value.clone());
    }
    map
}

/// Generate a guest portal access token and queue a WhatsApp message with the link.
async fn send_guest_portal_link(
    State(state): State<AppState>,
    Path(path): Path<ReservationPath>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let reservation = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = reservation
        .as_object()
        .and_then(|o| o.get("organization_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::BadRequest("Reservation has no organization.".to_string()))?
        .to_string();
    assert_org_member(&state, &user_id, &org_id).await?;

    let guest_id = reservation
        .as_object()
        .and_then(|o| o.get("guest_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::BadRequest("This reservation has no guest linked.".to_string()))?
        .to_string();

    let guest = get_row(pool, "guests", &guest_id, "id").await?;
    let guest_phone = guest
        .as_object()
        .and_then(|o| o.get("phone_e164"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);
    let guest_email = guest
        .as_object()
        .and_then(|o| o.get("email"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);

    // Generate a random token
    let raw_token = uuid::Uuid::new_v4().to_string();
    let token_hash = {
        let digest = sha1::Sha1::digest(raw_token.as_bytes());
        digest
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };

    let mut record = Map::new();
    record.insert(
        "reservation_id".to_string(),
        Value::String(path.reservation_id.clone()),
    );
    record.insert("guest_id".to_string(), Value::String(guest_id));
    record.insert("token_hash".to_string(), Value::String(token_hash));
    if let Some(ref e) = guest_email {
        record.insert("email".to_string(), Value::String(e.clone()));
    }
    if let Some(ref p) = guest_phone {
        record.insert("phone_e164".to_string(), Value::String(p.clone()));
    }

    create_row(pool, "guest_access_tokens", &record).await?;

    // Build magic link
    let app_base_url = std::env::var("NEXT_PUBLIC_APP_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    let magic_link = format!("{app_base_url}/guest/login?token={raw_token}");

    // Queue WhatsApp message if guest has phone
    if let Some(ref phone) = guest_phone {
        let mut msg = Map::new();
        msg.insert("organization_id".to_string(), Value::String(org_id));
        msg.insert("channel".to_string(), Value::String("whatsapp".to_string()));
        msg.insert("recipient".to_string(), Value::String(phone.clone()));
        msg.insert("status".to_string(), Value::String("queued".to_string()));
        msg.insert(
            "scheduled_at".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );
        let mut payload = Map::new();
        payload.insert(
            "body".to_string(),
            Value::String(format!(
                "Bienvenido a Casaora! Accede a tu portal de huésped aquí: {magic_link}\n\nEncontrarás tu itinerario, información de check-in y más."
            )),
        );
        msg.insert("payload".to_string(), Value::Object(payload));
        let _ = create_row(pool, "message_logs", &msg).await;
    }

    Ok((
        axum::http::StatusCode::OK,
        Json(json!({
            "message": "Guest portal link generated and sent.",
            "link": magic_link,
        })),
    ))
}

// ── Accompanying Guests ─────────────────────────────────────────────

async fn list_reservation_guests(
    State(state): State<AppState>,
    Path(path): Path<ReservationPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let reservation = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = value_str(&reservation, "organization_id");
    assert_org_member(&state, &user_id, &org_id).await?;

    let mut filters = Map::new();
    filters.insert(
        "reservation_id".to_string(),
        Value::String(path.reservation_id.clone()),
    );
    let rows = list_rows(
        pool,
        "reservation_guests",
        Some(&filters),
        100,
        0,
        "created_at",
        true,
    )
    .await?;

    // Enrich with guest name/contact
    let mut enriched = Vec::with_capacity(rows.len());
    for row in rows {
        let mut obj = row.as_object().cloned().unwrap_or_default();
        let guest_id = value_string(obj.get("guest_id")).unwrap_or_default();
        if !guest_id.is_empty() {
            if let Ok(guest) = get_row(pool, "guests", &guest_id, "id").await {
                obj.insert(
                    "guest_name".to_string(),
                    guest
                        .as_object()
                        .and_then(|g| g.get("full_name"))
                        .cloned()
                        .unwrap_or(Value::Null),
                );
                obj.insert(
                    "guest_email".to_string(),
                    guest
                        .as_object()
                        .and_then(|g| g.get("email"))
                        .cloned()
                        .unwrap_or(Value::Null),
                );
                obj.insert(
                    "guest_phone_e164".to_string(),
                    guest
                        .as_object()
                        .and_then(|g| g.get("phone_e164"))
                        .cloned()
                        .unwrap_or(Value::Null),
                );
            }
        }
        enriched.push(Value::Object(obj));
    }

    Ok(Json(json!({ "data": enriched })))
}

async fn add_reservation_guest(
    State(state): State<AppState>,
    Path(path): Path<ReservationPath>,
    headers: HeaderMap,
    Json(payload): Json<AddReservationGuestInput>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let reservation = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = value_str(&reservation, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    // Validate guest belongs to same org
    let guest = get_row(pool, "guests", &payload.guest_id, "id").await?;
    let guest_org_id = value_str(&guest, "organization_id");
    if guest_org_id != org_id {
        return Err(AppError::BadRequest(
            "Guest does not belong to the same organization.".to_string(),
        ));
    }

    // Cannot add the primary guest as accompanying
    let primary_guest_id = value_str(&reservation, "guest_id");
    if payload.guest_id == primary_guest_id {
        return Err(AppError::BadRequest(
            "Cannot add the primary guest as an accompanying guest.".to_string(),
        ));
    }

    let mut record = Map::new();
    record.insert(
        "reservation_id".to_string(),
        Value::String(path.reservation_id.clone()),
    );
    record.insert("guest_id".to_string(), Value::String(payload.guest_id));
    record.insert(
        "role".to_string(),
        Value::String(payload.role.unwrap_or_else(|| "accompanying".to_string())),
    );

    let created = create_row(pool, "reservation_guests", &record).await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "add_reservation_guest",
        "reservation_guests",
        created
            .as_object()
            .and_then(|o| o.get("id"))
            .and_then(Value::as_str),
        None,
        Some(created.clone()),
    )
    .await;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn remove_reservation_guest(
    State(state): State<AppState>,
    Path(path): Path<ReservationGuestPath>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let rg = get_row(pool, "reservation_guests", &path.reservation_guest_id, "id").await?;
    let rg_reservation_id =
        value_string(rg.as_object().and_then(|o| o.get("reservation_id"))).unwrap_or_default();
    if rg_reservation_id != path.reservation_id {
        return Err(AppError::BadRequest(
            "Reservation guest does not belong to this reservation.".to_string(),
        ));
    }

    let reservation = get_row(pool, "reservations", &path.reservation_id, "id").await?;
    let org_id = value_str(&reservation, "organization_id");
    assert_org_role(&state, &user_id, &org_id, &["owner_admin", "operator"]).await?;

    let deleted = delete_row(pool, "reservation_guests", &path.reservation_guest_id, "id").await?;

    write_audit_log(
        state.db_pool.as_ref(),
        Some(&org_id),
        Some(&user_id),
        "remove_reservation_guest",
        "reservation_guests",
        Some(&path.reservation_guest_id),
        Some(deleted.clone()),
        None,
    )
    .await;

    Ok(Json(deleted))
}
