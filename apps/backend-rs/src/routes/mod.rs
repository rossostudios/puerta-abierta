use axum::{extract::State, routing::get, Json, Router};
use serde_json::{json, Value};

use crate::state::AppState;

pub mod agent_chats;
pub mod agent_inbox;
pub mod agent_management;
pub mod agent_playbooks;
pub mod ai_agent;
pub mod applications;
pub mod approvals;
pub mod booking;
pub mod calendar;
pub mod cancellation_policies;
pub mod collections;
pub mod contract_templates;
pub mod demo;
pub mod deposits;
pub mod documents;
pub mod expenses;
pub mod guest_portal;
pub mod guests;
pub mod health;
pub mod identity;
pub mod integrations;
pub mod leases;
pub mod maintenance;
pub mod marketplace;
pub mod messaging;
pub mod notification_center;
pub mod notifications;
pub mod organizations;
pub mod owner_portal;
pub mod owner_statements;
pub mod payments;
pub mod platform;
pub mod pricing;
pub mod properties;
pub mod public_ical;
pub mod referrals;
pub mod reports;
pub mod reservations;
pub mod reviews;
pub mod sequences;
pub mod subscriptions;
pub mod tasks;
pub mod tenant;
pub mod vendor_portal;
pub mod workflows;

async fn public_fx_rate(State(state): State<AppState>) -> Json<Value> {
    let rate = crate::services::fx::get_cached_usd_pyg_rate(&state.http_client).await;
    Json(json!({ "usd_pyg": rate }))
}

pub fn v1_router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health::health))
        .route("/me", get(identity::me))
        .route("/public/fx/usd-pyg", get(public_fx_rate))
        .merge(agent_chats::router())
        .merge(agent_inbox::router())
        .merge(agent_management::router())
        .merge(agent_playbooks::router())
        .merge(ai_agent::router())
        .merge(organizations::router())
        .merge(properties::router())
        .merge(guests::router())
        .merge(reservations::router())
        .merge(calendar::router())
        .merge(cancellation_policies::router())
        .merge(tasks::router())
        .merge(expenses::router())
        .merge(collections::router())
        .merge(leases::router())
        .merge(applications::router())
        .merge(pricing::router())
        .merge(messaging::router())
        .merge(notification_center::router())
        .merge(payments::router())
        .merge(notifications::router())
        .merge(maintenance::router())
        .merge(tenant::router())
        .merge(integrations::router())
        .merge(owner_statements::router())
        .merge(reports::router())
        .merge(marketplace::router())
        .merge(public_ical::router())
        .merge(documents::router())
        .merge(workflows::router())
        .merge(subscriptions::router())
        .merge(referrals::router())
        .merge(platform::router())
        .merge(sequences::router())
        .merge(booking::router())
        .merge(deposits::router())
        .merge(contract_templates::router())
        .merge(owner_portal::router())
        .merge(guest_portal::router())
        .merge(approvals::router())
        .merge(vendor_portal::router())
        .merge(reviews::router())
        .merge(demo::router())
}
