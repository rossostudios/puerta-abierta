use std::sync::Arc;
use std::time::Instant;

use reqwest::Client;
use serde_json::{json, Map, Value};

use crate::config::AppConfig;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LlmProvider {
    OpenAi,
    Anthropic,
}

impl LlmProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
        }
    }

    pub fn qualify_model(self, model: &str) -> String {
        format!("{}:{}", self.as_str(), model.trim())
    }
}

#[derive(Debug, Clone)]
struct ResolvedModelChain {
    provider: LlmProvider,
    models: Vec<String>,
    fallback_from: Option<String>,
}

/// A structured request for the LLM client.
pub struct ChatRequest<'a> {
    pub messages: &'a [Value],
    pub tools: Option<&'a [Value]>,
    pub preferred_model: Option<&'a str>,
    pub temperature: Option<f64>,
    pub timeout_seconds: Option<u64>,
}

/// Response from an LLM call with token tracking and latency.
#[derive(Debug, Clone)]
pub struct ChatResponse {
    pub body: Value,
    pub provider: LlmProvider,
    pub model_used: String,
    pub fallback_used: bool,
    pub fallback_from: Option<String>,
    pub latency_ms: u64,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    pub stop_reason: Option<String>,
    pub cache_creation_input_tokens: u32,
    pub cache_read_input_tokens: u32,
}

/// Central LLM client abstraction with model fallback, token tracking, and latency measurement.
#[derive(Clone)]
pub struct LlmClient {
    http_client: Client,
    config: Arc<AppConfig>,
}

impl LlmClient {
    pub fn new(http_client: Client, config: Arc<AppConfig>) -> Self {
        Self {
            http_client,
            config,
        }
    }

    /// Execute a chat completion request with model fallback chain.
    pub async fn chat_completion(&self, request: ChatRequest<'_>) -> AppResult<ChatResponse> {
        let resolved = resolve_model_chain(&self.config, request.preferred_model)?;
        match resolved.provider {
            LlmProvider::OpenAi => self.chat_completion_via_openai(request, &resolved).await,
            LlmProvider::Anthropic => {
                self.chat_completion_via_anthropic_messages(request, &resolved)
                    .await
            }
        }
    }

    /// Execute the same logical chat+tools request via OpenAI Responses API and
    /// normalize it back into a chat-completions-like payload shape so the
    /// existing agent tool loop can migrate incrementally.
    pub async fn chat_completion_via_responses(
        &self,
        request: ChatRequest<'_>,
    ) -> AppResult<ChatResponse> {
        let resolved = resolve_model_chain(&self.config, request.preferred_model)?;
        match resolved.provider {
            LlmProvider::OpenAi => {
                self.chat_completion_via_openai_responses(request, &resolved)
                    .await
            }
            LlmProvider::Anthropic => {
                self.chat_completion_via_anthropic_messages(request, &resolved)
                    .await
            }
        }
    }

    async fn chat_completion_via_openai(
        &self,
        request: ChatRequest<'_>,
        resolved: &ResolvedModelChain,
    ) -> AppResult<ChatResponse> {
        let api_key = self
            .config
            .openai_api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::ServiceUnavailable(
                    "OPENAI_API_KEY is missing. Configure it in backend environment variables."
                        .to_string(),
                )
            })?;

        let chat_completions_url = self.config.openai_chat_completions_url();
        let temperature = request.temperature.unwrap_or(0.1);
        let timeout_secs = request
            .timeout_seconds
            .unwrap_or(self.config.ai_agent_timeout_seconds);

        let mut last_error: Option<AppError> = None;

        for (index, model_name) in resolved.models.iter().enumerate() {
            let mut payload = Map::new();
            payload.insert("model".to_string(), Value::String(model_name.to_string()));
            payload.insert(
                "messages".to_string(),
                Value::Array(request.messages.to_vec()),
            );
            payload.insert("temperature".to_string(), Value::from(temperature));
            if let Some(tools) = request.tools {
                payload.insert("tools".to_string(), Value::Array(tools.to_vec()));
                payload.insert("tool_choice".to_string(), Value::String("auto".to_string()));
            }

            let start = Instant::now();
            let response = match self
                .http_client
                .post(&chat_completions_url)
                .header("Authorization", format!("Bearer {api_key}"))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .timeout(std::time::Duration::from_secs(timeout_secs))
                .json(&payload)
                .send()
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    tracing::error!(error = %error, model = %model_name, "OpenAI provider is unreachable");
                    last_error = Some(AppError::Dependency(
                        "AI provider is unreachable.".to_string(),
                    ));
                    if index < resolved.models.len() - 1 {
                        continue;
                    }
                    return Err(last_error.take().unwrap_or_else(|| {
                        AppError::Dependency("AI provider is unreachable.".to_string())
                    }));
                }
            };

            let latency_ms = start.elapsed().as_millis() as u64;
            let status = response.status();
            let body_text = response.text().await.unwrap_or_default();
            if !status.is_success() {
                let detail = provider_error_detail(
                    self.config.as_ref(),
                    "openai",
                    model_name,
                    status.as_u16(),
                    &body_text,
                    false,
                );
                last_error = Some(AppError::Dependency(detail));
                if index < resolved.models.len() - 1 {
                    continue;
                }
                return Err(last_error.take().unwrap_or_else(|| {
                    AppError::Dependency("AI provider request failed.".to_string())
                }));
            }

            let parsed = parse_provider_json(&body_text)?;
            let usage = parsed.get("usage");
            let prompt_tokens = usage
                .and_then(|u| u.get("prompt_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let completion_tokens = usage
                .and_then(|u| u.get("completion_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let total_tokens = usage
                .and_then(|u| u.get("total_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let stop_reason = parsed
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|choices| choices.first())
                .and_then(Value::as_object)
                .and_then(|choice| choice.get("finish_reason"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);

            return Ok(ChatResponse {
                body: parsed,
                provider: LlmProvider::OpenAi,
                model_used: LlmProvider::OpenAi.qualify_model(model_name),
                fallback_used: index > 0,
                fallback_from: if index > 0 {
                    resolved.fallback_from.clone()
                } else {
                    None
                },
                latency_ms,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                stop_reason,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            });
        }

        Err(last_error
            .unwrap_or_else(|| AppError::Dependency("AI provider request failed.".to_string())))
    }

    async fn chat_completion_via_openai_responses(
        &self,
        request: ChatRequest<'_>,
        resolved: &ResolvedModelChain,
    ) -> AppResult<ChatResponse> {
        let api_key = self
            .config
            .openai_api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::ServiceUnavailable(
                    "OPENAI_API_KEY is missing. Configure it in backend environment variables."
                        .to_string(),
                )
            })?;

        let responses_url = self.config.openai_responses_url();
        let temperature = request.temperature.unwrap_or(0.1);
        let timeout_secs = request
            .timeout_seconds
            .unwrap_or(self.config.ai_agent_timeout_seconds);
        let responses_input = chat_messages_to_responses_input(request.messages);
        let responses_tools = chat_tools_to_responses_tools(request.tools);

        let mut last_error: Option<AppError> = None;

        for (index, model_name) in resolved.models.iter().enumerate() {
            let mut payload = Map::new();
            payload.insert("model".to_string(), Value::String(model_name.to_string()));
            payload.insert("input".to_string(), Value::Array(responses_input.clone()));
            payload.insert("temperature".to_string(), Value::from(temperature));
            if let Some(tools) = &responses_tools {
                payload.insert("tools".to_string(), Value::Array(tools.clone()));
                payload.insert("tool_choice".to_string(), Value::String("auto".to_string()));
            }

            let start = Instant::now();
            let response = match self
                .http_client
                .post(&responses_url)
                .header("Authorization", format!("Bearer {api_key}"))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .timeout(std::time::Duration::from_secs(timeout_secs))
                .json(&payload)
                .send()
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    tracing::error!(error = %error, model = %model_name, "OpenAI provider is unreachable");
                    last_error = Some(AppError::Dependency(
                        "AI provider is unreachable.".to_string(),
                    ));
                    if index < resolved.models.len() - 1 {
                        continue;
                    }
                    return Err(last_error.take().unwrap_or_else(|| {
                        AppError::Dependency("AI provider is unreachable.".to_string())
                    }));
                }
            };

            let latency_ms = start.elapsed().as_millis() as u64;
            let status = response.status();
            let body_text = response.text().await.unwrap_or_default();
            if !status.is_success() {
                let detail = provider_error_detail(
                    self.config.as_ref(),
                    "openai",
                    model_name,
                    status.as_u16(),
                    &body_text,
                    true,
                );
                last_error = Some(AppError::Dependency(detail));
                if index < resolved.models.len() - 1 {
                    continue;
                }
                return Err(last_error.take().unwrap_or_else(|| {
                    AppError::Dependency("AI provider request failed.".to_string())
                }));
            }

            let parsed = parse_provider_json(&body_text)?;
            let usage = parsed.get("usage");
            let prompt_tokens = usage
                .and_then(|u| u.get("input_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let completion_tokens = usage
                .and_then(|u| u.get("output_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let total_tokens = usage
                .and_then(|u| u.get("total_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let stop_reason = parsed
                .get("stop_reason")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            let normalized_body = responses_body_to_chat_completion_like(parsed);

            return Ok(ChatResponse {
                body: normalized_body,
                provider: LlmProvider::OpenAi,
                model_used: LlmProvider::OpenAi.qualify_model(model_name),
                fallback_used: index > 0,
                fallback_from: if index > 0 {
                    resolved.fallback_from.clone()
                } else {
                    None
                },
                latency_ms,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                stop_reason,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            });
        }

        Err(last_error
            .unwrap_or_else(|| AppError::Dependency("AI provider request failed.".to_string())))
    }

    async fn chat_completion_via_anthropic_messages(
        &self,
        request: ChatRequest<'_>,
        resolved: &ResolvedModelChain,
    ) -> AppResult<ChatResponse> {
        let api_key = self
            .config
            .anthropic_api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::ServiceUnavailable(
                    "ANTHROPIC_API_KEY is missing. Configure it in backend environment variables."
                        .to_string(),
                )
            })?;

        let messages_url = self.config.anthropic_messages_url();
        let timeout_secs = request
            .timeout_seconds
            .unwrap_or(self.config.ai_agent_timeout_seconds);
        let temperature = request.temperature.unwrap_or(0.1);
        let (system_prompt, anthropic_messages) =
            chat_messages_to_anthropic_payload(request.messages);
        let anthropic_tools = chat_tools_to_anthropic_tools(request.tools);

        let mut last_error: Option<AppError> = None;

        for (index, model_name) in resolved.models.iter().enumerate() {
            let mut payload = Map::new();
            payload.insert("model".to_string(), Value::String(model_name.to_string()));
            payload.insert("max_tokens".to_string(), Value::from(2048_u32));
            payload.insert("temperature".to_string(), Value::from(temperature));
            payload.insert(
                "messages".to_string(),
                Value::Array(anthropic_messages.clone()),
            );
            if !system_prompt.is_empty() {
                payload.insert("system".to_string(), Value::String(system_prompt.clone()));
            }
            if let Some(tools) = &anthropic_tools {
                payload.insert("tools".to_string(), Value::Array(tools.clone()));
            }

            let start = Instant::now();
            let response = match self
                .http_client
                .post(&messages_url)
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .timeout(std::time::Duration::from_secs(timeout_secs))
                .json(&payload)
                .send()
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    tracing::error!(error = %error, model = %model_name, "Anthropic provider is unreachable");
                    last_error = Some(AppError::Dependency(
                        "AI provider is unreachable.".to_string(),
                    ));
                    if index < resolved.models.len() - 1 {
                        continue;
                    }
                    return Err(last_error.take().unwrap_or_else(|| {
                        AppError::Dependency("AI provider is unreachable.".to_string())
                    }));
                }
            };

            let latency_ms = start.elapsed().as_millis() as u64;
            let status = response.status();
            let body_text = response.text().await.unwrap_or_default();
            if !status.is_success() {
                let detail = provider_error_detail(
                    self.config.as_ref(),
                    "anthropic",
                    model_name,
                    status.as_u16(),
                    &body_text,
                    false,
                );
                last_error = Some(AppError::Dependency(detail));
                if index < resolved.models.len() - 1 {
                    continue;
                }
                return Err(last_error.take().unwrap_or_else(|| {
                    AppError::Dependency("AI provider request failed.".to_string())
                }));
            }

            let parsed = parse_provider_json(&body_text)?;
            let usage = parsed.get("usage");
            let prompt_tokens = usage
                .and_then(|u| u.get("input_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let completion_tokens = usage
                .and_then(|u| u.get("output_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let cache_creation_input_tokens = usage
                .and_then(|u| u.get("cache_creation_input_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let cache_read_input_tokens = usage
                .and_then(|u| u.get("cache_read_input_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let total_tokens = prompt_tokens
                .saturating_add(completion_tokens)
                .saturating_add(cache_creation_input_tokens)
                .saturating_add(cache_read_input_tokens);
            let stop_reason = parsed
                .get("stop_reason")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            let normalized_body = anthropic_body_to_chat_completion_like(parsed);

            return Ok(ChatResponse {
                body: normalized_body,
                provider: LlmProvider::Anthropic,
                model_used: LlmProvider::Anthropic.qualify_model(model_name),
                fallback_used: index > 0,
                fallback_from: if index > 0 {
                    resolved.fallback_from.clone()
                } else {
                    None
                },
                latency_ms,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                stop_reason,
                cache_creation_input_tokens,
                cache_read_input_tokens,
            });
        }

        Err(last_error
            .unwrap_or_else(|| AppError::Dependency("AI provider request failed.".to_string())))
    }
}

fn resolve_model_chain(
    config: &AppConfig,
    preferred_model: Option<&str>,
) -> AppResult<ResolvedModelChain> {
    let candidate = preferred_model
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let openai_models = config.openai_model_chain();
    let anthropic_models = config.anthropic_model_chain();

    if let Some(candidate) = candidate {
        if let Some((provider, raw_model)) = parse_qualified_model(candidate) {
            let source = match provider {
                LlmProvider::OpenAi => &openai_models,
                LlmProvider::Anthropic => &anthropic_models,
            };
            if source.iter().any(|model| model == raw_model) {
                return Ok(ResolvedModelChain {
                    provider,
                    models: with_preferred_model(source.clone(), Some(raw_model)),
                    fallback_from: source.first().map(|model| provider.qualify_model(model)),
                });
            }
            return Err(AppError::BadRequest(format!(
                "preferred_model '{candidate}' is not configured for this environment."
            )));
        }

        if openai_models.iter().any(|model| model == candidate) {
            return Ok(ResolvedModelChain {
                provider: LlmProvider::OpenAi,
                models: with_preferred_model(openai_models.clone(), Some(candidate)),
                fallback_from: openai_models
                    .first()
                    .map(|model| LlmProvider::OpenAi.qualify_model(model)),
            });
        }

        if anthropic_models.iter().any(|model| model == candidate) {
            return Ok(ResolvedModelChain {
                provider: LlmProvider::Anthropic,
                models: with_preferred_model(anthropic_models.clone(), Some(candidate)),
                fallback_from: anthropic_models
                    .first()
                    .map(|model| LlmProvider::Anthropic.qualify_model(model)),
            });
        }

        return Err(AppError::BadRequest(format!(
            "preferred_model '{candidate}' is not configured for this environment."
        )));
    }

    if !openai_models.is_empty() {
        return Ok(ResolvedModelChain {
            provider: LlmProvider::OpenAi,
            models: openai_models,
            fallback_from: None,
        });
    }

    if !anthropic_models.is_empty() {
        return Ok(ResolvedModelChain {
            provider: LlmProvider::Anthropic,
            models: anthropic_models,
            fallback_from: None,
        });
    }

    Err(AppError::ServiceUnavailable(
        "No AI models are configured. Configure OPENAI_* or ANTHROPIC_* environment variables."
            .to_string(),
    ))
}

fn parse_qualified_model(candidate: &str) -> Option<(LlmProvider, &str)> {
    let (prefix, model) = candidate.split_once(':')?;
    let provider = match prefix.trim().to_ascii_lowercase().as_str() {
        "openai" => LlmProvider::OpenAi,
        "anthropic" => LlmProvider::Anthropic,
        _ => return None,
    };
    let model = model.trim();
    if model.is_empty() {
        return None;
    }
    Some((provider, model))
}

fn provider_error_detail(
    config: &AppConfig,
    provider: &str,
    model_name: &str,
    status: u16,
    body_text: &str,
    responses_api: bool,
) -> String {
    if config.is_production() {
        return "AI provider request failed.".to_string();
    }

    let error_body = body_text.trim();
    let suffix = if responses_api { " [responses]" } else { "" };
    let reason = if error_body.is_empty() {
        "unknown"
    } else {
        error_body
    };
    format!(
        "AI provider request failed ({status}) on {provider} model '{model_name}'{suffix}: {reason}"
    )
}

fn parse_provider_json(body_text: &str) -> AppResult<Value> {
    let parsed: Value = serde_json::from_str(body_text).map_err(|_| {
        AppError::Dependency("AI provider returned an invalid JSON response.".to_string())
    })?;
    if !parsed.is_object() {
        return Err(AppError::Dependency(
            "AI provider response is malformed.".to_string(),
        ));
    }
    Ok(parsed)
}

fn chat_messages_to_anthropic_payload(messages: &[Value]) -> (String, Vec<Value>) {
    let mut system_chunks = Vec::new();
    let mut converted = Vec::new();

    for message in messages {
        let Some(obj) = message.as_object() else {
            continue;
        };
        let role = obj
            .get("role")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();

        if role == "system" {
            if let Some(content) = obj.get("content").and_then(Value::as_str) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    system_chunks.push(trimmed.to_string());
                }
            }
            continue;
        }

        if role == "user" {
            if let Some(content) = obj.get("content").and_then(Value::as_str) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    converted.push(json!({
                        "role": "user",
                        "content": [{"type": "text", "text": trimmed}],
                    }));
                }
            }
            continue;
        }

        if role == "assistant" {
            let mut content_blocks = Vec::new();
            if let Some(content) = obj.get("content").and_then(Value::as_str) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    content_blocks.push(json!({
                        "type": "text",
                        "text": trimmed,
                    }));
                }
            }

            let tool_calls = obj
                .get("tool_calls")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for call in tool_calls {
                let Some(call_obj) = call.as_object() else {
                    continue;
                };
                let function = call_obj
                    .get("function")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                let tool_use_id = call_obj
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("tool-call");
                let name = function
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("tool");
                let input = function
                    .get("arguments")
                    .and_then(Value::as_str)
                    .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                    .unwrap_or_else(|| json!({}));
                content_blocks.push(json!({
                    "type": "tool_use",
                    "id": tool_use_id,
                    "name": name,
                    "input": input,
                }));
            }

            if !content_blocks.is_empty() {
                converted.push(json!({
                    "role": "assistant",
                    "content": content_blocks,
                }));
            }
            continue;
        }

        if role == "tool" {
            let tool_call_id = obj
                .get("tool_call_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("tool-call");
            let output = obj
                .get("content")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("{}");
            converted.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_call_id,
                    "content": output,
                }],
            }));
        }
    }

    (system_chunks.join("\n\n"), converted)
}

fn chat_tools_to_anthropic_tools(tools: Option<&[Value]>) -> Option<Vec<Value>> {
    let tools = tools?;
    let mut mapped = Vec::new();

    for tool in tools {
        let Some(obj) = tool.as_object() else {
            continue;
        };
        let Some(function) = obj.get("function").and_then(Value::as_object) else {
            continue;
        };
        let Some(name) = function
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        mapped.push(json!({
            "name": name,
            "description": function
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default(),
            "input_schema": function
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| json!({"type":"object","properties":{}})),
        }));
    }

    if mapped.is_empty() {
        None
    } else {
        Some(mapped)
    }
}

fn anthropic_body_to_chat_completion_like(parsed: Value) -> Value {
    let response_id = parsed.get("id").cloned().unwrap_or(Value::Null);
    let usage = parsed.get("usage").cloned().unwrap_or_else(|| json!({}));
    let mut assistant_text_chunks = Vec::new();
    let mut tool_calls = Vec::new();

    for item in parsed
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let item_type = obj
            .get("type")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        match item_type {
            "text" => {
                let text = obj
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default();
                if !text.is_empty() {
                    assistant_text_chunks.push(text.to_string());
                }
            }
            "tool_use" => {
                let id = obj
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("tool-call");
                let name = obj
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("tool");
                let arguments =
                    serde_json::to_string(&obj.get("input").cloned().unwrap_or_else(|| json!({})))
                        .unwrap_or_else(|_| "{}".to_string());
                tool_calls.push(json!({
                    "id": id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": arguments,
                    }
                }));
            }
            _ => {}
        }
    }

    json!({
        "id": response_id,
        "_provider": "anthropic_messages",
        "usage": {
            "prompt_tokens": usage.get("input_tokens").cloned().unwrap_or(Value::from(0)),
            "completion_tokens": usage.get("output_tokens").cloned().unwrap_or(Value::from(0)),
            "total_tokens": Value::from(
                usage.get("input_tokens").and_then(Value::as_u64).unwrap_or(0)
                    + usage.get("output_tokens").and_then(Value::as_u64).unwrap_or(0)
            ),
            "cache_creation_input_tokens": usage
                .get("cache_creation_input_tokens")
                .cloned()
                .unwrap_or(Value::from(0)),
            "cache_read_input_tokens": usage
                .get("cache_read_input_tokens")
                .cloned()
                .unwrap_or(Value::from(0)),
        },
        "choices": [{
            "finish_reason": parsed.get("stop_reason").cloned().unwrap_or(Value::Null),
            "message": {
                "role": "assistant",
                "content": assistant_text_chunks.join("\n").trim(),
                "tool_calls": tool_calls,
            }
        }]
    })
}

fn chat_messages_to_responses_input(messages: &[Value]) -> Vec<Value> {
    let mut input: Vec<Value> = Vec::new();

    for message in messages {
        let Some(obj) = message.as_object() else {
            continue;
        };

        let role = obj
            .get("role")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();

        if matches!(role, "system" | "user" | "assistant") {
            if let Some(content) = obj.get("content").and_then(Value::as_str) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    input.push(json!({
                        "role": role,
                        "content": trimmed,
                    }));
                }
            }

            if role == "assistant" {
                let tool_calls = obj
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for call in tool_calls {
                    let Some(call_obj) = call.as_object() else {
                        continue;
                    };
                    let function = call_obj
                        .get("function")
                        .and_then(Value::as_object)
                        .cloned()
                        .unwrap_or_default();
                    let call_id = call_obj
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .unwrap_or("tool-call");
                    let name = function
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .unwrap_or("tool");
                    let arguments = function
                        .get("arguments")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .unwrap_or("{}");
                    input.push(json!({
                        "type": "function_call",
                        "call_id": call_id,
                        "name": name,
                        "arguments": arguments,
                    }));
                }
            }
            continue;
        }

        if role == "tool" {
            let call_id = obj
                .get("tool_call_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("tool-call");
            let output = obj
                .get("content")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("{}");
            input.push(json!({
                "type": "function_call_output",
                "call_id": call_id,
                "output": output,
            }));
        }
    }

    input
}

fn chat_tools_to_responses_tools(tools: Option<&[Value]>) -> Option<Vec<Value>> {
    let tools = tools?;
    let mut mapped = Vec::new();

    for tool in tools {
        let Some(obj) = tool.as_object() else {
            continue;
        };
        let Some(function) = obj.get("function").and_then(Value::as_object) else {
            continue;
        };
        let Some(name) = function
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };

        let description = function
            .get("description")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let parameters = function
            .get("parameters")
            .cloned()
            .unwrap_or_else(|| json!({"type":"object","properties":{}}));

        mapped.push(json!({
            "type": "function",
            "name": name,
            "description": description,
            "parameters": parameters,
        }));
    }

    if mapped.is_empty() {
        None
    } else {
        Some(mapped)
    }
}

fn responses_body_to_chat_completion_like(parsed: Value) -> Value {
    let response_id = parsed.get("id").cloned().unwrap_or(Value::Null);
    let mut assistant_text_chunks: Vec<String> = Vec::new();
    let mut tool_calls: Vec<Value> = Vec::new();

    let output_items = parsed
        .get("output")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for item in output_items {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let item_type = obj
            .get("type")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();

        match item_type {
            "message" => {
                let role = obj
                    .get("role")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default();
                if role != "assistant" {
                    continue;
                }
                let content = obj.get("content").cloned().unwrap_or(Value::Null);
                if let Some(text) = extract_responses_message_text(&content) {
                    if !text.trim().is_empty() {
                        assistant_text_chunks.push(text);
                    }
                }
            }
            "function_call" => {
                let call_id = obj
                    .get("call_id")
                    .or_else(|| obj.get("id"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("tool-call");
                let name = obj
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("tool");
                let arguments = obj
                    .get("arguments")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or("{}");

                tool_calls.push(json!({
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": arguments,
                    }
                }));
            }
            _ => {}
        }
    }

    let assistant_text = assistant_text_chunks.join("\n").trim().to_string();
    let usage = parsed.get("usage").cloned().unwrap_or_else(|| json!({}));
    let body = json!({
        "id": response_id,
        "_provider": "openai_responses",
        "usage": {
            "prompt_tokens": usage.get("input_tokens").cloned().unwrap_or(Value::from(0)),
            "completion_tokens": usage.get("output_tokens").cloned().unwrap_or(Value::from(0)),
            "total_tokens": usage.get("total_tokens").cloned().unwrap_or(Value::from(0)),
        },
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": assistant_text,
                    "tool_calls": tool_calls,
                }
            }
        ]
    });

    body
}

fn extract_responses_message_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    let mut chunks = Vec::new();
    for part in content.as_array().into_iter().flatten() {
        let Some(obj) = part.as_object() else {
            continue;
        };
        let part_type = obj
            .get("type")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if !matches!(part_type, "output_text" | "text") {
            continue;
        }
        let text = obj
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if !text.is_empty() {
            chunks.push(text.to_string());
        }
    }

    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join("\n"))
    }
}

fn with_preferred_model(model_chain: Vec<String>, preferred_model: Option<&str>) -> Vec<String> {
    let preferred = preferred_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    if preferred.is_empty() {
        return model_chain;
    }

    if !model_chain.iter().any(|model| model == preferred) {
        return model_chain;
    }

    let mut next = Vec::with_capacity(model_chain.len());
    next.push(preferred.to_string());
    for model in model_chain {
        if model != preferred {
            next.push(model);
        }
    }
    next
}

#[cfg(test)]
mod tests {
    use super::{
        chat_messages_to_responses_input, chat_tools_to_responses_tools,
        responses_body_to_chat_completion_like,
    };
    use serde_json::json;

    #[test]
    fn maps_chat_tools_to_responses_tools() {
        let tools = vec![json!({
            "type": "function",
            "function": {
                "name": "list_rows",
                "description": "List rows",
                "parameters": {"type":"object","properties":{"table":{"type":"string"}}}
            }
        })];

        let mapped = chat_tools_to_responses_tools(Some(&tools)).expect("tools mapped");
        assert_eq!(mapped.len(), 1);
        assert_eq!(
            mapped[0].get("type").and_then(|v| v.as_str()),
            Some("function")
        );
        assert_eq!(
            mapped[0].get("name").and_then(|v| v.as_str()),
            Some("list_rows")
        );
        assert!(mapped[0].get("function").is_none());
    }

    #[test]
    fn maps_chat_messages_to_responses_input_with_tool_history() {
        let messages = vec![
            json!({"role":"system","content":"You are helpful"}),
            json!({"role":"user","content":"Check unit status"}),
            json!({
                "role":"assistant",
                "content":"I'll check.",
                "tool_calls":[
                    {
                        "id":"call_123",
                        "type":"function",
                        "function":{"name":"list_rows","arguments":"{\"table\":\"units\"}"}
                    }
                ]
            }),
            json!({"role":"tool","tool_call_id":"call_123","content":"{\"ok\":true,\"data\":[]}"}),
        ];

        let input = chat_messages_to_responses_input(&messages);
        assert!(input.iter().any(|v| {
            v.get("role").and_then(|r| r.as_str()) == Some("system")
                && v.get("content").and_then(|c| c.as_str()) == Some("You are helpful")
        }));
        assert!(input.iter().any(|v| {
            v.get("type").and_then(|t| t.as_str()) == Some("function_call")
                && v.get("call_id").and_then(|c| c.as_str()) == Some("call_123")
        }));
        assert!(input.iter().any(|v| {
            v.get("type").and_then(|t| t.as_str()) == Some("function_call_output")
                && v.get("call_id").and_then(|c| c.as_str()) == Some("call_123")
        }));
    }

    #[test]
    fn normalizes_responses_output_to_chat_completion_shape() {
        let raw = json!({
            "id": "resp_abc",
            "usage": { "input_tokens": 11, "output_tokens": 5, "total_tokens": 16 },
            "output": [
                { "type": "reasoning", "id": "rs_1" },
                {
                    "type": "function_call",
                    "id": "fc_internal",
                    "call_id": "call_1",
                    "name": "list_rows",
                    "arguments": "{\"table\":\"properties\"}"
                },
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        { "type": "output_text", "text": "Found 12 properties." }
                    ]
                }
            ]
        });

        let normalized = responses_body_to_chat_completion_like(raw);
        let msg = normalized
            .get("choices")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.get("message"))
            .cloned()
            .expect("message");

        assert_eq!(
            msg.get("content").and_then(|v| v.as_str()),
            Some("Found 12 properties.")
        );
        let tool_calls = msg
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .expect("tool_calls");
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(
            tool_calls[0]
                .get("function")
                .and_then(|v| v.get("name"))
                .and_then(|v| v.as_str()),
            Some("list_rows")
        );
        assert_eq!(
            normalized
                .get("usage")
                .and_then(|v| v.get("prompt_tokens"))
                .and_then(|v| v.as_u64()),
            Some(11)
        );
    }
}
