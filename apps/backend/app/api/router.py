from fastapi import APIRouter

from app.api.routers import (
    applications,
    calendar,
    channels,
    collections,
    demo,
    expenses,
    guests,
    health,
    identity,
    integrations,
    leases,
    marketplace,
    messaging,
    organizations,
    owner_statements,
    pricing,
    properties,
    public_ical,
    reports,
    reservations,
    tasks,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(identity.router)
api_router.include_router(demo.router)
api_router.include_router(organizations.router)
api_router.include_router(properties.router)
api_router.include_router(channels.router)
api_router.include_router(guests.router)
api_router.include_router(reservations.router)
api_router.include_router(calendar.router)
api_router.include_router(tasks.router)
api_router.include_router(expenses.router)
api_router.include_router(owner_statements.router)
api_router.include_router(pricing.router)
api_router.include_router(marketplace.router)
api_router.include_router(applications.router)
api_router.include_router(leases.router)
api_router.include_router(collections.router)
api_router.include_router(messaging.router)
api_router.include_router(reports.router)
api_router.include_router(integrations.router)
api_router.include_router(public_ical.router)
