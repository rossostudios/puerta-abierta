use serde_json::{json, Map, Value};

use crate::services::ai_agent::tool_definitions;

#[derive(Debug, Clone)]
pub struct ToolValidationError {
    pub code: &'static str,
    pub message: String,
    pub hint: Option<String>,
}

impl ToolValidationError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            code: "tool_args_invalid",
            message: message.into(),
            hint: None,
        }
    }
}

pub fn validate_tool_args(
    tool_name: &str,
    args: &Map<String, Value>,
) -> Result<(), ToolValidationError> {
    let schema = tool_definitions(None)
        .into_iter()
        .find_map(|definition| {
            let object = definition.as_object()?;
            let function = object.get("function")?.as_object()?;
            let name = function.get("name")?.as_str()?;
            if name.trim() != tool_name.trim() {
                return None;
            }
            function.get("parameters").cloned()
        })
        .ok_or_else(|| ToolValidationError {
            code: "tool_unknown",
            message: format!("Unknown tool '{tool_name}'."),
            hint: None,
        })?;

    validate_schema(&schema, &Value::Object(args.clone()), "$")
}

fn validate_schema(schema: &Value, value: &Value, path: &str) -> Result<(), ToolValidationError> {
    let Some(schema_obj) = schema.as_object() else {
        return Ok(());
    };

    if let Some(schema_type) = schema_obj.get("type").and_then(Value::as_str) {
        match schema_type {
            "object" => {
                let Some(value_obj) = value.as_object() else {
                    return Err(ToolValidationError::new(format!(
                        "{path} must be an object."
                    )));
                };

                if let Some(required) = schema_obj.get("required").and_then(Value::as_array) {
                    for key in required {
                        let required_key = key.as_str().map(str::trim).unwrap_or_default();
                        if required_key.is_empty() {
                            continue;
                        }
                        if !value_obj.contains_key(required_key) {
                            return Err(ToolValidationError::new(format!(
                                "{path}.{required_key} is required."
                            )));
                        }
                    }
                }

                if let Some(properties) = schema_obj.get("properties").and_then(Value::as_object) {
                    for (key, val) in value_obj {
                        if let Some(field_schema) = properties.get(key) {
                            validate_schema(field_schema, val, &format!("{path}.{key}"))?;
                        }
                    }
                }
            }
            "array" => {
                let Some(values) = value.as_array() else {
                    return Err(ToolValidationError::new(format!(
                        "{path} must be an array."
                    )));
                };
                if let Some(item_schema) = schema_obj.get("items") {
                    for (index, item) in values.iter().enumerate() {
                        validate_schema(item_schema, item, &format!("{path}[{index}]"))?;
                    }
                }
            }
            "string" => {
                if !value.is_string() {
                    return Err(ToolValidationError::new(format!(
                        "{path} must be a string."
                    )));
                }
            }
            "integer" => {
                if !(value.is_i64() || value.is_u64()) {
                    return Err(ToolValidationError::new(format!(
                        "{path} must be an integer."
                    )));
                }
            }
            "number" => {
                if !value.is_number() {
                    return Err(ToolValidationError::new(format!(
                        "{path} must be a number."
                    )));
                }
            }
            "boolean" => {
                if !value.is_boolean() {
                    return Err(ToolValidationError::new(format!(
                        "{path} must be a boolean."
                    )));
                }
            }
            _ => {}
        }
    }

    if let Some(enums) = schema_obj.get("enum").and_then(Value::as_array) {
        if !enums.iter().any(|allowed| allowed == value) {
            return Err(ToolValidationError::new(format!(
                "{path} contains a value that is not allowed."
            )));
        }
    }

    Ok(())
}

pub fn normalized_tool_error(
    code: &str,
    message: impl Into<String>,
    retryable: bool,
    hint: Option<String>,
) -> Value {
    json!({
        "ok": false,
        "error": {
            "code": code,
            "message": message.into(),
            "retryable": retryable,
            "hint": hint,
        }
    })
}

pub fn normalize_tool_result(raw: Value) -> Value {
    let Some(obj) = raw.as_object() else {
        return normalized_tool_error(
            "tool_invalid_result",
            "Tool returned an invalid payload shape.",
            false,
            None,
        );
    };

    let ok = obj.get("ok").and_then(Value::as_bool).unwrap_or(false);
    if ok {
        if let Some(data) = obj.get("data") {
            return json!({
                "ok": true,
                "data": data,
            });
        }

        let mut data = obj.clone();
        data.remove("ok");
        return json!({
            "ok": true,
            "data": Value::Object(data),
        });
    }

    let message = match obj.get("error") {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Object(error_obj)) => error_obj
            .get("message")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Tool execution failed.")
            .to_string(),
        _ => "Tool execution failed.".to_string(),
    };

    let hint = obj
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error_obj| error_obj.get("hint"))
        .and_then(Value::as_str)
        .map(str::to_string);

    normalized_tool_error("tool_execution_failed", message, false, hint)
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Map};

    use super::{normalize_tool_result, validate_tool_args};

    #[test]
    fn validate_tool_args_rejects_missing_required_field() {
        let mut args = Map::new();
        args.insert("table".to_string(), json!("properties"));
        let result = validate_tool_args("create_row", &args);
        assert!(result.is_err());
    }

    #[test]
    fn normalize_tool_result_wraps_success_data() {
        let normalized = normalize_tool_result(json!({
            "ok": true,
            "row": { "id": "abc" }
        }));
        assert_eq!(
            normalized.get("ok").and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert!(normalized.get("data").is_some());
    }

    #[test]
    fn normalize_tool_result_wraps_error_message() {
        let normalized = normalize_tool_result(json!({
            "ok": false,
            "error": "boom",
        }));
        assert_eq!(
            normalized
                .get("error")
                .and_then(serde_json::Value::as_object)
                .and_then(|obj| obj.get("message"))
                .and_then(serde_json::Value::as_str),
            Some("boom")
        );
    }
}
