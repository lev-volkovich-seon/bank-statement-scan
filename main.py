import asyncio
import uuid
from typing import Optional

from fastapi import FastAPI, File, Form, Header, Request, UploadFile
from fastapi.responses import JSONResponse
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from config import get_settings, GOOGLE_CLIENT_ID, ALLOWED_DOMAIN
from services.extraction import run_extraction

app = FastAPI(title="Bank Deposit Screenshot Extraction API", version="1.0.0")

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10MB


def _rfc7807(status: int, title: str, detail: str, instance: str) -> JSONResponse:
    settings = get_settings()
    slug = title.lower().replace(" ", "-")
    return JSONResponse(
        status_code=status,
        content={
            "type": f"https://api.seon.com/errors/{slug}",
            "title": title,
            "status": status,
            "detail": detail,
            "instance": instance,
        },
    )


@app.post("/v1/extractions/bank-deposit")
async def extract_bank_deposit(
    request: Request,
    image: UploadFile = File(...),
    expected_amount: Optional[float] = Form(None),
    expected_recipient_account: Optional[str] = Form(None),
    session_reference: Optional[str] = Form(None),
    provider: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    settings = get_settings()
    instance = f"/v1/extractions/bank-deposit/req_{uuid.uuid4().hex[:8]}"

    # Google SSO auth — validate ID token, restrict to @seon.io
    if not authorization or not authorization.startswith("Bearer "):
        return _rfc7807(401, "Unauthorized", "Missing or invalid Authorization header.", instance)
    google_id_token = authorization.removeprefix("Bearer ").strip()
    try:
        id_info = id_token.verify_oauth2_token(
            google_id_token,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
        email = id_info.get("email", "")
        if not email.endswith(ALLOWED_DOMAIN):
            return _rfc7807(403, "Forbidden", f"Access restricted to {ALLOWED_DOMAIN} accounts.", instance)
    except Exception:
        return _rfc7807(401, "Unauthorized", "Invalid or expired Google ID token.", instance)

    # Validate image
    content_type = image.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        return _rfc7807(400, "Invalid Request", f"Unsupported image type '{content_type}'. Accepted: JPEG, PNG, WEBP.", instance)

    image_bytes = await image.read()
    if len(image_bytes) > MAX_IMAGE_BYTES:
        return _rfc7807(400, "Invalid Request", "The uploaded image exceeds the maximum allowed size of 10MB.", instance)

    # Provider selection
    provider_name = (provider or settings.default_provider).lower()
    if provider_name not in ("claude", "gemini"):
        return _rfc7807(400, "Invalid Request", f"Unknown provider '{provider_name}'. Use 'claude' or 'gemini'.", instance)

    # Run extraction with timeout
    try:
        result = await asyncio.wait_for(
            run_extraction(
                image_bytes=image_bytes,
                mime_type=content_type,
                provider_name=provider_name,
                expected_amount=expected_amount,
                expected_recipient_account=expected_recipient_account,
                session_reference=session_reference,
            ),
            timeout=settings.timeout_seconds,
        )
    except asyncio.TimeoutError:
        return JSONResponse(status_code=504, content={"detail": "Model did not respond within the timeout window. Please retry."})
    except Exception as exc:
        return _rfc7807(500, "Internal Server Error", str(exc), instance)

    return JSONResponse(content=result)
