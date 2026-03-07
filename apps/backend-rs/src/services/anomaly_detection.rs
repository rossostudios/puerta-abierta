use chrono::{Datelike, NaiveDate, Utc};
use serde_json::Value;
use sqlx::Row;

use crate::{
    error::{AppError, AppResult},
    repository::table_service::list_rows,
    services::json_helpers::value_str,
    state::AppState,
};

struct AlertDraft<'a> {
    alert_type: &'a str,
    severity: &'a str,
    title: &'a str,
    description: &'a str,
    related_table: Option<&'a str>,
    related_id: Option<&'a str>,
}

/// Run all anomaly detection checks for an organization and insert new alerts.
pub async fn run_anomaly_scan(state: &AppState, org_id: &str) -> AppResult<Vec<Value>> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| AppError::Dependency("Database not configured.".to_string()))?;

    let org_filter = {
        let mut map = serde_json::Map::new();
        map.insert(
            "organization_id".to_string(),
            Value::String(org_id.to_string()),
        );
        map
    };

    let mut new_alerts: Vec<Value> = Vec::new();
    let today = Utc::now().date_naive();

    // ── Check 1: Revenue drop ──
    // Current month revenue < 70% of 3-month average
    if let Ok(reservations) = list_rows(
        pool,
        "reservations",
        Some(&org_filter),
        6000,
        0,
        "created_at",
        false,
    )
    .await
    {
        let mut monthly_revenue: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();

        for reservation in &reservations {
            let status = value_str(reservation, "status");
            if !["confirmed", "checked_in", "checked_out"].contains(&status.as_str()) {
                continue;
            }
            let check_in = value_str(reservation, "check_in_date");
            if let Ok(date) = NaiveDate::parse_from_str(&check_in, "%Y-%m-%d") {
                let month_key = format!("{:04}-{:02}", date.year(), date.month());
                let amount = number_from_value(reservation.get("total_amount"));
                *monthly_revenue.entry(month_key).or_insert(0.0) += amount;
            }
        }

        let current_month = format!("{:04}-{:02}", today.year(), today.month());
        let current_revenue = monthly_revenue.get(&current_month).copied().unwrap_or(0.0);

        // Get past 3 months average (excluding current)
        let mut past_months: Vec<f64> = Vec::new();
        for i in 1..=3 {
            let past = today - chrono::Duration::days(i * 30);
            let key = format!("{:04}-{:02}", past.year(), past.month());
            if let Some(rev) = monthly_revenue.get(&key) {
                past_months.push(*rev);
            }
        }

        if past_months.len() >= 2 {
            let avg = past_months.iter().sum::<f64>() / past_months.len() as f64;
            if avg > 0.0 && current_revenue < avg * 0.7 {
                if let Some(alert) = insert_alert_if_new(
                    pool,
                    org_id,
                    AlertDraft {
                        alert_type: "revenue_drop",
                        severity: "warning",
                        title: "Revenue drop detected",
                        description: &format!(
                            "Current month revenue ({:.0}) is below 70% of the 3-month average ({:.0}).",
                            current_revenue, avg
                        ),
                        related_table: None,
                        related_id: None,
                    },
                )
                .await
                {
                    new_alerts.push(alert);
                }
            }
        }
    }

    // ── Check 2: Expense spike (learned baselines — 2 std dev from 6-month mean) ──
    if let Ok(expenses) = list_rows(
        pool,
        "expenses",
        Some(&org_filter),
        6000,
        0,
        "created_at",
        false,
    )
    .await
    {
        let six_months_ago = today - chrono::Duration::days(180);
        let mut category_amounts: std::collections::HashMap<String, Vec<f64>> =
            std::collections::HashMap::new();
        let mut category_recent: std::collections::HashMap<String, Vec<f64>> =
            std::collections::HashMap::new();

        for expense in &expenses {
            let category = value_str(expense, "category");
            let cat = if category.is_empty() {
                "other".to_string()
            } else {
                category
            };
            let amount = number_from_value(expense.get("amount"));
            let created = expense
                .get("created_at")
                .and_then(Value::as_str)
                .and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(s.trim().replace('Z', "+00:00").as_str())
                        .ok()
                });

            let is_recent = created
                .as_ref()
                .is_some_and(|c| c.date_naive() >= six_months_ago);

            if is_recent {
                category_amounts
                    .entry(cat.clone())
                    .or_default()
                    .push(amount);
            }

            // Track last 30 days separately for spike detection
            let is_last_30d = created
                .as_ref()
                .is_some_and(|c| (today - c.date_naive()).num_days() <= 30);
            if is_last_30d {
                category_recent.entry(cat).or_default().push(amount);
            }
        }

        for (category, amounts) in &category_amounts {
            if amounts.len() < 5 {
                continue;
            }
            let mean = amounts.iter().sum::<f64>() / amounts.len() as f64;
            let variance =
                amounts.iter().map(|a| (a - mean).powi(2)).sum::<f64>() / amounts.len() as f64;
            let std_dev = variance.sqrt();
            let threshold = mean + 2.0 * std_dev;

            // Check if any recent expense exceeds 2 std dev above mean
            if let Some(recent) = category_recent.get(category) {
                for &latest in recent {
                    if threshold > 0.0 && latest > threshold {
                        if let Some(alert) = insert_alert_if_new(
                            pool,
                            org_id,
                            AlertDraft {
                                alert_type: "expense_spike",
                                severity: if latest > mean + 3.0 * std_dev { "critical" } else { "warning" },
                                title: &format!("Expense anomaly in '{}'", category),
                                description: &format!(
                                    "Expense ({:.0}) exceeds learned baseline (mean {:.0} + 2σ {:.0} = threshold {:.0}) for category '{}'.",
                                    latest, mean, std_dev, threshold, category
                                ),
                                related_table: Some("expenses"),
                                related_id: None,
                            },
                        )
                        .await
                        {
                            new_alerts.push(alert);
                        }
                        break; // One alert per category
                    }
                }
            }
        }
    }

    // ── Check 3: Overdue tasks ──
    if let Ok(tasks) = list_rows(
        pool,
        "tasks",
        Some(&org_filter),
        10000,
        0,
        "created_at",
        false,
    )
    .await
    {
        let overdue_count = tasks
            .iter()
            .filter(|task| {
                let status = value_str(task, "status").to_ascii_lowercase();
                if status != "todo" && status != "in_progress" {
                    return false;
                }
                task.get("due_at")
                    .and_then(Value::as_str)
                    .and_then(|s| {
                        chrono::DateTime::parse_from_rfc3339(
                            s.trim().replace('Z', "+00:00").as_str(),
                        )
                        .ok()
                    })
                    .is_some_and(|due| {
                        let days_overdue = (today - due.date_naive()).num_days();
                        days_overdue > 7
                    })
            })
            .count();

        if overdue_count > 5 {
            if let Some(alert) = insert_alert_if_new(
                pool,
                org_id,
                AlertDraft {
                    alert_type: "overdue_tasks",
                    severity: "warning",
                    title: "Many overdue tasks",
                    description: &format!(
                        "{} tasks are overdue by more than 7 days.",
                        overdue_count
                    ),
                    related_table: Some("tasks"),
                    related_id: None,
                },
            )
            .await
            {
                new_alerts.push(alert);
            }
        }
    }

    // ── Check 4: Deposit held too long ──
    if let Ok(deposits) = list_rows(
        pool,
        "escrow_events",
        Some(&org_filter),
        3000,
        0,
        "created_at",
        false,
    )
    .await
    {
        let held_too_long = deposits
            .iter()
            .filter(|deposit| {
                let status = value_str(deposit, "status");
                if status != "held" {
                    return false;
                }
                deposit
                    .get("created_at")
                    .and_then(Value::as_str)
                    .and_then(|s| {
                        chrono::DateTime::parse_from_rfc3339(
                            s.trim().replace('Z', "+00:00").as_str(),
                        )
                        .ok()
                    })
                    .is_some_and(|created| (today - created.date_naive()).num_days() > 45)
            })
            .count();

        if held_too_long > 0 {
            if let Some(alert) = insert_alert_if_new(
                pool,
                org_id,
                AlertDraft {
                    alert_type: "deposit_held_long",
                    severity: "warning",
                    title: "Deposits held too long",
                    description: &format!(
                        "{} deposits have been in 'held' status for more than 45 days.",
                        held_too_long
                    ),
                    related_table: Some("escrow_events"),
                    related_id: None,
                },
            )
            .await
            {
                new_alerts.push(alert);
            }
        }
    }

    // Store anomaly scan as ML prediction for tracking
    if !new_alerts.is_empty() {
        sqlx::query(
            "INSERT INTO ml_predictions (organization_id, prediction_type, entity_type, entity_id, predicted_value, predicted_label, confidence, features, model_version)
             VALUES ($1::uuid, 'anomaly', 'organization', $1::uuid, $2, $3, 0.6, $4, 'baseline_v1')",
        )
        .bind(org_id)
        .bind(new_alerts.len() as f64)
        .bind(if new_alerts.len() > 3 { "high_anomaly" } else { "low_anomaly" })
        .bind(serde_json::json!({ "alerts_generated": new_alerts.len(), "scan_date": today.to_string() }))
        .execute(pool)
        .await
        .ok();
    }

    Ok(new_alerts)
}

async fn insert_alert_if_new(
    pool: &sqlx::PgPool,
    org_id: &str,
    alert: AlertDraft<'_>,
) -> Option<Value> {
    let AlertDraft {
        alert_type,
        severity,
        title,
        description,
        related_table,
        related_id,
    } = alert;

    // Dedup: check if a similar alert was created in the last 7 days
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM anomaly_alerts
         WHERE organization_id = $1::uuid
           AND alert_type = $2
           AND detected_at > (now() - interval '7 days')
           AND is_dismissed = false",
    )
    .bind(org_id)
    .bind(alert_type)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if existing > 0 {
        return None;
    }

    let row = sqlx::query(
        "INSERT INTO anomaly_alerts (organization_id, alert_type, severity, title, description, related_table, related_id)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
         RETURNING row_to_json(anomaly_alerts.*) AS row"
    )
    .bind(org_id)
    .bind(alert_type)
    .bind(severity)
    .bind(title)
    .bind(description)
    .bind(related_table)
    .bind(related_id)
    .fetch_optional(pool)
    .await
    .ok()?;

    row.and_then(|item| item.try_get::<Option<Value>, _>("row").ok().flatten())
}

fn number_from_value(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => text.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}
