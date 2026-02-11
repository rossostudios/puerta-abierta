from typing import Any, Iterable

REQUIRED_FEE_TYPES = {"monthly_rent", "advance_rent", "service_fee_flat"}
GUARANTEE_FEE_TYPES = {"security_deposit", "guarantee_option_fee"}


def _to_float(value: Any) -> float:
    try:
        amount = float(value)
    except Exception:
        return 0.0
    if amount < 0:
        return 0.0
    return amount


def _to_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        return fallback
    return parsed if parsed > 0 else fallback


def normalize_fee_lines(lines: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, line in enumerate(lines, start=1):
        fee_type = str(line.get("fee_type") or "").strip()
        if not fee_type:
            continue
        label = str(line.get("label") or fee_type.replace("_", " ").title()).strip()
        if not label:
            label = fee_type

        is_recurring = bool(line.get("is_recurring"))
        if fee_type == "monthly_rent":
            is_recurring = True

        normalized.append(
            {
                "fee_type": fee_type,
                "label": label,
                "amount": round(_to_float(line.get("amount")), 2),
                "is_refundable": bool(line.get("is_refundable")),
                "is_recurring": is_recurring,
                "sort_order": _to_int(line.get("sort_order"), index),
            }
        )

    return sorted(normalized, key=lambda item: (int(item.get("sort_order") or 0), item.get("fee_type") or ""))


def missing_required_fee_types(lines: Iterable[dict[str, Any]]) -> list[str]:
    present = {str(line.get("fee_type") or "").strip() for line in lines}
    missing = [fee_type for fee_type in sorted(REQUIRED_FEE_TYPES) if fee_type not in present]

    has_guarantee = any(fee_type in present for fee_type in GUARANTEE_FEE_TYPES)
    if not has_guarantee:
        missing.append("security_deposit_or_guarantee_option_fee")

    return missing


def compute_pricing_totals(lines: Iterable[dict[str, Any]]) -> dict[str, Any]:
    totals_by_type: dict[str, float] = {}
    total_move_in = 0.0
    monthly_recurring_total = 0.0

    for line in lines:
        fee_type = str(line.get("fee_type") or "").strip()
        if not fee_type:
            continue
        amount = _to_float(line.get("amount"))
        totals_by_type[fee_type] = round((totals_by_type.get(fee_type) or 0.0) + amount, 2)
        total_move_in += amount

        if bool(line.get("is_recurring")) or fee_type == "monthly_rent":
            monthly_recurring_total += amount

    return {
        "total_move_in": round(total_move_in, 2),
        "monthly_recurring_total": round(monthly_recurring_total, 2),
        "totals_by_type": totals_by_type,
    }


def lease_financials_from_lines(lines: Iterable[dict[str, Any]]) -> dict[str, float]:
    totals = compute_pricing_totals(lines)
    totals_by_type = totals.get("totals_by_type") or {}

    return {
        "monthly_rent": round(_to_float(totals_by_type.get("monthly_rent")), 2),
        "service_fee_flat": round(_to_float(totals_by_type.get("service_fee_flat")), 2),
        "security_deposit": round(_to_float(totals_by_type.get("security_deposit")), 2),
        "guarantee_option_fee": round(_to_float(totals_by_type.get("guarantee_option_fee")), 2),
        "tax_iva": round(_to_float(totals_by_type.get("tax_iva")), 2),
        "total_move_in": round(_to_float(totals.get("total_move_in")), 2),
        "monthly_recurring_total": round(_to_float(totals.get("monthly_recurring_total")), 2),
    }
