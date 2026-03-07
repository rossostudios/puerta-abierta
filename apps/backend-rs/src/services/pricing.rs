#![allow(dead_code)]

use serde_json::Value;

use crate::services::json_helpers::round2;

const REQUIRED_FEE_TYPES: &[&str] = &["monthly_rent", "advance_rent", "service_fee_flat"];
const GUARANTEE_FEE_TYPES: &[&str] = &["security_deposit", "guarantee_option_fee"];

#[derive(Debug, Clone)]
pub struct PricingTotals {
    pub total_move_in: f64,
    pub monthly_recurring_total: f64,
    pub totals_by_type: std::collections::HashMap<String, f64>,
}

#[derive(Debug, Clone, Default)]
pub struct LeaseFinancials {
    pub monthly_rent: f64,
    pub service_fee_flat: f64,
    pub security_deposit: f64,
    pub guarantee_option_fee: f64,
    pub tax_iva: f64,
    pub total_move_in: f64,
    pub monthly_recurring_total: f64,
}

pub fn normalize_fee_lines(lines: &[Value]) -> Vec<Value> {
    let mut normalized: Vec<LineCandidate> = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        let Some(obj) = line.as_object() else {
            continue;
        };

        let fee_type = string_value(obj.get("fee_type")).unwrap_or_default();
        if fee_type.is_empty() {
            continue;
        }

        let mut label = string_value(obj.get("label")).unwrap_or_default();
        if label.is_empty() {
            label = fee_type.replace('_', " ");
            label = to_title_case(&label);
        }
        if label.is_empty() {
            label = fee_type.clone();
        }

        let mut is_recurring = bool_value(obj.get("is_recurring"));
        if fee_type == "monthly_rent" {
            is_recurring = true;
        }

        normalized.push(LineCandidate {
            fee_type,
            label,
            amount: round2(non_negative_number(obj.get("amount"))),
            is_refundable: bool_value(obj.get("is_refundable")),
            is_recurring,
            sort_order: positive_i32(obj.get("sort_order")).unwrap_or((index + 1) as i32),
        });
    }

    normalized.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then(left.fee_type.cmp(&right.fee_type))
    });

    normalized
        .into_iter()
        .map(|line| {
            serde_json::json!({
                "fee_type": line.fee_type,
                "label": line.label,
                "amount": line.amount,
                "is_refundable": line.is_refundable,
                "is_recurring": line.is_recurring,
                "sort_order": line.sort_order,
            })
        })
        .collect()
}

pub fn missing_required_fee_types(lines: &[Value]) -> Vec<String> {
    let present = lines
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|line| line.get("fee_type"))
        .filter_map(|value| value.as_str().map(str::trim))
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<std::collections::HashSet<_>>();

    let mut missing = REQUIRED_FEE_TYPES
        .iter()
        .filter(|fee_type| !present.contains(**fee_type))
        .map(|fee_type| (*fee_type).to_string())
        .collect::<Vec<_>>();

    let has_guarantee = GUARANTEE_FEE_TYPES
        .iter()
        .any(|fee_type| present.contains(*fee_type));
    if !has_guarantee {
        missing.push("security_deposit_or_guarantee_option_fee".to_string());
    }

    missing
}

pub fn compute_pricing_totals(lines: &[Value]) -> PricingTotals {
    let mut totals_by_type: std::collections::HashMap<String, f64> =
        std::collections::HashMap::new();
    let mut total_move_in = 0.0;
    let mut monthly_recurring_total = 0.0;

    for line in lines {
        let Some(obj) = line.as_object() else {
            continue;
        };
        let fee_type = string_value(obj.get("fee_type")).unwrap_or_default();
        if fee_type.is_empty() {
            continue;
        }

        let amount = non_negative_number(obj.get("amount"));
        let next_total = totals_by_type.get(&fee_type).copied().unwrap_or(0.0) + amount;
        totals_by_type.insert(fee_type.clone(), round2(next_total));

        total_move_in += amount;

        if bool_value(obj.get("is_recurring")) || fee_type == "monthly_rent" {
            monthly_recurring_total += amount;
        }
    }

    PricingTotals {
        total_move_in: round2(total_move_in),
        monthly_recurring_total: round2(monthly_recurring_total),
        totals_by_type,
    }
}

pub fn lease_financials_from_lines(lines: &[Value]) -> LeaseFinancials {
    let totals = compute_pricing_totals(lines);
    LeaseFinancials {
        monthly_rent: round2(non_negative_f64(
            totals.totals_by_type.get("monthly_rent").copied(),
        )),
        service_fee_flat: round2(non_negative_f64(
            totals.totals_by_type.get("service_fee_flat").copied(),
        )),
        security_deposit: round2(non_negative_f64(
            totals.totals_by_type.get("security_deposit").copied(),
        )),
        guarantee_option_fee: round2(non_negative_f64(
            totals.totals_by_type.get("guarantee_option_fee").copied(),
        )),
        tax_iva: round2(non_negative_f64(
            totals.totals_by_type.get("tax_iva").copied(),
        )),
        total_move_in: round2(non_negative_f64(Some(totals.total_move_in))),
        monthly_recurring_total: round2(non_negative_f64(Some(totals.monthly_recurring_total))),
    }
}

#[derive(Debug, Clone)]
struct LineCandidate {
    fee_type: String,
    label: String,
    amount: f64,
    is_refundable: bool,
    is_recurring: bool,
    sort_order: i32,
}

fn string_value(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn bool_value(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(flag)) => *flag,
        Some(Value::String(text)) => {
            let lower = text.trim().to_ascii_lowercase();
            lower == "true" || lower == "1"
        }
        Some(Value::Number(number)) => number.as_i64().is_some_and(|value| value != 0),
        _ => false,
    }
}

fn positive_i32(value: Option<&Value>) -> Option<i32> {
    let raw = match value {
        Some(Value::Number(number)) => number.as_i64(),
        Some(Value::String(text)) => text.trim().parse::<i64>().ok(),
        _ => None,
    }?;

    if raw <= 0 {
        return None;
    }
    i32::try_from(raw).ok()
}

fn non_negative_number(value: Option<&Value>) -> f64 {
    let raw = match value {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
    .unwrap_or(0.0);

    raw.max(0.0)
}

fn non_negative_f64(value: Option<f64>) -> f64 {
    value.unwrap_or(0.0).max(0.0)
}

fn to_title_case(value: &str) -> String {
    value
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            let Some(first) = chars.next() else {
                return String::new();
            };
            let mut out = String::new();
            out.extend(first.to_uppercase());
            out.push_str(&chars.as_str().to_lowercase());
            out
        })
        .collect::<Vec<_>>()
        .join(" ")
}
