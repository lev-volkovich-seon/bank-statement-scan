from typing import Optional


def run_verification(
    fields: dict,
    expected_amount: Optional[float],
    expected_recipient_account: Optional[str],
    session_reference: Optional[str],
) -> Optional[dict]:
    if not any([expected_amount is not None, expected_recipient_account, session_reference]):
        return None

    result = {}
    checks_run = 0
    checks_passed = 0

    if expected_amount is not None:
        checks_run += 1
        extracted = _safe_get(fields, "amounts", "transfer_amount", "value")
        try:
            match = abs(float(extracted) - float(expected_amount)) <= 0.01
        except (TypeError, ValueError):
            match = False
        result["amount_match"] = match
        if match:
            checks_passed += 1

    if expected_recipient_account is not None:
        checks_run += 1
        extracted = _safe_get(fields, "recipient_account", "value") or ""
        extracted_norm = extracted.replace(" ", "").lower()
        expected_norm = expected_recipient_account.replace(" ", "").lower()
        match = extracted_norm == expected_norm
        result["recipient_account_match"] = match
        if match:
            checks_passed += 1

    if session_reference is not None:
        checks_run += 1
        extracted = _safe_get(fields, "payment_description", "value") or ""
        match = extracted.strip().lower() == session_reference.strip().lower()
        result["session_reference_match"] = match
        if match:
            checks_passed += 1

    if checks_run == 0:
        result["overall"] = "null"
    elif checks_passed == checks_run:
        result["overall"] = "pass"
    elif checks_passed == 0:
        result["overall"] = "fail"
    else:
        result["overall"] = "partial"

    return result


def compute_review_required(
    document: dict,
    fields: dict,
    warnings: list,
    verification: Optional[dict],
    status: str,
) -> bool:
    if status == "rejected":
        return True
    if document.get("confidence", 1.0) < 0.85:
        return True
    transfer_conf = _safe_get(fields, "amounts", "transfer_amount", "confidence") or 1.0
    if transfer_conf < 0.80:
        return True
    ref_conf = _safe_get(fields, "reference_number", "confidence") or 1.0
    if ref_conf < 0.80:
        return True
    if len(warnings) >= 3:
        return True
    if verification:
        for key, val in verification.items():
            if key != "overall" and val is False:
                return True
    return False


def _safe_get(d: dict, *keys):
    for k in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d
