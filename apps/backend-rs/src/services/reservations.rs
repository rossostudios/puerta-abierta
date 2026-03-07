use chrono::NaiveDate;
use serde_json::{json, Value};
use sqlx::{Postgres, QueryBuilder, Row};

use crate::{
    error::{AppError, AppResult},
    repository::table_service::{get_row, list_rows},
    schemas::ReservationsOverviewQuery,
    services::json_helpers::{json_map, non_empty_opt, round2, value_str},
};

const ACTIVE_RESERVATION_STATUSES: &[&str] = &["pending", "confirmed", "checked_in"];

pub async fn build_reservations_overview(
    pool: &sqlx::PgPool,
    query: &ReservationsOverviewQuery,
) -> AppResult<Value> {
    let summary = fetch_overview_summary(pool, query).await?;
    let rows = fetch_overview_rows(pool, query).await?;

    Ok(json!({
        "summary": {
            "arrivalsToday": summary.arrivals_today,
            "departuresToday": summary.departures_today,
            "inHouse": summary.in_house,
            "needsAttention": summary.needs_attention,
        },
        "viewCounts": {
            "all": summary.total,
            "arrivals_today": summary.arrivals_today,
            "departures_today": summary.departures_today,
            "in_house": summary.in_house,
            "needs_attention": summary.needs_attention,
        },
        "rows": rows,
    }))
}

pub async fn build_reservation_detail_overview(
    pool: &sqlx::PgPool,
    reservation_id: &str,
) -> AppResult<Value> {
    let row = fetch_detail_row(pool, reservation_id).await?;
    row.as_object()
        .ok_or_else(|| AppError::Internal("Reservation detail was not an object.".to_string()))?;

    let reservation_id_value = value_str(&row, "id");
    let guest_id = value_opt_str(&row, "guest_id");
    let unit_id = value_opt_str(&row, "unit_id");
    let check_in_date = value_opt_str(&row, "check_in_date");
    let check_out_date = value_opt_str(&row, "check_out_date");
    let guest_portal_eligible = value_bool(&row, "guest_portal_eligible");
    let listing_slug = value_opt_str(&row, "listing_slug");

    let guest = if let Some(ref guest_id_value) = guest_id {
        get_row(pool, "guests", guest_id_value, "id").await.ok()
    } else {
        None
    };

    let tasks = list_rows(
        pool,
        "tasks",
        Some(&json_map(&[(
            "reservation_id",
            Value::String(reservation_id_value.clone()),
        )])),
        100,
        0,
        "created_at",
        false,
    )
    .await?;

    let expenses = list_rows(
        pool,
        "expenses",
        Some(&json_map(&[(
            "reservation_id",
            Value::String(reservation_id_value.clone()),
        )])),
        50,
        0,
        "expense_date",
        false,
    )
    .await?;

    let blocks = if let Some(ref unit_id_value) = unit_id {
        list_rows(
            pool,
            "calendar_blocks",
            Some(&json_map(&[(
                "unit_id",
                Value::String(unit_id_value.clone()),
            )])),
            200,
            0,
            "starts_on",
            true,
        )
        .await?
    } else {
        Vec::new()
    };

    let related_reservations = if let Some(ref unit_id_value) = unit_id {
        list_rows(
            pool,
            "reservations",
            Some(&json_map(&[(
                "unit_id",
                Value::String(unit_id_value.clone()),
            )])),
            300,
            0,
            "check_in_date",
            true,
        )
        .await?
    } else {
        Vec::new()
    };

    let messages = fetch_related_messages(pool, &reservation_id_value, guest_id.as_deref()).await?;

    let open_task_count = tasks
        .iter()
        .filter(|task| !matches!(value_str(task, "status").as_str(), "done" | "cancelled"))
        .count();
    let recent_tasks = tasks
        .iter()
        .take(5)
        .map(|task| {
            json!({
                "id": value_str(task, "id"),
                "title": value_str(task, "title"),
                "status": value_opt_str(task, "status"),
                "priority": value_opt_str(task, "priority"),
                "dueAt": value_opt_str(task, "due_at"),
                "createdAt": value_opt_str(task, "created_at"),
            })
        })
        .collect::<Vec<_>>();

    let recent_expenses = expenses
        .iter()
        .take(5)
        .map(|expense| {
            json!({
                "id": value_str(expense, "id"),
                "category": value_opt_str(expense, "category"),
                "amount": value_f64(expense, "amount"),
                "currency": value_opt_str(expense, "currency"),
                "expenseDate": value_opt_str(expense, "expense_date"),
            })
        })
        .collect::<Vec<_>>();

    let recent_messages = messages
        .iter()
        .take(6)
        .map(|message| {
            json!({
                "id": value_str(message, "id"),
                "channel": value_opt_str(message, "channel"),
                "direction": value_opt_str(message, "direction"),
                "status": value_opt_str(message, "status"),
                "bodyPreview": message
                    .as_object()
                    .and_then(|obj| obj.get("body_preview"))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_default(),
                "createdAt": value_opt_str(message, "created_at"),
            })
        })
        .collect::<Vec<_>>();

    let related_blocks = blocks
        .iter()
        .filter(|block| overlaps_window(block, check_in_date.as_deref(), check_out_date.as_deref()))
        .map(|block| {
            json!({
                "id": value_str(block, "id"),
                "startsOn": value_opt_str(block, "starts_on"),
                "endsOn": value_opt_str(block, "ends_on"),
                "reason": value_opt_str(block, "reason"),
            })
        })
        .collect::<Vec<_>>();

    let mut blocked_periods = Vec::new();

    if let (Some(from), Some(to)) = (check_in_date.as_deref(), check_out_date.as_deref()) {
        blocked_periods.push(json!({
            "from": from,
            "to": to,
            "source": "reservation",
        }));
    }

    for reservation_row in &related_reservations {
        if value_str(reservation_row, "id") == reservation_id_value {
            continue;
        }
        if !ACTIVE_RESERVATION_STATUSES.contains(&value_str(reservation_row, "status").as_str()) {
            continue;
        }
        if !overlaps_window(
            reservation_row,
            check_in_date.as_deref(),
            check_out_date.as_deref(),
        ) {
            continue;
        }
        if let (Some(from), Some(to)) = (
            value_opt_str(reservation_row, "check_in_date"),
            value_opt_str(reservation_row, "check_out_date"),
        ) {
            blocked_periods.push(json!({
                "from": from,
                "to": to,
                "source": "reservation",
            }));
        }
    }

    for block in &blocks {
        if !overlaps_window(block, check_in_date.as_deref(), check_out_date.as_deref()) {
            continue;
        }
        if let (Some(from), Some(to)) = (
            value_opt_str(block, "starts_on"),
            value_opt_str(block, "ends_on"),
        ) {
            blocked_periods.push(json!({
                "from": from,
                "to": to,
                "source": "block",
            }));
        }
    }

    blocked_periods.sort_by(|left, right| value_str(left, "from").cmp(&value_str(right, "from")));

    Ok(json!({
        "reservation": {
            "id": reservation_id_value,
            "guestId": guest_id.as_deref(),
            "guestName": value_opt_str(&row, "guest_name"),
            "propertyId": value_opt_str(&row, "property_id"),
            "propertyName": value_opt_str(&row, "property_name"),
            "unitId": unit_id.as_deref(),
            "unitName": value_opt_str(&row, "unit_name"),
            "status": value_str(&row, "status"),
            "statusLabel": value_str(&row, "status_label"),
            "source": value_str(&row, "source"),
            "sourceLabel": value_str(&row, "source_label"),
            "stayPhase": value_str(&row, "stay_phase"),
            "checkInDate": check_in_date.as_deref(),
            "checkOutDate": check_out_date.as_deref(),
            "nights": value_i64(&row, "nights"),
            "adults": value_i64(&row, "adults"),
            "children": value_i64(&row, "children"),
            "totalAmount": round2(value_f64(&row, "total_amount")),
            "amountPaid": round2(value_f64(&row, "amount_paid")),
            "currency": value_str(&row, "currency"),
            "openTasks": open_task_count,
            "listingSlug": listing_slug.as_deref(),
            "guestPortalEligible": guest_portal_eligible,
            "primaryHref": format!("/module/reservations/{}", reservation_id),
            "nightlyRate": round2(value_f64(&row, "nightly_rate")),
            "cleaningFee": round2(value_f64(&row, "cleaning_fee")),
            "taxAmount": round2(value_f64(&row, "tax_amount")),
            "extraFees": round2(value_f64(&row, "extra_fees")),
            "discountAmount": round2(value_f64(&row, "discount_amount")),
            "paymentMethod": value_opt_str(&row, "payment_method"),
            "paymentReference": value_opt_str(&row, "payment_reference"),
            "notes": value_opt_str(&row, "notes"),
            "externalReservationId": value_opt_str(&row, "external_reservation_id"),
            "amountDue": round2((value_f64(&row, "total_amount") - value_f64(&row, "amount_paid")).max(0.0)),
            "depositAmount": round2(value_f64(&row, "deposit_amount")),
            "depositStatus": value_opt_str(&row, "deposit_status"),
            "createdAt": value_opt_str(&row, "created_at"),
            "updatedAt": value_opt_str(&row, "updated_at"),
        },
        "guest": guest,
        "availability": {
            "blockedPeriods": blocked_periods,
            "relatedBlocks": related_blocks,
        },
        "tasks": {
            "open": open_task_count,
            "href": format!("/module/tasks?reservation_id={}", reservation_id),
            "recent": recent_tasks,
        },
        "expenses": {
            "href": format!("/module/expenses?reservation_id={}", reservation_id),
            "recent": recent_expenses,
        },
        "messaging": {
            "href": "/module/messaging",
            "recent": recent_messages,
        },
        "related": {
            "listingHref": listing_slug
                .as_ref()
                .map(|slug| format!("/marketplace/{}", slug)),
            "guestPortalEligible": guest_portal_eligible,
            "guestHref": guest_id
                .as_ref()
                .map(|guest_id_value| format!("/module/guests/{}", guest_id_value)),
            "propertyHref": value_opt_str(&row, "property_id")
                .map(|property_id_value| format!("/module/properties/{}", property_id_value)),
            "unitHref": unit_id
                .as_ref()
                .map(|unit_id_value| format!("/module/units/{}", unit_id_value)),
            "tasksHref": format!("/module/tasks?reservation_id={}", reservation_id),
            "expensesHref": format!("/module/expenses?reservation_id={}", reservation_id),
            "messagingHref": "/module/messaging",
            "calendarHref": unit_id
                .as_ref()
                .map(|unit_id_value| format!("/module/calendar?unit_id={}", unit_id_value)),
        },
    }))
}

#[derive(Debug, Default)]
struct OverviewSummary {
    total: i64,
    arrivals_today: i64,
    departures_today: i64,
    in_house: i64,
    needs_attention: i64,
}

async fn fetch_overview_summary(
    pool: &sqlx::PgPool,
    query: &ReservationsOverviewQuery,
) -> AppResult<OverviewSummary> {
    let mut builder = QueryBuilder::<Postgres>::new(
        "SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE base.stay_phase = 'arriving_today')::bigint AS arrivals_today,
            COUNT(*) FILTER (WHERE base.stay_phase = 'departing_today')::bigint AS departures_today,
            COUNT(*) FILTER (WHERE base.stay_phase = 'in_house')::bigint AS in_house,
            COUNT(*) FILTER (WHERE base.needs_attention)::bigint AS needs_attention
         FROM (",
    );

    push_overview_base_select(&mut builder, query)?;
    builder.push(") base WHERE 1=1");
    push_overview_outer_filters(&mut builder, query, false, "base");

    let row = builder
        .build()
        .fetch_one(pool)
        .await
        .map_err(map_db_error)?;

    Ok(OverviewSummary {
        total: row.try_get::<i64, _>("total").unwrap_or(0),
        arrivals_today: row.try_get::<i64, _>("arrivals_today").unwrap_or(0),
        departures_today: row.try_get::<i64, _>("departures_today").unwrap_or(0),
        in_house: row.try_get::<i64, _>("in_house").unwrap_or(0),
        needs_attention: row.try_get::<i64, _>("needs_attention").unwrap_or(0),
    })
}

async fn fetch_overview_rows(
    pool: &sqlx::PgPool,
    query: &ReservationsOverviewQuery,
) -> AppResult<Vec<Value>> {
    let mut builder = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM (");
    push_overview_base_select(&mut builder, query)?;
    builder.push(") t WHERE 1=1");
    push_overview_outer_filters(&mut builder, query, true, "t");
    push_overview_sort(&mut builder, query.sort.as_deref());
    builder
        .push(" LIMIT ")
        .push_bind(query.limit.clamp(1, 100))
        .push(" OFFSET ")
        .push_bind(query.offset.max(0));

    let rows = builder
        .build()
        .fetch_all(pool)
        .await
        .map_err(map_db_error)?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .map(overview_row_contract)
        .collect())
}

fn push_overview_base_select(
    builder: &mut QueryBuilder<'_, Postgres>,
    query: &ReservationsOverviewQuery,
) -> AppResult<()> {
    builder.push(
        "SELECT
            r.id::text AS id,
            g.id::text AS guest_id,
            g.full_name AS guest_name,
            p.id::text AS property_id,
            p.name AS property_name,
            u.id::text AS unit_id,
            COALESCE(NULLIF(u.name, ''), NULLIF(u.code, ''), 'Unit') AS unit_name,
            r.status::text AS status,
            CASE
                WHEN r.status = 'pending' THEN 'Pending'
                WHEN r.status = 'confirmed' THEN 'Confirmed'
                WHEN r.status = 'checked_in' THEN 'Checked In'
                WHEN r.status = 'checked_out' THEN 'Checked Out'
                WHEN r.status = 'cancelled' THEN 'Cancelled'
                WHEN r.status = 'no_show' THEN 'No Show'
                ELSE initcap(replace(r.status::text, '_', ' '))
            END AS status_label,
            COALESCE(NULLIF(r.source, ''), 'manual') AS source,
            CASE
                WHEN lower(COALESCE(i.channel_name, '')) LIKE '%airbnb%' THEN 'Airbnb'
                WHEN lower(COALESCE(i.channel_name, '')) LIKE '%booking%' THEN 'Booking.com'
                WHEN lower(COALESCE(r.source, '')) = 'marketplace' THEN 'Casaora Marketplace'
                WHEN lower(COALESCE(r.source, '')) = 'direct_booking' THEN 'Casaora'
                WHEN lower(COALESCE(r.source, '')) = 'manual' THEN 'Manual'
                ELSE COALESCE(NULLIF(i.public_name, ''), NULLIF(i.channel_name, ''), initcap(replace(COALESCE(r.source, 'manual'), '_', ' ')))
            END AS source_label,
            CASE
                WHEN r.status IN ('cancelled', 'no_show') THEN 'cancelled'
                WHEN r.check_in_date = CURRENT_DATE AND r.status IN ('pending', 'confirmed', 'checked_in') THEN 'arriving_today'
                WHEN r.check_out_date = CURRENT_DATE AND r.status IN ('confirmed', 'checked_in', 'checked_out') THEN 'departing_today'
                WHEN r.status = 'checked_in' AND r.check_in_date < CURRENT_DATE AND r.check_out_date > CURRENT_DATE THEN 'in_house'
                WHEN r.check_in_date > CURRENT_DATE AND r.status IN ('pending', 'confirmed') THEN 'upcoming'
                ELSE 'completed'
            END AS stay_phase,
            r.check_in_date::text AS check_in_date,
            r.check_out_date::text AS check_out_date,
            GREATEST((r.check_out_date - r.check_in_date), 0)::int AS nights,
            COALESCE(r.adults, 0)::int AS adults,
            COALESCE(r.children, 0)::int AS children,
            COALESCE(r.total_amount, 0)::float8 AS total_amount,
            COALESCE(r.amount_paid, 0)::float8 AS amount_paid,
            COALESCE(r.currency, 'PYG')::text AS currency,
            COALESCE(task_stats.open_tasks, 0)::int AS open_tasks,
            listing_ctx.public_slug AS listing_slug,
            (r.guest_id IS NOT NULL) AS guest_portal_eligible,
            (
                r.status IN ('pending', 'no_show')
                OR r.guest_id IS NULL
                OR COALESCE(task_stats.overdue_tasks, 0) > 0
                OR (r.check_in_date <= CURRENT_DATE AND r.status = 'confirmed')
            ) AS needs_attention
        FROM reservations r
        LEFT JOIN guests g ON g.id = r.guest_id
        LEFT JOIN units u ON u.id = r.unit_id
        LEFT JOIN properties p ON p.id = u.property_id
        LEFT JOIN integrations i ON i.id = r.integration_id
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE t.status NOT IN ('done', 'cancelled'))::int AS open_tasks,
                COUNT(*) FILTER (
                    WHERE t.status NOT IN ('done', 'cancelled')
                      AND t.due_at IS NOT NULL
                      AND t.due_at < now()
                )::int AS overdue_tasks
            FROM tasks t
            WHERE t.reservation_id = r.id
        ) task_stats ON TRUE
        LEFT JOIN LATERAL (
            SELECT l.public_slug
            FROM listings l
            WHERE l.unit_id = r.unit_id
              AND l.is_published = true
            ORDER BY l.published_at DESC NULLS LAST, l.created_at DESC
            LIMIT 1
        ) listing_ctx ON TRUE
        WHERE r.organization_id = ",
    );
    builder.push_bind(parse_uuid(&query.org_id, "org_id")?);

    if let Some(status) = non_empty_opt(query.status.as_deref()) {
        builder.push(" AND r.status = ").push_bind(status);
    }
    if let Some(source) = non_empty_opt(query.source.as_deref()) {
        builder
            .push(" AND lower(COALESCE(r.source, '')) = ")
            .push_bind(source.to_ascii_lowercase());
    }
    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        builder
            .push(" AND p.id = ")
            .push_bind(parse_uuid(&property_id, "property_id")?);
    }
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        builder
            .push(" AND u.id = ")
            .push_bind(parse_uuid(&unit_id, "unit_id")?);
    }
    if let Some(q) = non_empty_opt(query.q.as_deref()) {
        let needle = format!("%{}%", q.to_ascii_lowercase());
        builder
            .push(" AND (lower(COALESCE(g.full_name, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(p.name, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(u.name, u.code, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(r.source, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(r.external_reservation_id, '')) LIKE ")
            .push_bind(needle)
            .push(")");
    }

    push_date_window_filters(
        builder,
        query.from_date.as_deref(),
        query.to_date.as_deref(),
    )?;

    Ok(())
}

fn push_overview_outer_filters(
    builder: &mut QueryBuilder<'_, Postgres>,
    query: &ReservationsOverviewQuery,
    include_view: bool,
    alias: &str,
) {
    if let Some(stay_phase) = non_empty_opt(query.stay_phase.as_deref()) {
        builder
            .push(" AND ")
            .push(alias)
            .push(".stay_phase = ")
            .push_bind(stay_phase.to_ascii_lowercase());
    }

    if !include_view {
        return;
    }

    match non_empty_opt(query.view.as_deref()).as_deref() {
        Some("arrivals_today") => {
            builder
                .push(" AND ")
                .push(alias)
                .push(".stay_phase = 'arriving_today'");
        }
        Some("departures_today") => {
            builder
                .push(" AND ")
                .push(alias)
                .push(".stay_phase = 'departing_today'");
        }
        Some("in_house") => {
            builder
                .push(" AND ")
                .push(alias)
                .push(".stay_phase = 'in_house'");
        }
        Some("needs_attention") => {
            builder
                .push(" AND ")
                .push(alias)
                .push(".needs_attention = true");
        }
        _ => {}
    }
}

fn push_overview_sort(builder: &mut QueryBuilder<'_, Postgres>, sort: Option<&str>) {
    match non_empty_opt(sort).as_deref() {
        Some("check_out_asc") => builder.push(" ORDER BY t.check_out_date ASC, t.id ASC"),
        Some("guest_asc") => {
            builder.push(" ORDER BY lower(COALESCE(t.guest_name, '')) ASC, t.check_in_date ASC")
        }
        Some("total_desc") => builder.push(" ORDER BY t.total_amount DESC, t.check_in_date ASC"),
        Some("status_asc") => builder.push(" ORDER BY lower(t.status) ASC, t.check_in_date ASC"),
        _ => builder.push(" ORDER BY t.check_in_date ASC, t.id ASC"),
    };
}

fn overview_row_contract(row: Value) -> Value {
    let id = value_str(&row, "id");
    json!({
        "id": id,
        "guestId": value_opt_str(&row, "guest_id"),
        "guestName": value_opt_str(&row, "guest_name"),
        "propertyId": value_opt_str(&row, "property_id"),
        "propertyName": value_opt_str(&row, "property_name"),
        "unitId": value_opt_str(&row, "unit_id"),
        "unitName": value_opt_str(&row, "unit_name"),
        "status": value_str(&row, "status"),
        "statusLabel": value_str(&row, "status_label"),
        "source": value_str(&row, "source"),
        "sourceLabel": value_str(&row, "source_label"),
        "stayPhase": value_str(&row, "stay_phase"),
        "checkInDate": value_opt_str(&row, "check_in_date"),
        "checkOutDate": value_opt_str(&row, "check_out_date"),
        "nights": value_i64(&row, "nights"),
        "adults": value_i64(&row, "adults"),
        "children": value_i64(&row, "children"),
        "totalAmount": round2(value_f64(&row, "total_amount")),
        "amountPaid": round2(value_f64(&row, "amount_paid")),
        "currency": value_str(&row, "currency"),
        "openTasks": value_i64(&row, "open_tasks"),
        "listingSlug": value_opt_str(&row, "listing_slug"),
        "guestPortalEligible": value_bool(&row, "guest_portal_eligible"),
        "primaryHref": format!("/module/reservations/{}", id),
    })
}

async fn fetch_detail_row(pool: &sqlx::PgPool, reservation_id: &str) -> AppResult<Value> {
    let reservation_uuid = parse_uuid(reservation_id, "reservation_id")?;
    let query = "SELECT row_to_json(t) AS row FROM (
        SELECT
            r.id::text AS id,
            r.organization_id::text AS organization_id,
            g.id::text AS guest_id,
            g.full_name AS guest_name,
            p.id::text AS property_id,
            p.name AS property_name,
            u.id::text AS unit_id,
            COALESCE(NULLIF(u.name, ''), NULLIF(u.code, ''), 'Unit') AS unit_name,
            r.status::text AS status,
            CASE
                WHEN r.status = 'pending' THEN 'Pending'
                WHEN r.status = 'confirmed' THEN 'Confirmed'
                WHEN r.status = 'checked_in' THEN 'Checked In'
                WHEN r.status = 'checked_out' THEN 'Checked Out'
                WHEN r.status = 'cancelled' THEN 'Cancelled'
                WHEN r.status = 'no_show' THEN 'No Show'
                ELSE initcap(replace(r.status::text, '_', ' '))
            END AS status_label,
            COALESCE(NULLIF(r.source, ''), 'manual') AS source,
            CASE
                WHEN lower(COALESCE(i.channel_name, '')) LIKE '%airbnb%' THEN 'Airbnb'
                WHEN lower(COALESCE(i.channel_name, '')) LIKE '%booking%' THEN 'Booking.com'
                WHEN lower(COALESCE(r.source, '')) = 'marketplace' THEN 'Casaora Marketplace'
                WHEN lower(COALESCE(r.source, '')) = 'direct_booking' THEN 'Casaora'
                WHEN lower(COALESCE(r.source, '')) = 'manual' THEN 'Manual'
                ELSE COALESCE(NULLIF(i.public_name, ''), NULLIF(i.channel_name, ''), initcap(replace(COALESCE(r.source, 'manual'), '_', ' ')))
            END AS source_label,
            CASE
                WHEN r.status IN ('cancelled', 'no_show') THEN 'cancelled'
                WHEN r.check_in_date = CURRENT_DATE AND r.status IN ('pending', 'confirmed', 'checked_in') THEN 'arriving_today'
                WHEN r.check_out_date = CURRENT_DATE AND r.status IN ('confirmed', 'checked_in', 'checked_out') THEN 'departing_today'
                WHEN r.status = 'checked_in' AND r.check_in_date < CURRENT_DATE AND r.check_out_date > CURRENT_DATE THEN 'in_house'
                WHEN r.check_in_date > CURRENT_DATE AND r.status IN ('pending', 'confirmed') THEN 'upcoming'
                ELSE 'completed'
            END AS stay_phase,
            r.check_in_date::text AS check_in_date,
            r.check_out_date::text AS check_out_date,
            GREATEST((r.check_out_date - r.check_in_date), 0)::int AS nights,
            COALESCE(r.adults, 0)::int AS adults,
            COALESCE(r.children, 0)::int AS children,
            COALESCE(r.total_amount, 0)::float8 AS total_amount,
            COALESCE(r.amount_paid, 0)::float8 AS amount_paid,
            COALESCE(r.currency, 'PYG')::text AS currency,
            COALESCE(r.nightly_rate, 0)::float8 AS nightly_rate,
            COALESCE(r.cleaning_fee, 0)::float8 AS cleaning_fee,
            COALESCE(r.tax_amount, 0)::float8 AS tax_amount,
            COALESCE(r.extra_fees, 0)::float8 AS extra_fees,
            COALESCE(r.discount_amount, 0)::float8 AS discount_amount,
            r.payment_method::text AS payment_method,
            r.payment_reference AS payment_reference,
            r.notes AS notes,
            r.external_reservation_id AS external_reservation_id,
            COALESCE(r.deposit_amount, 0)::float8 AS deposit_amount,
            r.deposit_status AS deposit_status,
            (r.guest_id IS NOT NULL) AS guest_portal_eligible,
            listing_ctx.public_slug AS listing_slug,
            r.created_at::text AS created_at,
            r.updated_at::text AS updated_at
        FROM reservations r
        LEFT JOIN guests g ON g.id = r.guest_id
        LEFT JOIN units u ON u.id = r.unit_id
        LEFT JOIN properties p ON p.id = u.property_id
        LEFT JOIN integrations i ON i.id = r.integration_id
        LEFT JOIN LATERAL (
            SELECT l.public_slug
            FROM listings l
            WHERE l.unit_id = r.unit_id
              AND l.is_published = true
            ORDER BY l.published_at DESC NULLS LAST, l.created_at DESC
            LIMIT 1
        ) listing_ctx ON TRUE
        WHERE r.id = $1
    ) t LIMIT 1";

    let row = sqlx::query(query)
        .bind(reservation_uuid)
        .fetch_optional(pool)
        .await
        .map_err(map_db_error)?;

    row.and_then(|value| value.try_get::<Option<Value>, _>("row").ok().flatten())
        .ok_or_else(|| AppError::NotFound("Reservation not found.".to_string()))
}

async fn fetch_related_messages(
    pool: &sqlx::PgPool,
    reservation_id: &str,
    guest_id: Option<&str>,
) -> AppResult<Vec<Value>> {
    let mut builder = QueryBuilder::<Postgres>::new(
        "SELECT row_to_json(t) AS row FROM (
            SELECT
                m.id::text AS id,
                m.channel::text AS channel,
                m.direction::text AS direction,
                m.status::text AS status,
                COALESCE(m.payload->>'subject', '') AS subject,
                LEFT(COALESCE(m.payload->>'body', m.payload::text, ''), 180) AS body_preview,
                m.created_at::text AS created_at
            FROM message_logs m
            WHERE (m.reservation_id = ",
    );
    builder.push_bind(parse_uuid(reservation_id, "reservation_id")?);
    builder.push(")");

    if let Some(guest_id_value) = guest_id.and_then(|value| non_empty_opt(Some(value))) {
        builder
            .push(" OR (m.guest_id = ")
            .push_bind(parse_uuid(&guest_id_value, "guest_id")?)
            .push(" AND m.reservation_id IS NULL)");
    }

    builder.push(" ORDER BY m.created_at DESC LIMIT 12) t");

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

fn push_date_window_filters(
    builder: &mut QueryBuilder<'_, Postgres>,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> AppResult<()> {
    let parsed_from = if let Some(value) = non_empty_opt(from_date) {
        Some(parse_date(&value, "from")?)
    } else {
        None
    };
    let parsed_to = if let Some(value) = non_empty_opt(to_date) {
        Some(parse_date(&value, "to")?)
    } else {
        None
    };

    if let (Some(from), Some(to)) = (parsed_from, parsed_to) {
        builder
            .push(" AND r.check_in_date < ")
            .push_bind(to)
            .push(" AND r.check_out_date > ")
            .push_bind(from);
        return Ok(());
    }

    if let Some(from) = parsed_from {
        builder.push(" AND r.check_out_date >= ").push_bind(from);
    }
    if let Some(to) = parsed_to {
        builder.push(" AND r.check_in_date <= ").push_bind(to);
    }
    Ok(())
}

fn overlaps_window(row: &Value, from_date: Option<&str>, to_date: Option<&str>) -> bool {
    let row_from = value_opt_str(row, "check_in_date").or_else(|| value_opt_str(row, "starts_on"));
    let row_to = value_opt_str(row, "check_out_date").or_else(|| value_opt_str(row, "ends_on"));

    let Some(row_from) = row_from else {
        return false;
    };
    let Some(row_to) = row_to else {
        return false;
    };

    let row_from = match NaiveDate::parse_from_str(&row_from, "%Y-%m-%d") {
        Ok(value) => value,
        Err(_) => return false,
    };
    let row_to = match NaiveDate::parse_from_str(&row_to, "%Y-%m-%d") {
        Ok(value) => value,
        Err(_) => return false,
    };

    let from = from_date
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        .unwrap_or(row_from);
    let to = to_date
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        .unwrap_or(row_to);

    row_from < to && row_to > from
}

fn parse_uuid(value: &str, field: &str) -> AppResult<uuid::Uuid> {
    uuid::Uuid::parse_str(value)
        .map_err(|_| AppError::BadRequest(format!("Invalid {field}. Expected UUID.")))
}

fn parse_date(value: &str, field: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest(format!("Invalid {field}. Expected YYYY-MM-DD.")))
}

fn value_opt_str(row: &Value, key: &str) -> Option<String> {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn value_f64(row: &Value, key: &str) -> f64 {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(|value| match value {
            Value::Number(number) => number.as_f64(),
            Value::String(text) => text.parse::<f64>().ok(),
            _ => None,
        })
        .unwrap_or(0.0)
}

fn value_i64(row: &Value, key: &str) -> i64 {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(|value| match value {
            Value::Number(number) => number.as_i64(),
            Value::String(text) => text.parse::<i64>().ok(),
            _ => None,
        })
        .unwrap_or(0)
}

fn value_bool(row: &Value, key: &str) -> bool {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn map_db_error(error: sqlx::Error) -> AppError {
    tracing::error!(error = %error, "Reservation overview query failed");
    AppError::from_database_error(&error, "Failed to build reservation overview.")
}
