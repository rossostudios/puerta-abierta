use serde_json::{json, Map, Value};

use crate::repository::table_service::{create_row, list_rows};

/// Fire a workflow trigger event for an organization.
/// Looks up active workflow_rules matching the trigger_event and executes actions.
pub async fn fire_trigger(
    pool: &sqlx::PgPool,
    org_id: &str,
    trigger_event: &str,
    context: &Map<String, Value>,
) {
    let mut filters = Map::new();
    filters.insert(
        "organization_id".to_string(),
        Value::String(org_id.to_string()),
    );
    filters.insert("is_active".to_string(), Value::Bool(true));
    filters.insert(
        "trigger_event".to_string(),
        Value::String(trigger_event.to_string()),
    );

    let rules = match list_rows(pool, "workflow_rules", Some(&filters), 100, 0, "created_at", true).await {
        Ok(rules) => rules,
        Err(_) => return,
    };

    for rule in rules {
        let action_type = val_str(&rule, "action_type");
        let action_config = rule
            .as_object()
            .and_then(|o| o.get("action_config"))
            .cloned()
            .unwrap_or(json!({}));

        match action_type.as_str() {
            "create_task" => {
                execute_create_task(pool, org_id, &action_config, context).await;
            }
            "send_notification" => {
                execute_send_notification(pool, org_id, &action_config, context).await;
            }
            "update_status" => {
                // Status updates are handled inline by the triggering route
            }
            "create_expense" => {
                execute_create_expense(pool, org_id, &action_config, context).await;
            }
            _ => {}
        }
    }
}

async fn execute_create_task(
    pool: &sqlx::PgPool,
    org_id: &str,
    config: &Value,
    context: &Map<String, Value>,
) {
    let title = config
        .as_object()
        .and_then(|o| o.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("Auto-generated task");

    let task_type = config
        .as_object()
        .and_then(|o| o.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("custom");

    let priority = config
        .as_object()
        .and_then(|o| o.get("priority"))
        .and_then(Value::as_str)
        .unwrap_or("medium");

    let assigned_role = config
        .as_object()
        .and_then(|o| o.get("assigned_role"))
        .and_then(Value::as_str);

    let mut task = Map::new();
    task.insert("organization_id".to_string(), Value::String(org_id.to_string()));
    task.insert("title".to_string(), Value::String(resolve_template(title, context)));
    task.insert("type".to_string(), Value::String(task_type.to_string()));
    task.insert("status".to_string(), Value::String("todo".to_string()));
    task.insert("priority".to_string(), Value::String(priority.to_string()));

    // Pass through context references
    if let Some(property_id) = context.get("property_id") {
        task.insert("property_id".to_string(), property_id.clone());
    }
    if let Some(unit_id) = context.get("unit_id") {
        task.insert("unit_id".to_string(), unit_id.clone());
    }
    if let Some(reservation_id) = context.get("reservation_id") {
        task.insert("reservation_id".to_string(), reservation_id.clone());
    }

    // Resolve assigned_user_id from role if configured
    if let Some(role) = assigned_role {
        if let Ok(members) = find_org_members_by_role(pool, org_id, role).await {
            if let Some(member) = members.first() {
                let user_id = val_str(member, "user_id");
                if !user_id.is_empty() {
                    task.insert("assigned_user_id".to_string(), Value::String(user_id));
                }
            }
        }
    }

    let _ = create_row(pool, "tasks", &task).await;
}

async fn execute_send_notification(
    pool: &sqlx::PgPool,
    org_id: &str,
    config: &Value,
    context: &Map<String, Value>,
) {
    let channel = config
        .as_object()
        .and_then(|o| o.get("channel"))
        .and_then(Value::as_str)
        .unwrap_or("whatsapp");

    let recipient = context
        .get("recipient")
        .and_then(Value::as_str)
        .or_else(|| {
            context
                .get("tenant_phone_e164")
                .and_then(Value::as_str)
        })
        .unwrap_or_default();

    if recipient.is_empty() {
        return;
    }

    let template_id = config
        .as_object()
        .and_then(|o| o.get("template_id"))
        .and_then(Value::as_str);

    let mut msg = Map::new();
    msg.insert("organization_id".to_string(), Value::String(org_id.to_string()));
    msg.insert("channel".to_string(), Value::String(channel.to_string()));
    msg.insert("recipient".to_string(), Value::String(recipient.to_string()));
    msg.insert("status".to_string(), Value::String("queued".to_string()));
    if let Some(tid) = template_id {
        msg.insert("template_id".to_string(), Value::String(tid.to_string()));
    }
    msg.insert("variables".to_string(), Value::Object(context.clone()));

    let _ = create_row(pool, "message_logs", &msg).await;
}

async fn execute_create_expense(
    pool: &sqlx::PgPool,
    org_id: &str,
    config: &Value,
    context: &Map<String, Value>,
) {
    let category = config
        .as_object()
        .and_then(|o| o.get("category"))
        .and_then(Value::as_str)
        .unwrap_or("other");

    let amount = config
        .as_object()
        .and_then(|o| o.get("amount"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    if amount <= 0.0 {
        return;
    }

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let mut expense = Map::new();
    expense.insert("organization_id".to_string(), Value::String(org_id.to_string()));
    expense.insert("category".to_string(), Value::String(category.to_string()));
    expense.insert("expense_date".to_string(), Value::String(today));
    expense.insert("amount".to_string(), json!(amount));
    expense.insert("currency".to_string(), Value::String("PYG".to_string()));
    expense.insert("payment_method".to_string(), Value::String("bank_transfer".to_string()));
    expense.insert("receipt_url".to_string(), Value::String(String::new()));

    if let Some(property_id) = context.get("property_id") {
        expense.insert("property_id".to_string(), property_id.clone());
    }
    if let Some(unit_id) = context.get("unit_id") {
        expense.insert("unit_id".to_string(), unit_id.clone());
    }

    let _ = create_row(pool, "expenses", &expense).await;
}

async fn find_org_members_by_role(
    pool: &sqlx::PgPool,
    org_id: &str,
    role: &str,
) -> Result<Vec<Value>, crate::error::AppError> {
    let mut filters = Map::new();
    filters.insert("organization_id".to_string(), Value::String(org_id.to_string()));
    filters.insert("role".to_string(), Value::String(role.to_string()));

    list_rows(pool, "organization_members", Some(&filters), 10, 0, "created_at", true).await
}

/// Simple template variable replacement: replaces {{key}} with context values.
fn resolve_template(template: &str, context: &Map<String, Value>) -> String {
    let mut result = template.to_string();
    for (key, value) in context {
        let placeholder = format!("{{{{{}}}}}", key);
        let replacement = match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            _ => continue,
        };
        result = result.replace(&placeholder, &replacement);
    }
    result
}

fn val_str(row: &Value, key: &str) -> String {
    row.as_object()
        .and_then(|obj| obj.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}
