use chrono::{Datelike, NaiveDate};
use serde_json::{json, Map, Value};
use sqlx::PgPool;

use crate::{
    error::{AppError, AppResult},
    repository::table_service::{create_row, list_rows},
    services::json_helpers::round2,
};

const DEFAULT_COLLECTION_SCHEDULE_MONTHS: i32 = 12;
const MAX_COLLECTION_SCHEDULE_MONTHS: i32 = 120;

#[derive(Debug, Clone)]
pub struct LeaseScheduleResult {
    pub due_dates: Vec<String>,
    pub charges: Vec<Value>,
    pub collections: Vec<Value>,
    pub first_collection: Option<Value>,
}

#[allow(clippy::too_many_arguments)]
pub async fn ensure_monthly_lease_schedule(
    pool: &PgPool,
    organization_id: &str,
    lease_id: &str,
    starts_on: &str,
    first_collection_due_date: Option<&str>,
    ends_on: Option<&str>,
    collection_schedule_months: Option<i32>,
    amount: f64,
    currency: &str,
    created_by_user_id: Option<&str>,
) -> AppResult<LeaseScheduleResult> {
    let due_dates = build_monthly_schedule_dates(
        starts_on,
        first_collection_due_date,
        ends_on,
        collection_schedule_months,
    )?;
    let due_keys = due_dates
        .iter()
        .map(NaiveDate::to_string)
        .collect::<std::collections::HashSet<_>>();

    let existing_charges = list_rows(
        pool,
        "lease_charges",
        Some(&filter_lease_id(lease_id)),
        std::cmp::max(300, (due_dates.len() as i64) * 4),
        0,
        "charge_date",
        true,
    )
    .await?;
    let mut existing_charge_by_due: std::collections::HashMap<String, Value> =
        std::collections::HashMap::new();
    for charge in existing_charges {
        let Some(obj) = charge.as_object() else {
            continue;
        };
        if value_str(obj.get("charge_type")) != Some("monthly_rent") {
            continue;
        }
        let Some(charge_date) = value_str(obj.get("charge_date")).map(ToOwned::to_owned) else {
            continue;
        };
        if due_keys.contains(&charge_date) && !existing_charge_by_due.contains_key(&charge_date) {
            existing_charge_by_due.insert(charge_date, charge);
        }
    }

    let existing_collections = list_rows(
        pool,
        "collection_records",
        Some(&filter_lease_id(lease_id)),
        std::cmp::max(300, (due_dates.len() as i64) * 4),
        0,
        "due_date",
        true,
    )
    .await?;
    let mut existing_collection_by_due: std::collections::HashMap<String, Value> =
        std::collections::HashMap::new();
    for collection in existing_collections {
        let Some(obj) = collection.as_object() else {
            continue;
        };
        let Some(due_date) = value_str(obj.get("due_date")).map(ToOwned::to_owned) else {
            continue;
        };
        if due_keys.contains(&due_date) && !existing_collection_by_due.contains_key(&due_date) {
            existing_collection_by_due.insert(due_date, collection);
        }
    }

    let mut created_charges = Vec::new();
    let mut created_collections = Vec::new();
    let mut first_collection: Option<Value> = None;

    for (index, due_date) in due_dates.iter().enumerate() {
        let due_iso = due_date.to_string();

        let charge = if let Some(existing) = existing_charge_by_due.get(&due_iso).cloned() {
            existing
        } else {
            let mut payload = Map::new();
            payload.insert(
                "organization_id".to_string(),
                Value::String(organization_id.to_string()),
            );
            payload.insert("lease_id".to_string(), Value::String(lease_id.to_string()));
            payload.insert("charge_date".to_string(), Value::String(due_iso.clone()));
            payload.insert(
                "charge_type".to_string(),
                Value::String("monthly_rent".to_string()),
            );
            payload.insert(
                "description".to_string(),
                Value::String(format!("Recurring monthly lease charge ({due_iso})")),
            );
            payload.insert("amount".to_string(), json!(round2(amount)));
            payload.insert("currency".to_string(), Value::String(currency.to_string()));
            payload.insert("status".to_string(), Value::String("scheduled".to_string()));

            let created = create_row(pool, "lease_charges", &payload).await?;
            existing_charge_by_due.insert(due_iso.clone(), created.clone());
            created_charges.push(created.clone());
            created
        };

        let collection = if let Some(existing) = existing_collection_by_due.get(&due_iso).cloned() {
            existing
        } else {
            let mut payload = Map::new();
            payload.insert(
                "organization_id".to_string(),
                Value::String(organization_id.to_string()),
            );
            payload.insert("lease_id".to_string(), Value::String(lease_id.to_string()));
            if let Some(charge_id) = charge
                .as_object()
                .and_then(|obj| obj.get("id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                payload.insert(
                    "lease_charge_id".to_string(),
                    Value::String(charge_id.to_string()),
                );
            }
            payload.insert("due_date".to_string(), Value::String(due_iso.clone()));
            payload.insert("amount".to_string(), json!(round2(amount)));
            payload.insert("currency".to_string(), Value::String(currency.to_string()));
            payload.insert("status".to_string(), Value::String("scheduled".to_string()));
            if let Some(user_id) = created_by_user_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                payload.insert(
                    "created_by_user_id".to_string(),
                    Value::String(user_id.to_string()),
                );
            }

            let created = create_row(pool, "collection_records", &payload).await?;
            existing_collection_by_due.insert(due_iso.clone(), created.clone());
            created_collections.push(created.clone());
            created
        };

        if index == 0 {
            first_collection = Some(collection);
        }
    }

    Ok(LeaseScheduleResult {
        due_dates: due_dates.iter().map(NaiveDate::to_string).collect(),
        charges: created_charges,
        collections: created_collections,
        first_collection,
    })
}

fn build_monthly_schedule_dates(
    starts_on: &str,
    first_collection_due_date: Option<&str>,
    ends_on: Option<&str>,
    collection_schedule_months: Option<i32>,
) -> AppResult<Vec<NaiveDate>> {
    let starts_on_date = parse_iso_date(starts_on, "starts_on")?;
    let due_anchor = parse_iso_date(
        first_collection_due_date.unwrap_or(starts_on),
        "first_collection_due_date",
    )?;

    if let Some(end_value) = ends_on.map(str::trim).filter(|value| !value.is_empty()) {
        let end_date = parse_iso_date(end_value, "ends_on")?;
        let mut schedule = Vec::new();
        for offset in 0..MAX_COLLECTION_SCHEDULE_MONTHS {
            let due_date = add_months_clamped(due_anchor, offset)?;
            if due_date > end_date {
                break;
            }
            schedule.push(due_date);
        }
        if !schedule.is_empty() {
            return Ok(schedule);
        }
        if due_anchor >= starts_on_date {
            return Ok(vec![due_anchor]);
        }
        return Ok(vec![starts_on_date]);
    }

    let mut months = collection_schedule_months.unwrap_or(DEFAULT_COLLECTION_SCHEDULE_MONTHS);
    if months < 1 {
        return Err(AppError::BadRequest(
            "collection_schedule_months must be >= 1.".to_string(),
        ));
    }
    months = months.clamp(1, MAX_COLLECTION_SCHEDULE_MONTHS);

    let mut schedule = Vec::new();
    for offset in 0..months {
        schedule.push(add_months_clamped(due_anchor, offset)?);
    }
    Ok(schedule)
}

fn parse_iso_date(value: &str, field_name: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").map_err(|_| {
        AppError::BadRequest(format!("{field_name} must be an ISO date (YYYY-MM-DD)."))
    })
}

fn add_months_clamped(anchor: NaiveDate, offset: i32) -> AppResult<NaiveDate> {
    let month_index = (anchor.month() as i32 - 1) + offset;
    let year = anchor.year() + (month_index / 12);
    let month = (month_index.rem_euclid(12) + 1) as u32;
    let day = anchor.day().min(last_day_of_month(year, month)?);
    NaiveDate::from_ymd_opt(year, month, day).ok_or_else(|| {
        AppError::Internal("Could not compute monthly collection schedule date.".to_string())
    })
}

fn last_day_of_month(year: i32, month: u32) -> AppResult<u32> {
    let first_day = NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(|| {
        AppError::Internal("Could not compute monthly collection schedule date.".to_string())
    })?;
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let next_first_day = NaiveDate::from_ymd_opt(next_year, next_month, 1).ok_or_else(|| {
        AppError::Internal("Could not compute monthly collection schedule date.".to_string())
    })?;
    Ok((next_first_day - first_day).num_days() as u32)
}

fn filter_lease_id(lease_id: &str) -> Map<String, Value> {
    let mut filters = Map::new();
    filters.insert("lease_id".to_string(), Value::String(lease_id.to_string()));
    filters
}

fn value_str(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}
