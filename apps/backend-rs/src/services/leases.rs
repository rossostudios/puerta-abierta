use std::collections::{HashMap, HashSet};

use chrono::Utc;
use serde_json::{json, Map, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    repository::table_service::{get_row, list_rows},
    schemas::LeasesOverviewQuery,
    services::json_helpers::{json_map, non_empty_opt, round2, value_str},
};

type LeaseCollectionState = &'static str;

#[derive(Debug, Clone)]
struct OverviewLeaseRow {
    id: String,
    application_id: Option<String>,
    tenant_name: String,
    tenant_email: Option<String>,
    tenant_phone: Option<String>,
    property_id: Option<String>,
    property_name: Option<String>,
    unit_id: Option<String>,
    unit_name: Option<String>,
    space_id: Option<String>,
    space_name: Option<String>,
    bed_id: Option<String>,
    bed_code: Option<String>,
    lease_status: String,
    renewal_status: Option<String>,
    starts_on: String,
    ends_on: Option<String>,
    currency: String,
    monthly_rent: f64,
    service_fee_flat: f64,
    security_deposit: f64,
    guarantee_option_fee: f64,
    tax_iva: f64,
    platform_fee: f64,
    total_move_in: f64,
    monthly_recurring_total: f64,
    notes: Option<String>,
    paid_count: i32,
    open_count: i32,
    overdue_count: i32,
    unpaid_amount: f64,
    documents_count: i32,
    parent_lease_id: Option<String>,
    child_lease_id: Option<String>,
    renewal_offered_rent: Option<f64>,
    updated_at: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct LeaseCollectionStats {
    paid_count: i32,
    open_count: i32,
    overdue_count: i32,
    unpaid_amount: f64,
}

pub async fn build_leases_overview(
    pool: &sqlx::PgPool,
    query: &LeasesOverviewQuery,
) -> AppResult<Value> {
    let mut rows = fetch_overview_rows(pool, query).await?;
    let summary = build_summary(&rows);
    let view_counts = build_view_counts(&rows);

    rows.retain(|row| matches_view(row, query.view.as_deref()));
    sort_rows(&mut rows, query.sort.as_deref());

    let offset = query.offset.max(0) as usize;
    let limit = query.limit.clamp(1, 100) as usize;
    let display_rows = rows
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|row| overview_row_contract(&row))
        .collect::<Vec<_>>();

    Ok(json!({
        "summary": summary,
        "viewCounts": view_counts,
        "rows": display_rows,
    }))
}

pub async fn build_lease_detail_overview(pool: &sqlx::PgPool, lease_id: &str) -> AppResult<Value> {
    let row = fetch_detail_row(pool, lease_id).await?;

    let collections = list_rows(
        pool,
        "collection_records",
        Some(&json_map(&[(
            "lease_id",
            Value::String(lease_id.to_string()),
        )])),
        100,
        0,
        "due_date",
        true,
    )
    .await?;

    let documents = list_rows(
        pool,
        "documents",
        Some(&json_map(&[
            ("entity_type", Value::String("lease".to_string())),
            ("entity_id", Value::String(lease_id.to_string())),
        ])),
        100,
        0,
        "created_at",
        false,
    )
    .await?;

    let recent_collections = collections
        .iter()
        .take(5)
        .map(|item| {
            json!({
                "id": value_str(item, "id"),
                "dueDate": value_opt_str(item, "due_date"),
                "status": value_opt_str(item, "status"),
                "amount": value_f64(item, "amount"),
                "currency": value_opt_str(item, "currency"),
                "paidAt": value_opt_str(item, "paid_at"),
            })
        })
        .collect::<Vec<_>>();

    let collection_state = collection_state(&row);
    let lease_status_label = lease_status_label(&row.lease_status);
    let lease_id_value = row.id.clone();
    let application_id = row.application_id.clone();
    let property_id = row.property_id.clone();
    let property_name = row.property_name.clone();
    let unit_id = row.unit_id.clone();
    let unit_name = row.unit_name.clone();
    let space_id = row.space_id.clone();
    let space_name = row.space_name.clone();
    let bed_id = row.bed_id.clone();
    let bed_code = row.bed_code.clone();
    let lease_status = row.lease_status.clone();
    let renewal_status = row.renewal_status.clone();
    let starts_on = row.starts_on.clone();
    let ends_on = row.ends_on.clone();
    let currency = row.currency.clone();
    let notes = row.notes.clone();
    let parent_lease_id = row.parent_lease_id.clone();
    let child_lease_id = row.child_lease_id.clone();
    let collections_href = format!("/module/collections?lease_id={lease_id_value}");
    let property_href = row
        .property_id
        .as_ref()
        .map(|property_id| format!("/module/properties/{property_id}"));
    let unit_href = row
        .unit_id
        .as_ref()
        .map(|unit_id| format!("/module/units/{unit_id}"));

    Ok(json!({
        "lease": {
            "id": lease_id_value.clone(),
            "tenantName": row.tenant_name.as_str(),
            "tenantEmail": row.tenant_email.as_deref(),
            "tenantPhoneE164": row.tenant_phone.as_deref(),
            "propertyId": property_id.as_deref(),
            "propertyName": property_name.as_deref(),
            "unitId": unit_id.as_deref(),
            "unitName": unit_name.as_deref(),
            "spaceId": space_id.as_deref(),
            "spaceName": space_name.as_deref(),
            "bedId": bed_id.as_deref(),
            "bedCode": bed_code.as_deref(),
            "leaseStatus": lease_status.as_str(),
            "leaseStatusLabel": lease_status_label,
            "renewalStatus": renewal_status.as_deref(),
            "startsOn": starts_on.as_str(),
            "endsOn": ends_on.as_deref(),
            "currency": currency.as_str(),
            "monthlyRecurringTotal": round2(row.monthly_recurring_total),
            "collectionState": collection_state,
            "overdueCount": row.overdue_count,
            "unpaidAmount": round2(row.unpaid_amount),
            "documentsCount": row.documents_count,
            "primaryHref": format!("/module/leases/{lease_id_value}"),
            "notes": notes.as_deref(),
            "monthlyRent": round2(row.monthly_rent),
            "serviceFeeFlat": round2(row.service_fee_flat),
            "securityDeposit": round2(row.security_deposit),
            "guaranteeOptionFee": round2(row.guarantee_option_fee),
            "taxIva": round2(row.tax_iva),
            "platformFee": round2(row.platform_fee),
            "totalMoveIn": round2(row.total_move_in),
        },
        "occupancy": {
            "propertyId": property_id.as_deref(),
            "propertyName": property_name.as_deref(),
            "unitId": unit_id.as_deref(),
            "unitName": unit_name.as_deref(),
            "spaceId": space_id.as_deref(),
            "spaceName": space_name.as_deref(),
            "bedId": bed_id.as_deref(),
            "bedCode": bed_code.as_deref(),
        },
        "collections": {
            "state": collection_state,
            "paidCount": row.paid_count,
            "openCount": row.open_count,
            "overdueCount": row.overdue_count,
            "unpaidAmount": round2(row.unpaid_amount),
            "recent": recent_collections,
            "href": collections_href,
        },
        "documents": {
            "total": documents.len(),
            "items": documents,
        },
        "renewal": {
            "status": renewal_status.as_deref(),
            "canOffer": can_offer_renewal(&row),
            "canAccept": can_accept_renewal(&row),
            "offeredRent": row.renewal_offered_rent.map(round2),
            "parentLeaseId": parent_lease_id.as_deref(),
            "childLeaseId": child_lease_id.as_deref(),
        },
        "related": {
            "applicationId": application_id.as_deref(),
            "propertyHref": property_href,
            "unitHref": unit_href,
            "collectionsHref": collections_href,
        },
    }))
}

pub async fn enrich_lease_rows(pool: &sqlx::PgPool, rows: Vec<Value>) -> AppResult<Vec<Value>> {
    if rows.is_empty() {
        return Ok(rows);
    }

    let property_ids = extract_ids(&rows, "property_id");
    let unit_ids = extract_ids(&rows, "unit_id");
    let space_ids = extract_ids(&rows, "space_id");
    let bed_ids = extract_ids(&rows, "bed_id");
    let lease_ids = extract_ids(&rows, "id");

    let property_ids_for_query = property_ids.clone();
    let unit_ids_for_query = unit_ids.clone();
    let space_ids_for_query = space_ids.clone();
    let bed_ids_for_query = bed_ids.clone();
    let lease_ids_for_query = lease_ids.clone();
    let lease_ids_for_documents = lease_ids.clone();
    let lease_ids_for_children = lease_ids.clone();

    let (properties, units, spaces, beds, collections, documents, child_leases) = tokio::try_join!(
        async move { rows_for_ids(pool, "properties", &property_ids_for_query).await },
        async move { rows_for_ids(pool, "units", &unit_ids_for_query).await },
        async move { rows_for_ids(pool, "unit_spaces", &space_ids_for_query).await },
        async move { rows_for_ids(pool, "unit_beds", &bed_ids_for_query).await },
        async move {
            if lease_ids_for_query.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "collection_records",
                    Some(&json_map(&[(
                        "lease_id",
                        Value::Array(
                            lease_ids_for_query
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    )])),
                    std::cmp::max(400, (lease_ids_for_query.len() as i64) * 12),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        },
        async move {
            if lease_ids_for_documents.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "documents",
                    Some(&json_map(&[
                        ("entity_type", Value::String("lease".to_string())),
                        (
                            "entity_id",
                            Value::Array(
                                lease_ids_for_documents
                                    .iter()
                                    .cloned()
                                    .map(Value::String)
                                    .collect(),
                            ),
                        ),
                    ])),
                    std::cmp::max(300, lease_ids_for_documents.len() as i64),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        },
        async move {
            if lease_ids_for_children.is_empty() {
                Ok(Vec::new())
            } else {
                list_rows(
                    pool,
                    "leases",
                    Some(&json_map(&[(
                        "parent_lease_id",
                        Value::Array(
                            lease_ids_for_children
                                .iter()
                                .cloned()
                                .map(Value::String)
                                .collect(),
                        ),
                    )])),
                    std::cmp::max(200, lease_ids_for_children.len() as i64),
                    0,
                    "created_at",
                    false,
                )
                .await
            }
        }
    )?;

    let property_names = map_by_id_field(&properties, "name");
    let unit_names = map_by_first_present_field(&units, &["name", "code"]);
    let space_names = map_by_id_field(&spaces, "name");
    let bed_codes = map_by_id_field(&beds, "code");

    let mut collection_stats = HashMap::<String, LeaseCollectionStats>::new();
    let today = Utc::now().date_naive().to_string();
    for collection in collections {
        let lease_id = value_str(&collection, "lease_id");
        if lease_id.is_empty() {
            continue;
        }
        let stats = collection_stats.entry(lease_id).or_default();
        let amount = value_f64(&collection, "amount");
        let status = value_str(&collection, "status");
        if status == "paid" {
            stats.paid_count += 1;
        }
        if matches!(status.as_str(), "scheduled" | "pending" | "late") {
            stats.open_count += 1;
            stats.unpaid_amount += amount;
            let due_date = value_str(&collection, "due_date");
            if !due_date.is_empty() && due_date < today {
                stats.overdue_count += 1;
            }
        }
    }

    let mut documents_count_by_lease_id = HashMap::<String, i32>::new();
    for document in documents {
        let lease_id = value_str(&document, "entity_id");
        if lease_id.is_empty() {
            continue;
        }
        *documents_count_by_lease_id.entry(lease_id).or_insert(0) += 1;
    }

    let mut child_lease_by_parent = HashMap::<String, String>::new();
    for child in child_leases {
        let parent_id = value_str(&child, "parent_lease_id");
        let child_id = value_str(&child, "id");
        if parent_id.is_empty() || child_id.is_empty() {
            continue;
        }
        child_lease_by_parent.entry(parent_id).or_insert(child_id);
    }

    let mut enriched = Vec::with_capacity(rows.len());
    for mut row in rows {
        let lease_status = value_str(&row, "lease_status");
        if let Some(obj) = row.as_object_mut() {
            set_lookup_field(obj, "property_id", "property_name", &property_names);
            set_lookup_field(obj, "unit_id", "unit_name", &unit_names);
            set_lookup_field(obj, "space_id", "space_name", &space_names);
            set_lookup_field(obj, "bed_id", "bed_code", &bed_codes);

            let lease_id = obj
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            let stats = collection_stats.get(&lease_id).cloned().unwrap_or_default();
            obj.insert("collection_paid_count".to_string(), json!(stats.paid_count));
            obj.insert("collection_open_count".to_string(), json!(stats.open_count));
            obj.insert("overdue_count".to_string(), json!(stats.overdue_count));
            obj.insert(
                "unpaid_amount".to_string(),
                json!(round2(stats.unpaid_amount)),
            );
            obj.insert(
                "documents_count".to_string(),
                json!(documents_count_by_lease_id
                    .get(&lease_id)
                    .copied()
                    .unwrap_or(0)),
            );
            if let Some(child_lease_id) = child_lease_by_parent.get(&lease_id) {
                obj.insert(
                    "child_lease_id".to_string(),
                    Value::String(child_lease_id.clone()),
                );
            }
            let collection_state = collection_state_from_stats(&stats, lease_status.as_str());
            obj.insert(
                "collection_state".to_string(),
                Value::String(collection_state.to_string()),
            );
        }
        enriched.push(row);
    }

    Ok(enriched)
}

async fn fetch_overview_rows(
    pool: &sqlx::PgPool,
    query: &LeasesOverviewQuery,
) -> AppResult<Vec<OverviewLeaseRow>> {
    let parsed_org_id = parse_uuid(&query.org_id, "org_id")?;
    let property_id = parse_optional_uuid(query.property_id.as_deref(), "property_id")?;
    let unit_id = parse_optional_uuid(query.unit_id.as_deref(), "unit_id")?;
    let q = non_empty_opt(query.q.as_deref());
    let lease_status = non_empty_opt(query.lease_status.as_deref());
    let renewal_status = non_empty_opt(query.renewal_status.as_deref());

    let rows = sqlx::query(
        "SELECT
            l.id::text AS id,
            l.application_id::text AS application_id,
            l.tenant_full_name,
            l.tenant_email::text AS tenant_email,
            l.tenant_phone_e164,
            l.property_id::text AS property_id,
            p.name AS property_name,
            l.unit_id::text AS unit_id,
            COALESCE(NULLIF(u.name, ''), u.code) AS unit_name,
            l.space_id::text AS space_id,
            s.name AS space_name,
            l.bed_id::text AS bed_id,
            b.code AS bed_code,
            l.lease_status::text AS lease_status,
            l.renewal_status,
            l.starts_on,
            l.ends_on,
            l.currency::text AS currency,
            COALESCE(l.monthly_rent, 0)::float8 AS monthly_rent,
            COALESCE(l.service_fee_flat, 0)::float8 AS service_fee_flat,
            COALESCE(l.security_deposit, 0)::float8 AS security_deposit,
            COALESCE(l.guarantee_option_fee, 0)::float8 AS guarantee_option_fee,
            COALESCE(l.tax_iva, 0)::float8 AS tax_iva,
            COALESCE(l.platform_fee, 0)::float8 AS platform_fee,
            COALESCE(l.total_move_in, 0)::float8 AS total_move_in,
            COALESCE(l.monthly_recurring_total, 0)::float8 AS monthly_recurring_total,
            l.notes,
            COALESCE(coll.paid_count, 0)::int AS paid_count,
            COALESCE(coll.open_count, 0)::int AS open_count,
            COALESCE(coll.overdue_count, 0)::int AS overdue_count,
            COALESCE(coll.unpaid_amount, 0)::float8 AS unpaid_amount,
            COALESCE(docs.documents_count, 0)::int AS documents_count,
            l.parent_lease_id::text AS parent_lease_id,
            child.child_lease_id,
            l.renewal_offered_rent::float8 AS renewal_offered_rent,
            l.updated_at
         FROM leases l
         LEFT JOIN properties p ON p.id = l.property_id
         LEFT JOIN units u ON u.id = l.unit_id
         LEFT JOIN unit_spaces s ON s.id = l.space_id
         LEFT JOIN unit_beds b ON b.id = l.bed_id
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
             COUNT(*) FILTER (WHERE status IN ('scheduled', 'pending', 'late'))::int AS open_count,
             COUNT(*) FILTER (
               WHERE status IN ('scheduled', 'pending', 'late') AND due_date < CURRENT_DATE
             )::int AS overdue_count,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('scheduled', 'pending', 'late')), 0)::float8 AS unpaid_amount
           FROM collection_records
           WHERE lease_id = l.id
         ) coll ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS documents_count
           FROM documents
           WHERE organization_id = l.organization_id
             AND entity_type = 'lease'
             AND entity_id = l.id
         ) docs ON TRUE
         LEFT JOIN LATERAL (
           SELECT child.id::text AS child_lease_id
           FROM leases child
           WHERE child.parent_lease_id = l.id
           ORDER BY child.created_at DESC
           LIMIT 1
         ) child ON TRUE
         WHERE l.organization_id = $1::uuid
           AND ($2::text IS NULL OR l.lease_status::text = $2)
           AND ($3::text IS NULL OR l.renewal_status = $3)
           AND ($4::uuid IS NULL OR l.property_id = $4)
           AND ($5::uuid IS NULL OR l.unit_id = $5)
           AND (
             $6::text IS NULL OR
             concat_ws(
               ' ',
               l.tenant_full_name,
               COALESCE(l.tenant_email::text, ''),
               COALESCE(p.name, ''),
               COALESCE(u.name, ''),
               COALESCE(u.code, ''),
               COALESCE(s.name, ''),
               COALESCE(b.code, '')
             ) ILIKE '%' || $6 || '%'
           )",
    )
    .bind(parsed_org_id)
    .bind(lease_status)
    .bind(renewal_status)
    .bind(property_id)
    .bind(unit_id)
    .bind(q)
    .fetch_all(pool)
    .await
    .map_err(|err| AppError::Internal(format!("leases overview query failed: {err}")))?;

    Ok(rows.into_iter().map(map_overview_row).collect())
}

async fn fetch_detail_row(pool: &sqlx::PgPool, lease_id: &str) -> AppResult<OverviewLeaseRow> {
    let parsed_lease_id = parse_uuid(lease_id, "lease_id")?;
    let row = sqlx::query(
        "SELECT
            l.id::text AS id,
            l.application_id::text AS application_id,
            l.tenant_full_name,
            l.tenant_email::text AS tenant_email,
            l.tenant_phone_e164,
            l.property_id::text AS property_id,
            p.name AS property_name,
            l.unit_id::text AS unit_id,
            COALESCE(NULLIF(u.name, ''), u.code) AS unit_name,
            l.space_id::text AS space_id,
            s.name AS space_name,
            l.bed_id::text AS bed_id,
            b.code AS bed_code,
            l.lease_status::text AS lease_status,
            l.renewal_status,
            l.starts_on,
            l.ends_on,
            l.currency::text AS currency,
            COALESCE(l.monthly_rent, 0)::float8 AS monthly_rent,
            COALESCE(l.service_fee_flat, 0)::float8 AS service_fee_flat,
            COALESCE(l.security_deposit, 0)::float8 AS security_deposit,
            COALESCE(l.guarantee_option_fee, 0)::float8 AS guarantee_option_fee,
            COALESCE(l.tax_iva, 0)::float8 AS tax_iva,
            COALESCE(l.platform_fee, 0)::float8 AS platform_fee,
            COALESCE(l.total_move_in, 0)::float8 AS total_move_in,
            COALESCE(l.monthly_recurring_total, 0)::float8 AS monthly_recurring_total,
            l.notes,
            COALESCE(coll.paid_count, 0)::int AS paid_count,
            COALESCE(coll.open_count, 0)::int AS open_count,
            COALESCE(coll.overdue_count, 0)::int AS overdue_count,
            COALESCE(coll.unpaid_amount, 0)::float8 AS unpaid_amount,
            COALESCE(docs.documents_count, 0)::int AS documents_count,
            l.parent_lease_id::text AS parent_lease_id,
            child.child_lease_id,
            l.renewal_offered_rent::float8 AS renewal_offered_rent,
            l.updated_at
         FROM leases l
         LEFT JOIN properties p ON p.id = l.property_id
         LEFT JOIN units u ON u.id = l.unit_id
         LEFT JOIN unit_spaces s ON s.id = l.space_id
         LEFT JOIN unit_beds b ON b.id = l.bed_id
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
             COUNT(*) FILTER (WHERE status IN ('scheduled', 'pending', 'late'))::int AS open_count,
             COUNT(*) FILTER (
               WHERE status IN ('scheduled', 'pending', 'late') AND due_date < CURRENT_DATE
             )::int AS overdue_count,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('scheduled', 'pending', 'late')), 0)::float8 AS unpaid_amount
           FROM collection_records
           WHERE lease_id = l.id
         ) coll ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS documents_count
           FROM documents
           WHERE organization_id = l.organization_id
             AND entity_type = 'lease'
             AND entity_id = l.id
         ) docs ON TRUE
         LEFT JOIN LATERAL (
           SELECT child.id::text AS child_lease_id
           FROM leases child
           WHERE child.parent_lease_id = l.id
           ORDER BY child.created_at DESC
           LIMIT 1
         ) child ON TRUE
         WHERE l.id = $1::uuid
         LIMIT 1",
    )
    .bind(parsed_lease_id)
    .fetch_optional(pool)
    .await
    .map_err(|err| AppError::Internal(format!("lease detail query failed: {err}")))?;

    row.map(map_overview_row)
        .ok_or_else(|| AppError::NotFound("Lease not found.".to_string()))
}

fn build_summary(rows: &[OverviewLeaseRow]) -> Value {
    let active = rows
        .iter()
        .filter(|row| matches!(row.lease_status.as_str(), "active" | "delinquent"))
        .count();
    let expiring_60d = rows
        .iter()
        .filter(|row| is_expiring_within_days(row, 60))
        .count();
    let delinquent = rows
        .iter()
        .filter(|row| collection_state(row) == "overdue")
        .count();
    let monthly_recurring_due = rows
        .iter()
        .filter(|row| matches!(row.lease_status.as_str(), "active" | "delinquent"))
        .map(|row| row.monthly_recurring_total)
        .sum::<f64>();

    json!({
        "active": active,
        "expiring60d": expiring_60d,
        "delinquent": delinquent,
        "monthlyRecurringDue": round2(monthly_recurring_due),
    })
}

fn build_view_counts(rows: &[OverviewLeaseRow]) -> Value {
    json!({
        "all": rows.len(),
        "drafts": rows.iter().filter(|row| row.lease_status == "draft").count(),
        "expiring_60d": rows.iter().filter(|row| is_expiring_within_days(row, 60)).count(),
        "delinquent": rows.iter().filter(|row| collection_state(row) == "overdue").count(),
        "renewal_offered": rows
            .iter()
            .filter(|row| row.renewal_status.as_deref() == Some("offered"))
            .count(),
    })
}

fn overview_row_contract(row: &OverviewLeaseRow) -> Value {
    json!({
        "id": row.id.as_str(),
        "tenantName": row.tenant_name.as_str(),
        "tenantEmail": row.tenant_email.as_deref(),
        "tenantPhoneE164": row.tenant_phone.as_deref(),
        "propertyId": row.property_id.as_deref(),
        "propertyName": row.property_name.as_deref(),
        "unitId": row.unit_id.as_deref(),
        "unitName": row.unit_name.as_deref(),
        "spaceId": row.space_id.as_deref(),
        "spaceName": row.space_name.as_deref(),
        "bedId": row.bed_id.as_deref(),
        "bedCode": row.bed_code.as_deref(),
        "leaseStatus": row.lease_status.as_str(),
        "leaseStatusLabel": lease_status_label(&row.lease_status),
        "renewalStatus": row.renewal_status.as_deref(),
        "startsOn": row.starts_on.as_str(),
        "endsOn": row.ends_on.as_deref(),
        "currency": row.currency.as_str(),
        "monthlyRecurringTotal": round2(row.monthly_recurring_total),
        "collectionState": collection_state(row),
        "overdueCount": row.overdue_count,
        "unpaidAmount": round2(row.unpaid_amount),
        "documentsCount": row.documents_count,
        "primaryHref": format!("/module/leases/{}", row.id),
    })
}

fn matches_view(row: &OverviewLeaseRow, view: Option<&str>) -> bool {
    match non_empty_opt(view) {
        Some(value) if value == "drafts" => row.lease_status == "draft",
        Some(value) if value == "expiring_60d" => is_expiring_within_days(row, 60),
        Some(value) if value == "delinquent" => collection_state(row) == "overdue",
        Some(value) if value == "renewal_offered" => {
            row.renewal_status.as_deref() == Some("offered")
        }
        _ => true,
    }
}

fn sort_rows(rows: &mut [OverviewLeaseRow], sort: Option<&str>) {
    match non_empty_opt(sort) {
        Some(value) if value == "tenant_asc" => rows.sort_by(|left, right| {
            left.tenant_name
                .to_ascii_lowercase()
                .cmp(&right.tenant_name.to_ascii_lowercase())
        }),
        Some(value) if value == "rent_desc" => rows.sort_by(|left, right| {
            right
                .monthly_recurring_total
                .partial_cmp(&left.monthly_recurring_total)
                .unwrap_or(std::cmp::Ordering::Equal)
        }),
        Some(value) if value == "updated_desc" => rows.sort_by(|left, right| {
            let left_ms = parse_millis(left.updated_at.as_deref());
            let right_ms = parse_millis(right.updated_at.as_deref());
            right_ms.cmp(&left_ms)
        }),
        _ => rows.sort_by(|left, right| {
            let left_end = left.ends_on.as_deref().unwrap_or("9999-12-31");
            let right_end = right.ends_on.as_deref().unwrap_or("9999-12-31");
            left_end.cmp(right_end).then_with(|| {
                left.tenant_name
                    .to_ascii_lowercase()
                    .cmp(&right.tenant_name.to_ascii_lowercase())
            })
        }),
    }
}

fn map_overview_row(row: sqlx::postgres::PgRow) -> OverviewLeaseRow {
    OverviewLeaseRow {
        id: row.try_get::<String, _>("id").unwrap_or_default(),
        application_id: row
            .try_get::<Option<String>, _>("application_id")
            .ok()
            .flatten(),
        tenant_name: row
            .try_get::<String, _>("tenant_full_name")
            .unwrap_or_else(|_| "Lease".to_string()),
        tenant_email: row
            .try_get::<Option<String>, _>("tenant_email")
            .ok()
            .flatten(),
        tenant_phone: row
            .try_get::<Option<String>, _>("tenant_phone_e164")
            .ok()
            .flatten(),
        property_id: row
            .try_get::<Option<String>, _>("property_id")
            .ok()
            .flatten(),
        property_name: row
            .try_get::<Option<String>, _>("property_name")
            .ok()
            .flatten(),
        unit_id: row.try_get::<Option<String>, _>("unit_id").ok().flatten(),
        unit_name: row.try_get::<Option<String>, _>("unit_name").ok().flatten(),
        space_id: row.try_get::<Option<String>, _>("space_id").ok().flatten(),
        space_name: row
            .try_get::<Option<String>, _>("space_name")
            .ok()
            .flatten(),
        bed_id: row.try_get::<Option<String>, _>("bed_id").ok().flatten(),
        bed_code: row.try_get::<Option<String>, _>("bed_code").ok().flatten(),
        lease_status: row
            .try_get::<String, _>("lease_status")
            .unwrap_or_else(|_| "draft".to_string()),
        renewal_status: row
            .try_get::<Option<String>, _>("renewal_status")
            .ok()
            .flatten(),
        starts_on: row
            .try_get::<chrono::NaiveDate, _>("starts_on")
            .map(|value| value.to_string())
            .unwrap_or_default(),
        ends_on: row
            .try_get::<Option<chrono::NaiveDate>, _>("ends_on")
            .ok()
            .flatten()
            .map(|value| value.to_string()),
        currency: row
            .try_get::<String, _>("currency")
            .unwrap_or_else(|_| "PYG".to_string()),
        monthly_rent: row.try_get::<f64, _>("monthly_rent").unwrap_or(0.0),
        service_fee_flat: row.try_get::<f64, _>("service_fee_flat").unwrap_or(0.0),
        security_deposit: row.try_get::<f64, _>("security_deposit").unwrap_or(0.0),
        guarantee_option_fee: row.try_get::<f64, _>("guarantee_option_fee").unwrap_or(0.0),
        tax_iva: row.try_get::<f64, _>("tax_iva").unwrap_or(0.0),
        platform_fee: row.try_get::<f64, _>("platform_fee").unwrap_or(0.0),
        total_move_in: row.try_get::<f64, _>("total_move_in").unwrap_or(0.0),
        monthly_recurring_total: row
            .try_get::<f64, _>("monthly_recurring_total")
            .unwrap_or(0.0),
        notes: row.try_get::<Option<String>, _>("notes").ok().flatten(),
        paid_count: row.try_get::<i32, _>("paid_count").unwrap_or(0),
        open_count: row.try_get::<i32, _>("open_count").unwrap_or(0),
        overdue_count: row.try_get::<i32, _>("overdue_count").unwrap_or(0),
        unpaid_amount: row.try_get::<f64, _>("unpaid_amount").unwrap_or(0.0),
        documents_count: row.try_get::<i32, _>("documents_count").unwrap_or(0),
        parent_lease_id: row
            .try_get::<Option<String>, _>("parent_lease_id")
            .ok()
            .flatten(),
        child_lease_id: row
            .try_get::<Option<String>, _>("child_lease_id")
            .ok()
            .flatten(),
        renewal_offered_rent: row
            .try_get::<Option<f64>, _>("renewal_offered_rent")
            .ok()
            .flatten(),
        updated_at: row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("updated_at")
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339()),
    }
}

fn collection_state(row: &OverviewLeaseRow) -> LeaseCollectionState {
    collection_state_from_stats(
        &LeaseCollectionStats {
            paid_count: row.paid_count,
            open_count: row.open_count,
            overdue_count: row.overdue_count,
            unpaid_amount: row.unpaid_amount,
        },
        &row.lease_status,
    )
}

fn collection_state_from_stats(
    stats: &LeaseCollectionStats,
    lease_status: &str,
) -> LeaseCollectionState {
    if lease_status == "delinquent" || stats.overdue_count > 0 {
        "overdue"
    } else if stats.open_count > 0 || stats.unpaid_amount > 0.0 {
        "watch"
    } else {
        "current"
    }
}

fn can_offer_renewal(row: &OverviewLeaseRow) -> bool {
    if matches!(row.renewal_status.as_deref(), Some("offered" | "accepted")) {
        return false;
    }
    matches!(
        row.lease_status.as_str(),
        "active" | "delinquent" | "completed"
    )
}

fn can_accept_renewal(row: &OverviewLeaseRow) -> bool {
    matches!(row.renewal_status.as_deref(), Some("offered" | "pending"))
}

fn is_expiring_within_days(row: &OverviewLeaseRow, days: i64) -> bool {
    if !matches!(row.lease_status.as_str(), "active" | "delinquent") {
        return false;
    }
    let Some(ends_on) = row.ends_on.as_deref() else {
        return false;
    };
    let Ok(end_date) = chrono::NaiveDate::parse_from_str(ends_on, "%Y-%m-%d") else {
        return false;
    };
    let today = Utc::now().date_naive();
    end_date >= today && end_date <= today + chrono::Duration::days(days)
}

fn lease_status_label(status: &str) -> String {
    match status {
        "draft" => "Draft".to_string(),
        "active" => "Active".to_string(),
        "delinquent" => "Delinquent".to_string(),
        "terminated" => "Terminated".to_string(),
        "completed" => "Completed".to_string(),
        other => other.replace('_', " "),
    }
}

fn parse_uuid(value: &str, field: &str) -> AppResult<Uuid> {
    Uuid::parse_str(value.trim()).map_err(|_| AppError::BadRequest(format!("Invalid {field}.")))
}

fn parse_optional_uuid(value: Option<&str>, field: &str) -> AppResult<Option<Uuid>> {
    match non_empty_opt(value) {
        Some(value) => parse_uuid(&value, field).map(Some),
        None => Ok(None),
    }
}

fn parse_millis(value: Option<&str>) -> i64 {
    value
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.timestamp_millis())
        .unwrap_or(0)
}

async fn rows_for_ids(
    pool: &sqlx::PgPool,
    table: &str,
    ids: &HashSet<String>,
) -> AppResult<Vec<Value>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    list_rows(
        pool,
        table,
        Some(&json_map(&[(
            "id",
            Value::Array(ids.iter().cloned().map(Value::String).collect()),
        )])),
        std::cmp::max(200, ids.len() as i64),
        0,
        "created_at",
        false,
    )
    .await
}

fn extract_ids(rows: &[Value], key: &str) -> HashSet<String> {
    rows.iter()
        .map(|row| value_str(row, key))
        .filter(|value| !value.is_empty())
        .collect()
}

fn map_by_id_field(rows: &[Value], field: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();
    for row in rows {
        let id = value_str(row, "id");
        let value = value_str(row, field);
        if !id.is_empty() && !value.is_empty() {
            values.insert(id, value);
        }
    }
    values
}

fn map_by_first_present_field(rows: &[Value], fields: &[&str]) -> HashMap<String, String> {
    let mut values = HashMap::new();
    for row in rows {
        let id = value_str(row, "id");
        if id.is_empty() {
            continue;
        }
        let value = fields
            .iter()
            .find_map(|field| {
                let value = value_str(row, field);
                if value.is_empty() {
                    None
                } else {
                    Some(value)
                }
            })
            .unwrap_or_default();
        if !value.is_empty() {
            values.insert(id, value);
        }
    }
    values
}

fn set_lookup_field(
    obj: &mut Map<String, Value>,
    id_field: &str,
    label_field: &str,
    lookup: &HashMap<String, String>,
) {
    let id = obj
        .get(id_field)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if id.is_empty() {
        return;
    }
    obj.insert(
        label_field.to_string(),
        lookup
            .get(id)
            .cloned()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
}

fn value_opt_str(row: &Value, key: &str) -> Option<String> {
    let value = value_str(row, key);
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn value_f64(row: &Value, key: &str) -> f64 {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(|value| {
            if let Some(number) = value.as_f64() {
                Some(number)
            } else {
                value
                    .as_str()
                    .and_then(|text| text.trim().parse::<f64>().ok())
            }
        })
        .unwrap_or(0.0)
}

#[allow(dead_code)]
async fn get_lease_row(pool: &sqlx::PgPool, lease_id: &str) -> AppResult<Value> {
    get_row(pool, "leases", lease_id, "id").await
}
