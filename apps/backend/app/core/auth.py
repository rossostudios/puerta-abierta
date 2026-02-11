from typing import Annotated, Optional

from fastapi import Header, HTTPException

from app.core.config import settings
from app.db.supabase import get_supabase_client


def _bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts[0].strip().lower(), parts[1].strip()
    if scheme != "bearer" or not token:
        return None
    return token


def current_user_id(
    authorization: Annotated[Optional[str], Header()] = None,
    x_user_id: Annotated[Optional[str], Header()] = None,
) -> Optional[str]:
    # Allow explicit user overrides only outside production.
    if settings.auth_dev_overrides_enabled and x_user_id:
        return x_user_id

    token = _bearer_token(authorization)
    if token:
        try:
            client = get_supabase_client()
            user_resp = client.auth.get_user(token)
            return user_resp.user.id if user_resp and user_resp.user else None
        except Exception:
            return None

    if settings.auth_dev_overrides_enabled:
        return settings.default_user_id
    return None


def current_supabase_user(
    authorization: Annotated[Optional[str], Header()] = None,
    x_user_id: Annotated[Optional[str], Header()] = None,
):
    # When an explicit user override is used we cannot fetch the Supabase user.
    if settings.auth_dev_overrides_enabled and x_user_id:
        return None

    token = _bearer_token(authorization)
    if not token:
        return None

    try:
        client = get_supabase_client()
        user_resp = client.auth.get_user(token)
        return user_resp.user if user_resp and user_resp.user else None
    except Exception:
        return None


def require_user_id(
    authorization: Annotated[Optional[str], Header()] = None,
    x_user_id: Annotated[Optional[str], Header()] = None,
) -> str:
    # Dependency wrapper that enforces authentication.
    resolved = current_user_id(authorization=authorization, x_user_id=x_user_id)
    if not resolved:
        raise HTTPException(status_code=401, detail="Unauthorized: missing or invalid Supabase access token.")
    return resolved


def require_supabase_user(
    authorization: Annotated[Optional[str], Header()] = None,
    x_user_id: Annotated[Optional[str], Header()] = None,
):
    user = current_supabase_user(authorization=authorization, x_user_id=x_user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized: missing or invalid Supabase access token.")
    return user
