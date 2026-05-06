import time
import uuid
from pathlib import Path
from typing import Optional

from config import get_settings
from providers.claude import ClaudeProvider
from providers.gemini import GeminiProvider
from providers.base import AIProvider
from services.verification import run_verification, compute_review_required

_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "v1_0_0.txt"
_SYSTEM_PROMPT: str = _PROMPT_PATH.read_text()


def get_provider(name: str) -> AIProvider:
    if name == "gemini":
        return GeminiProvider()
    return ClaudeProvider()


async def run_extraction(
    image_bytes: bytes,
    mime_type: str,
    provider_name: str,
    expected_amount: Optional[float] = None,
    expected_recipient_account: Optional[str] = None,
    session_reference: Optional[str] = None,
) -> dict:
    settings = get_settings()
    provider = get_provider(provider_name)

    start_ms = time.time() * 1000
    model_response = await provider.extract(image_bytes, mime_type, _SYSTEM_PROMPT)
    processing_time_ms = int(time.time() * 1000 - start_ms)

    extraction_id = str(uuid.uuid4())
    status = model_response.get("status", "success")

    metadata = {
        "prompt_version": settings.prompt_version,
        "processing_time_ms": processing_time_ms,
    }

    if status == "rejected":
        return {
            "extraction_id": extraction_id,
            "status": "rejected",
            "metadata": metadata,
            "reason": model_response.get("reason", "not_a_bank_document"),
            "review_required": True,
        }

    fields = model_response.get("fields", {})
    document = model_response.get("document", {})
    warnings = model_response.get("warnings", [])

    verification = run_verification(
        fields,
        expected_amount,
        expected_recipient_account,
        session_reference,
    )

    review_required = compute_review_required(document, fields, warnings, verification, status)

    return {
        "extraction_id": extraction_id,
        "status": status,
        "metadata": metadata,
        "document": document,
        "fields": fields,
        "verification": verification,
        "warnings": warnings,
        "review_required": review_required,
    }
