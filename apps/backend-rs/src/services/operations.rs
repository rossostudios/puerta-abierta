use serde_json::{json, Value};
use sqlx::{Postgres, QueryBuilder, Row};

use crate::{
    error::{AppError, AppResult},
    schemas::OperationsOverviewQuery,
    services::json_helpers::{non_empty_opt, value_str},
};

pub async fn build_operations_overview(
    pool: &sqlx::PgPool,
    query: &OperationsOverviewQuery,
) -> AppResult<Value> {
    let summary = fetch_overview_summary(pool, query).await?;
    let items = fetch_overview_items(pool, query).await?;
    let attention_items = fetch_attention_items(pool, query).await?;
    let ai_briefing_seed = build_ai_briefing_seed(&summary, &attention_items);

    Ok(json!({
        "summary": {
            "dueToday": summary.due_today,
            "slaRisk": summary.sla_risk,
            "unassigned": summary.unassigned,
            "turnoversToday": summary.turnovers_today,
        },
        "viewCounts": {
            "all": summary.total,
            "today": summary.due_today,
            "sla_risk": summary.sla_risk,
            "unassigned": summary.unassigned,
            "turnovers": summary.turnovers_today,
            "maintenance_emergency": summary.maintenance_emergency,
        },
        "items": items,
        "attentionItems": attention_items,
        "aiBriefingSeed": ai_briefing_seed,
    }))
}

#[derive(Debug, Default)]
struct OverviewSummary {
    total: i64,
    due_today: i64,
    sla_risk: i64,
    unassigned: i64,
    turnovers_today: i64,
    maintenance_emergency: i64,
}

async fn fetch_overview_summary(
    pool: &sqlx::PgPool,
    query: &OperationsOverviewQuery,
) -> AppResult<OverviewSummary> {
    let mut builder = QueryBuilder::<Postgres>::new(
        "SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (
                WHERE base.due_at IS NOT NULL
                  AND timezone('UTC', base.due_at)::date = CURRENT_DATE
            )::bigint AS due_today,
            COUNT(*) FILTER (
                WHERE base.sla_state IN ('watch', 'breached')
            )::bigint AS sla_risk,
            COUNT(*) FILTER (
                WHERE base.kind IN ('task', 'maintenance')
                  AND base.assignee_user_id IS NULL
            )::bigint AS unassigned,
            COUNT(*) FILTER (
                WHERE base.kind = 'turnover'
            )::bigint AS turnovers_today,
            COUNT(*) FILTER (
                WHERE base.kind = 'maintenance'
                  AND lower(base.priority) = 'emergency'
            )::bigint AS maintenance_emergency
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
        due_today: row.try_get::<i64, _>("due_today").unwrap_or(0),
        sla_risk: row.try_get::<i64, _>("sla_risk").unwrap_or(0),
        unassigned: row.try_get::<i64, _>("unassigned").unwrap_or(0),
        turnovers_today: row.try_get::<i64, _>("turnovers_today").unwrap_or(0),
        maintenance_emergency: row.try_get::<i64, _>("maintenance_emergency").unwrap_or(0),
    })
}

async fn fetch_overview_items(
    pool: &sqlx::PgPool,
    query: &OperationsOverviewQuery,
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
        .map(overview_item_contract)
        .collect())
}

async fn fetch_attention_items(
    pool: &sqlx::PgPool,
    query: &OperationsOverviewQuery,
) -> AppResult<Vec<Value>> {
    let mut builder = QueryBuilder::<Postgres>::new("SELECT row_to_json(t) AS row FROM (");
    push_overview_base_select(&mut builder, query)?;
    builder.push(
        ") t WHERE (
            t.sla_state IN ('watch', 'breached')
            OR lower(t.priority) IN ('critical', 'emergency', 'high', 'urgent')
            OR t.kind IN ('turnover', 'availability_conflict')
        )",
    );
    push_overview_outer_filters(&mut builder, query, true, "t");
    push_overview_sort(&mut builder, query.sort.as_deref());
    builder.push(" LIMIT 6");

    let rows = builder
        .build()
        .fetch_all(pool)
        .await
        .map_err(map_db_error)?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Option<Value>, _>("row").ok().flatten())
        .map(attention_item_contract)
        .collect())
}

fn push_overview_base_select(
    builder: &mut QueryBuilder<'_, Postgres>,
    query: &OperationsOverviewQuery,
) -> AppResult<()> {
    push_task_select(builder, query)?;
    builder.push(" UNION ALL ");
    push_maintenance_select(builder, query)?;
    builder.push(" UNION ALL ");
    push_turnover_select(builder, query)?;
    builder.push(" UNION ALL ");
    push_availability_conflict_select(builder, query)?;
    Ok(())
}

fn push_task_select(
    builder: &mut QueryBuilder<'_, Postgres>,
    query: &OperationsOverviewQuery,
) -> AppResult<()> {
    builder.push(
        "SELECT
            t.id::text AS id,
            'task'::text AS kind,
            COALESCE(NULLIF(t.title, ''), 'Task') AS title,
            COALESCE(NULLIF(t.status::text, ''), 'todo') AS status,
            COALESCE(NULLIF(t.priority::text, ''), 'medium') AS priority,
            p.id::text AS property_id,
            p.name AS property_name,
            u.id::text AS unit_id,
            COALESCE(NULLIF(u.name, ''), NULLIF(u.code, ''), 'Unit') AS unit_name,
            au.id::text AS assignee_user_id,
            COALESCE(NULLIF(au.full_name, ''), NULLIF(au.email, ''), NULLIF(au.id::text, '')) AS assignee_name,
            COALESCE(t.sla_due_at, t.due_at) AS due_at,
            t.created_at AS created_at,
            CASE
                WHEN t.sla_breached_at IS NOT NULL THEN 'breached'
                WHEN t.status::text IN ('todo', 'pending', 'in_progress')
                  AND t.sla_due_at IS NOT NULL
                  AND t.sla_due_at < now() THEN 'breached'
                WHEN t.status::text IN ('todo', 'pending', 'in_progress')
                  AND t.sla_due_at IS NOT NULL
                  AND t.sla_due_at < now() + interval '24 hours' THEN 'watch'
                ELSE 'none'
            END AS sla_state,
            format('/module/tasks/%s', t.id::text) AS source_href,
            format('/module/tasks/%s', t.id::text) AS primary_href,
            t.reservation_id::text AS reservation_id
        FROM tasks t
        LEFT JOIN properties p ON p.id = t.property_id
        LEFT JOIN units u ON u.id = t.unit_id
        LEFT JOIN app_users au ON au.id = t.assigned_user_id
        WHERE t.organization_id = ",
    );
    builder.push_bind(parse_uuid(&query.org_id, "org_id")?);
    builder.push(" AND COALESCE(t.status::text, '') NOT IN ('done', 'completed', 'cancelled')");

    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        builder
            .push(" AND t.property_id = ")
            .push_bind(parse_uuid(&property_id, "property_id")?);
    }
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        builder
            .push(" AND t.unit_id = ")
            .push_bind(parse_uuid(&unit_id, "unit_id")?);
    }
    if let Some(assigned_user_id) = non_empty_opt(query.assigned_user_id.as_deref()) {
        if assigned_user_id == "__unassigned__" || assigned_user_id == "unassigned" {
            builder.push(" AND t.assigned_user_id IS NULL");
        } else {
            builder
                .push(" AND t.assigned_user_id = ")
                .push_bind(parse_uuid(&assigned_user_id, "assigned_user_id")?);
        }
    }
    if let Some(reservation_id) = non_empty_opt(query.reservation_id.as_deref()) {
        builder
            .push(" AND t.reservation_id = ")
            .push_bind(parse_uuid(&reservation_id, "reservation_id")?);
    }
    if let Some(task_id) = non_empty_opt(query.task_id.as_deref()) {
        builder
            .push(" AND t.id = ")
            .push_bind(parse_uuid(&task_id, "task_id")?);
    }
    if let Some(q) = non_empty_opt(query.q.as_deref()) {
        let needle = format!("%{}%", q.to_ascii_lowercase());
        builder
            .push(" AND (lower(COALESCE(t.title, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(t.description, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(p.name, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(u.name, u.code, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(au.full_name, au.email, '')) LIKE ")
            .push_bind(needle)
            .push(")");
    }

    Ok(())
}

fn push_maintenance_select(
    builder: &mut QueryBuilder<'_, Postgres>,
    query: &OperationsOverviewQuery,
) -> AppResult<()> {
    builder.push(
        "SELECT
            mr.id::text AS id,
            'maintenance'::text AS kind,
            COALESCE(NULLIF(mr.title, ''), 'Maintenance request') AS title,
            COALESCE(NULLIF(mr.status::text, ''), 'submitted') AS status,
            COALESCE(NULLIF(mr.urgency::text, ''), 'medium') AS priority,
            p.id::text AS property_id,
            p.name AS property_name,
            u.id::text AS unit_id,
            COALESCE(NULLIF(u.name, ''), NULLIF(u.code, ''), 'Unit') AS unit_name,
            au.id::text AS assignee_user_id,
            COALESCE(NULLIF(au.full_name, ''), NULLIF(au.email, ''), NULLIF(au.id::text, '')) AS assignee_name,
            COALESCE(mr.scheduled_at, mr.acknowledged_at, mr.created_at) AS due_at,
            mr.created_at AS created_at,
            CASE
                WHEN COALESCE(mr.status::text, '') IN ('completed', 'closed') THEN 'none'
                WHEN COALESCE(mr.urgency::text, 'medium') = 'emergency' AND mr.created_at <= now() - interval '4 hours' THEN 'breached'
                WHEN COALESCE(mr.urgency::text, 'medium') = 'emergency' AND mr.created_at <= now() - interval '3 hours' THEN 'watch'
                WHEN COALESCE(mr.urgency::text, 'medium') = 'high' AND mr.created_at <= now() - interval '24 hours' THEN 'breached'
                WHEN COALESCE(mr.urgency::text, 'medium') = 'high' AND mr.created_at <= now() - interval '18 hours' THEN 'watch'
                WHEN COALESCE(mr.urgency::text, 'medium') = 'medium' AND mr.created_at <= now() - interval '72 hours' THEN 'breached'
                WHEN COALESCE(mr.urgency::text, 'medium') = 'medium' AND mr.created_at <= now() - interval '54 hours' THEN 'watch'
                WHEN COALESCE(mr.urgency::text, 'medium') = 'low' AND mr.created_at <= now() - interval '7 days' THEN 'breached'
                WHEN COALESCE(mr.urgency::text, 'medium') = 'low' AND mr.created_at <= now() - interval '5 days' THEN 'watch'
                ELSE 'none'
            END AS sla_state,
            format('/module/maintenance?request_id=%s', mr.id::text) AS source_href,
            format('/module/operations?tab=maintenance&request_id=%s', mr.id::text) AS primary_href,
            linked_task.reservation_id::text AS reservation_id
        FROM maintenance_requests mr
        LEFT JOIN properties p ON p.id = mr.property_id
        LEFT JOIN units u ON u.id = mr.unit_id
        LEFT JOIN tasks linked_task ON linked_task.id = mr.task_id
        LEFT JOIN app_users au ON au.id = linked_task.assigned_user_id
        WHERE mr.organization_id = ",
    );
    builder.push_bind(parse_uuid(&query.org_id, "org_id")?);
    builder.push(" AND COALESCE(mr.status::text, '') NOT IN ('completed', 'closed')");

    if let Some(property_id) = non_empty_opt(query.property_id.as_deref()) {
        builder
            .push(" AND mr.property_id = ")
            .push_bind(parse_uuid(&property_id, "property_id")?);
    }
    if let Some(unit_id) = non_empty_opt(query.unit_id.as_deref()) {
        builder
            .push(" AND mr.unit_id = ")
            .push_bind(parse_uuid(&unit_id, "unit_id")?);
    }
    if let Some(assigned_user_id) = non_empty_opt(query.assigned_user_id.as_deref()) {
        if assigned_user_id == "__unassigned__" || assigned_user_id == "unassigned" {
            builder.push(" AND linked_task.assigned_user_id IS NULL");
        } else {
            builder
                .push(" AND linked_task.assigned_user_id = ")
                .push_bind(parse_uuid(&assigned_user_id, "assigned_user_id")?);
        }
    }
    if let Some(reservation_id) = non_empty_opt(query.reservation_id.as_deref()) {
        builder
            .push(" AND linked_task.reservation_id = ")
            .push_bind(parse_uuid(&reservation_id, "reservation_id")?);
    }
    if let Some(request_id) = non_empty_opt(query.request_id.as_deref()) {
        builder
            .push(" AND mr.id = ")
            .push_bind(parse_uuid(&request_id, "request_id")?);
    }
    if let Some(q) = non_empty_opt(query.q.as_deref()) {
        let needle = format!("%{}%", q.to_ascii_lowercase());
        builder
            .push(" AND (lower(COALESCE(mr.title, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(mr.description, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(p.name, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(u.name, u.code, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(mr.submitted_by_name, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(au.full_name, au.email, '')) LIKE ")
            .push_bind(needle)
            .push(")");
    }

    Ok(())
}

fn push_turnover_select(
    builder: &mut QueryBuilder<'_, Postgres>,
    query: &OperationsOverviewQuery,
) -> AppResult<()> {
    builder.push(
        "SELECT
            r.id::text AS id,
            'turnover'::text AS kind,
            CASE
                WHEN r.check_in_date = CURRENT_DATE
                    AND r.status::text IN ('pending', 'confirmed', 'checked_in')
                  THEN concat('Arrival · ', COALESCE(NULLIF(g.full_name, ''), 'Guest'))
                ELSE concat('Departure · ', COALESCE(NULLIF(g.full_name, ''), 'Guest'))
            END AS title,
            CASE
                WHEN r.check_in_date = CURRENT_DATE
                    AND r.status::text IN ('pending', 'confirmed', 'checked_in')
                  THEN 'arriving_today'
                ELSE 'departing_today'
            END AS status,
            'high'::text AS priority,
            p.id::text AS property_id,
            p.name AS property_name,
            u.id::text AS unit_id,
            COALESCE(NULLIF(u.name, ''), NULLIF(u.code, ''), 'Unit') AS unit_name,
            NULL::text AS assignee_user_id,
            NULL::text AS assignee_name,
            CASE
                WHEN r.check_in_date = CURRENT_DATE
                    AND r.status::text IN ('pending', 'confirmed', 'checked_in')
                  THEN (r.check_in_date::timestamp AT TIME ZONE 'UTC')
                ELSE (r.check_out_date::timestamp AT TIME ZONE 'UTC')
            END AS due_at,
            r.created_at AS created_at,
            CASE
                WHEN COALESCE(turnover_tasks.open_tasks, 0) > 0 THEN 'watch'
                ELSE 'none'
            END AS sla_state,
            format('/module/reservations/%s', r.id::text) AS source_href,
            format('/module/reservations/%s', r.id::text) AS primary_href,
            r.id::text AS reservation_id
        FROM reservations r
        LEFT JOIN guests g ON g.id = r.guest_id
        LEFT JOIN units u ON u.id = r.unit_id
        LEFT JOIN properties p ON p.id = u.property_id
        LEFT JOIN LATERAL (
            SELECT COUNT(*) FILTER (
                WHERE t.status::text NOT IN ('done', 'completed', 'cancelled')
                  AND t.type::text IN ('check_in', 'check_out', 'cleaning', 'inspection')
            )::int AS open_tasks
            FROM tasks t
            WHERE t.reservation_id = r.id
        ) turnover_tasks ON TRUE
        WHERE r.organization_id = ",
    );
    builder.push_bind(parse_uuid(&query.org_id, "org_id")?);
    builder.push(
        " AND (
            (r.check_in_date = CURRENT_DATE AND r.status::text IN ('pending', 'confirmed', 'checked_in'))
            OR
            (r.check_out_date = CURRENT_DATE AND r.status::text IN ('confirmed', 'checked_in', 'checked_out'))
        )",
    );

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
    if let Some(reservation_id) = non_empty_opt(query.reservation_id.as_deref()) {
        builder
            .push(" AND r.id = ")
            .push_bind(parse_uuid(&reservation_id, "reservation_id")?);
    }
    if let Some(q) = non_empty_opt(query.q.as_deref()) {
        let needle = format!("%{}%", q.to_ascii_lowercase());
        builder
            .push(" AND (lower(COALESCE(g.full_name, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(p.name, '')) LIKE ")
            .push_bind(needle.clone())
            .push(" OR lower(COALESCE(u.name, u.code, '')) LIKE ")
            .push_bind(needle)
            .push(")");
    }

    Ok(())
}

fn push_availability_conflict_select(
    builder: &mut QueryBuilder<'_, Postgres>,
    query: &OperationsOverviewQuery,
) -> AppResult<()> {
    builder.push(
        "SELECT
            concat('conflict:', r.id::text, ':', cb.id::text) AS id,
            'availability_conflict'::text AS kind,
            concat('Availability conflict · ', COALESCE(NULLIF(g.full_name, ''), 'Guest')) AS title,
            'conflict'::text AS status,
            CASE
                WHEN CURRENT_DATE >= cb.starts_on AND CURRENT_DATE < cb.ends_on THEN 'critical'
                ELSE 'high'
            END AS priority,
            p.id::text AS property_id,
            p.name AS property_name,
            u.id::text AS unit_id,
            COALESCE(NULLIF(u.name, ''), NULLIF(u.code, ''), 'Unit') AS unit_name,
            NULL::text AS assignee_user_id,
            NULL::text AS assignee_name,
            (cb.starts_on::timestamp AT TIME ZONE 'UTC') AS due_at,
            cb.created_at AS created_at,
            CASE
                WHEN CURRENT_DATE >= cb.starts_on AND CURRENT_DATE < cb.ends_on THEN 'breached'
                ELSE 'watch'
            END AS sla_state,
            format('/module/calendar?unit_id=%s', u.id::text) AS source_href,
            format('/module/reservations/%s', r.id::text) AS primary_href,
            r.id::text AS reservation_id
        FROM calendar_blocks cb
        JOIN reservations r
          ON r.organization_id = cb.organization_id
         AND r.unit_id = cb.unit_id
         AND r.status::text IN ('pending', 'confirmed', 'checked_in')
         AND r.check_out_date > cb.starts_on
         AND r.check_in_date < cb.ends_on
        LEFT JOIN guests g ON g.id = r.guest_id
        LEFT JOIN units u ON u.id = cb.unit_id
        LEFT JOIN properties p ON p.id = u.property_id
        WHERE cb.organization_id = ",
    );
    builder.push_bind(parse_uuid(&query.org_id, "org_id")?);
    builder.push(" AND lower(COALESCE(cb.source, 'manual')) = 'manual'");

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
    if let Some(reservation_id) = non_empty_opt(query.reservation_id.as_deref()) {
        builder
            .push(" AND r.id = ")
            .push_bind(parse_uuid(&reservation_id, "reservation_id")?);
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
            .push(" OR lower(COALESCE(cb.reason, '')) LIKE ")
            .push_bind(needle)
            .push(")");
    }

    Ok(())
}

fn push_overview_outer_filters(
    builder: &mut QueryBuilder<'_, Postgres>,
    query: &OperationsOverviewQuery,
    include_view: bool,
    alias: &str,
) {
    if let Some(kind) = non_empty_opt(query.kind.as_deref()) {
        builder
            .push(" AND ")
            .push(alias)
            .push(".kind = ")
            .push_bind(kind.to_ascii_lowercase());
    }

    if !include_view {
        return;
    }

    match non_empty_opt(query.view.as_deref()).as_deref() {
        Some("today") => {
            builder
                .push(" AND ")
                .push(alias)
                .push(".due_at IS NOT NULL AND timezone('UTC', ")
                .push(alias)
                .push(".due_at)::date = CURRENT_DATE");
        }
        Some("sla_risk") => {
            builder
                .push(" AND ")
                .push(alias)
                .push(".sla_state IN ('watch', 'breached')");
        }
        Some("unassigned") => {
            builder
                .push(" AND ")
                .push(alias)
                .push(".kind IN ('task', 'maintenance') AND ")
                .push(alias)
                .push(".assignee_user_id IS NULL");
        }
        Some("turnovers") => {
            builder.push(" AND ").push(alias).push(".kind = 'turnover'");
        }
        Some("maintenance_emergency") => {
            builder
                .push(" AND ")
                .push(alias)
                .push(".kind = 'maintenance' AND lower(")
                .push(alias)
                .push(".priority) = 'emergency'");
        }
        _ => {}
    }
}

fn push_overview_sort(builder: &mut QueryBuilder<'_, Postgres>, sort: Option<&str>) {
    match non_empty_opt(sort).as_deref() {
        Some("due_asc") => builder
            .push(" ORDER BY t.due_at ASC NULLS LAST, t.created_at DESC NULLS LAST, t.id ASC"),
        Some("created_desc") => builder
            .push(" ORDER BY t.created_at DESC NULLS LAST, t.due_at ASC NULLS LAST, t.id ASC"),
        Some("sla_desc") => builder.push(
            " ORDER BY
                CASE t.sla_state
                    WHEN 'breached' THEN 0
                    WHEN 'watch' THEN 1
                    ELSE 2
                END,
                t.due_at ASC NULLS LAST,
                t.id ASC",
        ),
        _ => builder.push(
            " ORDER BY
                CASE lower(t.priority)
                    WHEN 'critical' THEN 0
                    WHEN 'emergency' THEN 1
                    WHEN 'urgent' THEN 2
                    WHEN 'high' THEN 3
                    WHEN 'medium' THEN 4
                    WHEN 'low' THEN 5
                    ELSE 6
                END,
                CASE t.sla_state
                    WHEN 'breached' THEN 0
                    WHEN 'watch' THEN 1
                    ELSE 2
                END,
                t.due_at ASC NULLS LAST,
                t.created_at DESC NULLS LAST,
                t.id ASC",
        ),
    };
}

fn overview_item_contract(row: Value) -> Value {
    let id = value_str(&row, "id");
    json!({
        "id": id,
        "kind": value_str(&row, "kind"),
        "title": value_str(&row, "title"),
        "status": value_str(&row, "status"),
        "priority": value_str(&row, "priority"),
        "propertyId": value_opt_str(&row, "property_id"),
        "propertyName": value_opt_str(&row, "property_name"),
        "unitId": value_opt_str(&row, "unit_id"),
        "unitName": value_opt_str(&row, "unit_name"),
        "assigneeUserId": value_opt_str(&row, "assignee_user_id"),
        "assigneeName": value_opt_str(&row, "assignee_name"),
        "dueAt": value_opt_str(&row, "due_at"),
        "createdAt": value_opt_str(&row, "created_at"),
        "slaState": value_str(&row, "sla_state"),
        "sourceHref": value_str(&row, "source_href"),
        "primaryHref": value_str(&row, "primary_href"),
    })
}

fn attention_item_contract(row: Value) -> Value {
    let kind = value_str(&row, "kind");
    let property_name = value_opt_str(&row, "property_name");
    let unit_name = value_opt_str(&row, "unit_name");
    let status = value_str(&row, "status");
    let subtitle_parts = [
        match kind.as_str() {
            "turnover" => Some("Turnover".to_string()),
            "maintenance" => Some("Maintenance".to_string()),
            "availability_conflict" => Some("Calendar conflict".to_string()),
            _ => Some("Task".to_string()),
        },
        property_name,
        unit_name,
        if status.is_empty() || status == "conflict" {
            None
        } else {
            Some(status.replace('_', " "))
        },
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");

    json!({
        "id": value_str(&row, "id"),
        "title": value_str(&row, "title"),
        "subtitle": subtitle_parts,
        "href": value_str(&row, "primary_href"),
        "severity": attention_severity(&row),
    })
}

fn attention_severity(row: &Value) -> &'static str {
    match value_str(row, "sla_state").as_str() {
        "breached" => "high",
        "watch" => "medium",
        _ => match value_str(row, "priority").to_ascii_lowercase().as_str() {
            "critical" | "emergency" | "high" | "urgent" => "high",
            "medium" => "medium",
            _ => "low",
        },
    }
}

fn build_ai_briefing_seed(summary: &OverviewSummary, attention_items: &[Value]) -> String {
    let mut parts = vec![format!(
        "{} due today, {} at SLA risk, {} unassigned, {} turnovers today.",
        summary.due_today, summary.sla_risk, summary.unassigned, summary.turnovers_today
    )];

    if !attention_items.is_empty() {
        let titles = attention_items
            .iter()
            .take(3)
            .map(|item| value_str(item, "title"))
            .filter(|title| !title.is_empty())
            .collect::<Vec<_>>();
        if !titles.is_empty() {
            parts.push(format!("Focus on: {}.", titles.join("; ")));
        }
    }

    parts.join(" ")
}

fn parse_uuid(value: &str, field: &str) -> AppResult<uuid::Uuid> {
    uuid::Uuid::parse_str(value).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid {}. Expected UUID, received '{}'.",
            field, value
        ))
    })
}

fn value_opt_str(row: &Value, key: &str) -> Option<String> {
    let value = value_str(row, key);
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn map_db_error(error: sqlx::Error) -> AppError {
    tracing::error!(error = %error, "Operations overview query failed");
    AppError::from_database_error(&error, "Failed to load operations overview.")
}
