use chrono::{SecondsFormat, Utc};
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::services::ai_agent::AgentStreamEvent;

pub const RUNTIME_VERSION: &str = "v2";

#[derive(Debug, Clone)]
pub struct RuntimeExecutionIds {
    pub run_id: String,
    pub trace_id: String,
}

impl RuntimeExecutionIds {
    pub fn generate() -> Self {
        Self {
            run_id: Uuid::new_v4().to_string(),
            trace_id: Uuid::new_v4().to_string(),
        }
    }
}

fn timestamp_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn runtime_metadata(ids: &RuntimeExecutionIds) -> Value {
    json!({
        "runtime_version": RUNTIME_VERSION,
        "run_id": ids.run_id,
        "trace_id": ids.trace_id,
    })
}

pub fn inject_runtime_metadata(payload: &mut Map<String, Value>, ids: &RuntimeExecutionIds) {
    payload.insert(
        "runtime_version".to_string(),
        Value::String(RUNTIME_VERSION.to_string()),
    );
    payload.insert("run_id".to_string(), Value::String(ids.run_id.clone()));
    payload.insert("trace_id".to_string(), Value::String(ids.trace_id.clone()));
}

pub fn wrap_stream_event(event: AgentStreamEvent, ids: &RuntimeExecutionIds) -> Value {
    let (event_type, payload) = match event {
        AgentStreamEvent::Status { message } => (
            "status",
            json!({
                "message": message,
            }),
        ),
        AgentStreamEvent::ToolCall { name, args } => (
            "tool_call",
            json!({
                "name": name,
                "args": args,
            }),
        ),
        AgentStreamEvent::ToolResult {
            name,
            preview,
            ok,
            error_explanation,
            suggested_actions,
        } => (
            "tool_result",
            json!({
                "name": name,
                "preview": preview,
                "ok": ok,
                "error_explanation": error_explanation,
                "suggested_actions": suggested_actions,
            }),
        ),
        AgentStreamEvent::Token { text } => (
            "token",
            json!({
                "text": text,
            }),
        ),
        AgentStreamEvent::Done {
            content,
            tool_trace,
            model_used,
            fallback_used,
            structured_content,
            explanation,
        } => (
            "done",
            json!({
                "content": content,
                "tool_trace": tool_trace,
                "model_used": model_used,
                "fallback_used": fallback_used,
                "structured_content": structured_content,
                "explanation": explanation,
            }),
        ),
        AgentStreamEvent::Error { message } => (
            "error",
            json!({
                "message": message,
            }),
        ),
    };

    json!({
        "type": event_type,
        "runtime_version": RUNTIME_VERSION,
        "run_id": ids.run_id,
        "trace_id": ids.trace_id,
        "timestamp": timestamp_rfc3339(),
        "payload": payload,
    })
}

#[cfg(test)]
mod tests {
    use super::{wrap_stream_event, RuntimeExecutionIds, RUNTIME_VERSION};
    use crate::services::ai_agent::AgentStreamEvent;

    #[test]
    fn wrap_stream_event_uses_v2_envelope() {
        let ids = RuntimeExecutionIds {
            run_id: "run-test".to_string(),
            trace_id: "trace-test".to_string(),
        };

        let wrapped = wrap_stream_event(
            AgentStreamEvent::Status {
                message: "Thinking".to_string(),
            },
            &ids,
        );

        assert_eq!(
            wrapped
                .get("runtime_version")
                .and_then(serde_json::Value::as_str),
            Some(RUNTIME_VERSION)
        );
        assert_eq!(
            wrapped.get("run_id").and_then(serde_json::Value::as_str),
            Some("run-test")
        );
        assert_eq!(
            wrapped.get("trace_id").and_then(serde_json::Value::as_str),
            Some("trace-test")
        );
        assert_eq!(
            wrapped.get("type").and_then(serde_json::Value::as_str),
            Some("status")
        );
        assert!(wrapped.get("payload").is_some());
    }
}
