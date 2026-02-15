use axum::{
    routing::{any, get},
    Router,
};

use crate::state::AppState;

pub mod agent_chats;
pub mod ai_agent;
pub mod applications;
pub mod calendar;
pub mod channels;
pub mod collections;
pub mod demo;
pub mod documents;
pub mod expenses;
pub mod guests;
pub mod health;
pub mod identity;
pub mod integrations;
pub mod leases;
pub mod maintenance;
pub mod marketplace;
pub mod messaging;
pub mod notifications;
pub mod organizations;
pub mod owner_statements;
pub mod payments;
pub mod platform;
pub mod pricing;
pub mod properties;
pub mod proxy;
pub mod public_ical;
pub mod tenant;
pub mod reports;
pub mod reservations;
pub mod subscriptions;
pub mod tasks;
pub mod workflows;

pub fn v1_router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health::health))
        .route("/me", get(identity::me))
        .merge(agent_chats::router())
        .merge(ai_agent::router())
        .merge(organizations::router())
        .merge(properties::router())
        .merge(channels::router())
        .merge(guests::router())
        .merge(reservations::router())
        .merge(calendar::router())
        .merge(tasks::router())
        .merge(expenses::router())
        .merge(collections::router())
        .merge(leases::router())
        .merge(applications::router())
        .merge(pricing::router())
        .merge(messaging::router())
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
        .merge(platform::router())
        .merge(demo::router())
        .fallback(any(proxy::proxy_unmigrated))
}
