use axum::{extract::Request, middleware::Next, response::Response};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct CurrentRequestId(pub String);

tokio::task_local! {
    static REQUEST_ID_TASK_LOCAL: CurrentRequestId;
}

pub fn current_request_id() -> Option<String> {
    REQUEST_ID_TASK_LOCAL.try_with(|value| value.0.clone()).ok()
}

/// Middleware that generates a unique request ID and attaches it to the
/// current tracing span. Also sets an `x-request-id` response header.
pub async fn inject_request_id(request: Request, next: Next) -> Response {
    let request_id = request
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let span = tracing::info_span!(
        "request",
        request_id = %request_id,
        method = %request.method(),
        path = %request.uri().path(),
    );
    let _guard = span.enter();

    tracing::debug!(request_id = %request_id, "Processing request");

    let mut response = {
        drop(_guard);
        let _entered = span.enter();
        REQUEST_ID_TASK_LOCAL
            .scope(CurrentRequestId(request_id.clone()), async {
                next.run(request).await
            })
            .await
    };

    response.headers_mut().insert(
        "x-request-id",
        request_id
            .parse()
            .unwrap_or_else(|_| axum::http::HeaderValue::from_static("unknown")),
    );

    response
}
