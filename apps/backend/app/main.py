from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.api.router import api_router
from app.core.config import settings

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Operations API for short-term rentals in Paraguay",
    docs_url="/docs" if settings.docs_enabled_runtime else None,
    redoc_url="/redoc" if settings.docs_enabled_runtime else None,
    openapi_url="/openapi.json" if settings.docs_enabled_runtime else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _host_allowed(host: str, allowed_hosts: list[str]) -> bool:
    if not host:
        return False
    host = host.split(":", 1)[0].strip().lower()
    if not host:
        return False

    for pattern in allowed_hosts:
        candidate = pattern.strip().lower()
        if not candidate:
            continue
        if candidate == "*":
            return True
        if candidate.startswith("*."):
            suffix = candidate[2:]
            if host == suffix or host.endswith(f".{suffix}"):
                return True
            continue
        if host == candidate:
            return True
    return False


@app.middleware("http")
async def attach_security_headers(request: Request, call_next) -> Response:
    path = request.url.path
    health_path = f"{settings.api_prefix}/health"
    allowed_hosts = settings.trusted_hosts_list
    if path != health_path and allowed_hosts and not _host_allowed(
        request.headers.get("host", ""),
        allowed_hosts,
    ):
        return JSONResponse(
            {
                "status": "error",
                "code": 400,
                "message": "Invalid host header",
            },
            status_code=400,
        )

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if settings.is_production:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

app.include_router(api_router, prefix=settings.api_prefix)
