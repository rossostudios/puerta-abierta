use serde_json::{json, Map, Value};

use crate::error::AppResult;

/// Simulate a renovation ROI scenario.
pub fn tool_simulate_renovation_roi(args: &Map<String, Value>) -> AppResult<Value> {
    let renovation_cost = args
        .get("renovation_cost")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let current_monthly_rent = args
        .get("current_monthly_rent")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let projected_monthly_rent = args
        .get("projected_monthly_rent")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let vacancy_months = args
        .get("vacancy_months_during_renovation")
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    let projection_years = args
        .get("projection_years")
        .and_then(Value::as_i64)
        .unwrap_or(5)
        .clamp(1, 20) as usize;

    if renovation_cost <= 0.0 || current_monthly_rent <= 0.0 {
        return Ok(
            json!({ "ok": false, "error": "renovation_cost and current_monthly_rent must be positive." }),
        );
    }

    let monthly_increase = projected_monthly_rent - current_monthly_rent;
    let lost_revenue = current_monthly_rent * vacancy_months;
    let total_cost = renovation_cost + lost_revenue;

    let payback_months = if monthly_increase > 0.0 {
        (total_cost / monthly_increase).ceil() as i64
    } else {
        0
    };

    let mut yearly: Vec<Value> = Vec::new();
    let mut cumulative_gain = -total_cost;
    for year in 1..=projection_years {
        let annual_gain = monthly_increase * 12.0;
        cumulative_gain += annual_gain;
        yearly.push(json!({
            "year": year,
            "annual_rent_increase": (annual_gain * 100.0).round() / 100.0,
            "cumulative_net_gain": (cumulative_gain * 100.0).round() / 100.0,
        }));
    }

    let roi_pct = if total_cost > 0.0 {
        ((monthly_increase * 12.0 * projection_years as f64 - total_cost) / total_cost
            * 100.0
            * 100.0)
            .round()
            / 100.0
    } else {
        0.0
    };

    Ok(json!({
        "ok": true,
        "renovation_cost": renovation_cost,
        "vacancy_lost_revenue": (lost_revenue * 100.0).round() / 100.0,
        "total_cost": (total_cost * 100.0).round() / 100.0,
        "monthly_rent_increase": (monthly_increase * 100.0).round() / 100.0,
        "payback_months": payback_months,
        "roi_pct": roi_pct,
        "projection_years": projection_years,
        "yearly_projections": yearly,
    }))
}

/// Simulate a market downturn stress test.
pub fn tool_simulate_stress_test(args: &Map<String, Value>) -> AppResult<Value> {
    let base_revenue = args
        .get("base_monthly_revenue")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let base_expenses = args
        .get("base_monthly_expenses")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let occupancy_drop_pct = args
        .get("occupancy_drop_pct")
        .and_then(Value::as_f64)
        .unwrap_or(20.0)
        .clamp(0.0, 100.0);
    let rate_drop_pct = args
        .get("rate_drop_pct")
        .and_then(Value::as_f64)
        .unwrap_or(10.0)
        .clamp(0.0, 100.0);
    let expense_increase_pct = args
        .get("expense_increase_pct")
        .and_then(Value::as_f64)
        .unwrap_or(5.0)
        .clamp(0.0, 100.0);
    let months = args
        .get("duration_months")
        .and_then(Value::as_i64)
        .unwrap_or(6)
        .clamp(1, 24) as usize;

    if base_revenue <= 0.0 {
        return Ok(json!({ "ok": false, "error": "base_monthly_revenue must be positive." }));
    }

    let stress_revenue =
        base_revenue * (1.0 - occupancy_drop_pct / 100.0) * (1.0 - rate_drop_pct / 100.0);
    let stress_expenses = base_expenses * (1.0 + expense_increase_pct / 100.0);
    let stress_noi = stress_revenue - stress_expenses;
    let normal_noi = base_revenue - base_expenses;

    let mut monthly: Vec<Value> = Vec::new();
    let mut cumulative_loss = 0.0_f64;
    for m in 1..=months {
        let loss = normal_noi - stress_noi;
        cumulative_loss += loss;
        monthly.push(json!({
            "month": m,
            "revenue": (stress_revenue * 100.0).round() / 100.0,
            "expenses": (stress_expenses * 100.0).round() / 100.0,
            "noi": (stress_noi * 100.0).round() / 100.0,
            "loss_vs_normal": (loss * 100.0).round() / 100.0,
            "cumulative_loss": (cumulative_loss * 100.0).round() / 100.0,
        }));
    }

    let revenue_impact_pct =
        ((base_revenue - stress_revenue) / base_revenue * 100.0 * 100.0).round() / 100.0;
    let cash_reserve_needed = cumulative_loss.max(0.0);

    Ok(json!({
        "ok": true,
        "scenario": {
            "occupancy_drop_pct": occupancy_drop_pct,
            "rate_drop_pct": rate_drop_pct,
            "expense_increase_pct": expense_increase_pct,
            "duration_months": months,
        },
        "impact": {
            "normal_monthly_noi": (normal_noi * 100.0).round() / 100.0,
            "stressed_monthly_noi": (stress_noi * 100.0).round() / 100.0,
            "revenue_impact_pct": revenue_impact_pct,
            "total_cumulative_loss": (cumulative_loss * 100.0).round() / 100.0,
            "cash_reserve_needed": (cash_reserve_needed * 100.0).round() / 100.0,
            "noi_positive": stress_noi > 0.0,
        },
        "monthly_projections": monthly,
    }))
}

/// Parametric financial calculator for investment scenario simulation.
/// This is not LLM-dependent — it uses pure math to project cash flows.
pub fn tool_simulate_investment_scenario(args: &Map<String, Value>) -> AppResult<Value> {
    let base_revenue = args
        .get("base_monthly_revenue")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let base_expenses = args
        .get("base_monthly_expenses")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let revenue_growth = args
        .get("revenue_growth_pct")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        / 100.0;
    let expense_growth = args
        .get("expense_growth_pct")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        / 100.0;
    let investment = args
        .get("investment_amount")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let months = args
        .get("projection_months")
        .and_then(Value::as_i64)
        .unwrap_or(12)
        .clamp(1, 120) as usize;

    if base_revenue <= 0.0 {
        return Ok(json!({
            "ok": false,
            "error": "base_monthly_revenue must be positive.",
        }));
    }

    let mut monthly_projections = Vec::with_capacity(months);
    let mut cumulative_revenue = 0.0_f64;
    let mut cumulative_expenses = 0.0_f64;
    let mut cumulative_noi = 0.0_f64;
    let mut break_even_month: Option<usize> = None;

    for month in 1..=months {
        let m = month as f64;
        let projected_revenue = base_revenue * (1.0 + revenue_growth).powf(m - 1.0);
        let projected_expenses = base_expenses * (1.0 + expense_growth).powf(m - 1.0);
        let monthly_noi = projected_revenue - projected_expenses;

        cumulative_revenue += projected_revenue;
        cumulative_expenses += projected_expenses;
        cumulative_noi += monthly_noi;

        // Check break-even (cumulative NOI exceeds investment)
        if break_even_month.is_none() && investment > 0.0 && cumulative_noi >= investment {
            break_even_month = Some(month);
        }

        monthly_projections.push(json!({
            "month": month,
            "revenue": (projected_revenue * 100.0).round() / 100.0,
            "expenses": (projected_expenses * 100.0).round() / 100.0,
            "noi": (monthly_noi * 100.0).round() / 100.0,
            "cumulative_noi": (cumulative_noi * 100.0).round() / 100.0,
        }));
    }

    let total_noi = cumulative_noi;
    let roi = if investment > 0.0 {
        (total_noi - investment) / investment * 100.0
    } else {
        0.0
    };

    let annual_noi = if months >= 12 {
        // Use last 12 months average
        let last_12: f64 = monthly_projections
            .iter()
            .rev()
            .take(12)
            .filter_map(|m| m.get("noi").and_then(Value::as_f64))
            .sum();
        last_12
    } else {
        total_noi / months as f64 * 12.0
    };

    let cap_rate = if investment > 0.0 {
        annual_noi / investment * 100.0
    } else {
        0.0
    };

    Ok(json!({
        "ok": true,
        "projection_months": months,
        "investment_amount": (investment * 100.0).round() / 100.0,
        "summary": {
            "total_revenue": (cumulative_revenue * 100.0).round() / 100.0,
            "total_expenses": (cumulative_expenses * 100.0).round() / 100.0,
            "total_noi": (total_noi * 100.0).round() / 100.0,
            "roi_pct": (roi * 100.0).round() / 100.0,
            "cap_rate_pct": (cap_rate * 100.0).round() / 100.0,
            "break_even_month": break_even_month,
            "annualized_noi": (annual_noi * 100.0).round() / 100.0,
        },
        "monthly_projections": monthly_projections,
    }))
}
