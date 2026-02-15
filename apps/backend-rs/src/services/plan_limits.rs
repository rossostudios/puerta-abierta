use serde_json::{Map, Value};
use sqlx::PgPool;

use crate::error::AppError;
use crate::repository::table_service::{get_row, list_rows};

/// Check if the organization can create more of a given resource type.
/// Returns Ok(()) if within limits, or Err with a descriptive message.
pub async fn check_plan_limit(
    pool: &PgPool,
    org_id: &str,
    resource: PlanResource,
) -> Result<(), AppError> {
    // Find active subscription
    let mut org_filter = Map::new();
    org_filter.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );

    let subs = list_rows(pool, "org_subscriptions", Some(&org_filter), 1, 0, "created_at", false)
        .await
        .unwrap_or_default();

    let sub = match subs.into_iter().next() {
        Some(s) => s,
        None => return Ok(()), // No subscription = no limits (trial/free)
    };

    let status = val_str(&sub, "status");
    if status == "cancelled" {
        return Err(AppError::Forbidden(
            "Your subscription has been cancelled. Please reactivate to continue.".to_string(),
        ));
    }

    let plan_id = val_str(&sub, "plan_id");
    if plan_id.is_empty() {
        return Ok(());
    }

    let plan = match get_row(pool, "subscription_plans", &plan_id, "id").await {
        Ok(p) => p,
        Err(_) => return Ok(()), // Plan not found = don't block
    };

    let (limit_field, table, label_en, label_es) = match resource {
        PlanResource::Property => ("max_properties", "properties", "properties", "propiedades"),
        PlanResource::Unit => ("max_units", "units", "units", "unidades"),
        PlanResource::User => ("max_users", "organization_members", "team members", "miembros del equipo"),
    };

    let max = plan
        .as_object()
        .and_then(|o| o.get(limit_field))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    // 0 or null means unlimited
    if max <= 0 {
        return Ok(());
    }

    let current = list_rows(pool, table, Some(&org_filter), max as i64 + 1, 0, "id", true)
        .await
        .unwrap_or_default();

    if current.len() as i64 >= max {
        let plan_name = val_str(&plan, "name");
        return Err(AppError::Forbidden(format!(
            "Plan limit reached: your {plan_name} plan allows up to {max} {label_en} ({label_es}). Upgrade your plan to add more."
        )));
    }

    Ok(())
}

pub enum PlanResource {
    Property,
    Unit,
    User,
}

fn val_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}
