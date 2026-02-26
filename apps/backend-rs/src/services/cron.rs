use chrono::{Datelike, NaiveDateTime, Timelike, Utc};

/// Simple cron expression parser supporting: minute hour day_of_month month day_of_week
/// Supports: specific values, wildcards (*), and lists (1,15).
pub struct CronSchedule {
    minutes: Vec<u32>,
    hours: Vec<u32>,
    days_of_month: Vec<u32>,
    months: Vec<u32>,
    days_of_week: Vec<u32>,
}

impl CronSchedule {
    /// Parse a standard 5-field cron expression.
    /// Format: "minute hour day_of_month month day_of_week"
    /// Example: "0 8 * * *" = every day at 08:00
    /// Example: "0 */2 * * *" = every 2 hours
    /// Example: "0 9 * * 1-5" = weekdays at 09:00
    pub fn parse(expr: &str) -> Result<Self, String> {
        let parts: Vec<&str> = expr.trim().split_whitespace().collect();
        if parts.len() != 5 {
            return Err(format!(
                "Invalid cron expression: expected 5 fields, got {}",
                parts.len()
            ));
        }

        Ok(CronSchedule {
            minutes: parse_field(parts[0], 0, 59)?,
            hours: parse_field(parts[1], 0, 23)?,
            days_of_month: parse_field(parts[2], 1, 31)?,
            months: parse_field(parts[3], 1, 12)?,
            days_of_week: parse_field(parts[4], 0, 6)?,
        })
    }

    /// Check if the given datetime matches this cron schedule.
    pub fn matches(&self, dt: &NaiveDateTime) -> bool {
        let minute = dt.minute();
        let hour = dt.hour();
        let day = dt.day();
        let month = dt.month();
        let weekday = dt.weekday().num_days_from_sunday(); // 0=Sun, 6=Sat

        self.minutes.contains(&minute)
            && self.hours.contains(&hour)
            && self.days_of_month.contains(&day)
            && self.months.contains(&month)
            && self.days_of_week.contains(&weekday)
    }

    /// Compute the next occurrence after the given datetime.
    pub fn next_after(&self, after: &NaiveDateTime) -> Option<NaiveDateTime> {
        let mut dt = *after + chrono::Duration::minutes(1);
        // Zero out seconds
        dt = dt
            .date()
            .and_hms_opt(dt.hour(), dt.minute(), 0)
            .unwrap_or(dt);

        // Search up to 1 year ahead
        let limit = *after + chrono::Duration::days(366);
        while dt < limit {
            if self.matches(&dt) {
                return Some(dt);
            }
            dt += chrono::Duration::minutes(1);
            // Skip ahead if hour doesn't match
            if !self.hours.contains(&dt.hour()) {
                dt = dt.date().and_hms_opt(dt.hour() + 1, 0, 0).unwrap_or(dt);
                if dt.hour() == 0 {
                    dt += chrono::Duration::days(1);
                    dt = dt.date().and_hms_opt(0, 0, 0).unwrap_or(dt);
                }
            }
        }
        None
    }

    /// Check if this schedule should fire now (within the last minute window).
    pub fn should_fire_now(&self) -> bool {
        let now = Utc::now().naive_utc();
        self.matches(&now)
    }
}

/// Parse a single cron field into a list of matching values.
fn parse_field(field: &str, min: u32, max: u32) -> Result<Vec<u32>, String> {
    let field = field.trim();

    // Wildcard
    if field == "*" {
        return Ok((min..=max).collect());
    }

    // Step: */N or M/N
    if field.contains('/') {
        let parts: Vec<&str> = field.splitn(2, '/').collect();
        let start = if parts[0] == "*" {
            min
        } else {
            parts[0]
                .parse::<u32>()
                .map_err(|_| format!("Invalid cron field: {field}"))?
        };
        let step = parts[1]
            .parse::<u32>()
            .map_err(|_| format!("Invalid step in cron field: {field}"))?;
        if step == 0 {
            return Err(format!("Step cannot be zero in: {field}"));
        }
        let mut values = Vec::new();
        let mut v = start;
        while v <= max {
            values.push(v);
            v += step;
        }
        return Ok(values);
    }

    // Range: M-N
    if field.contains('-') {
        let parts: Vec<&str> = field.splitn(2, '-').collect();
        let start = parts[0]
            .parse::<u32>()
            .map_err(|_| format!("Invalid range start: {field}"))?;
        let end = parts[1]
            .parse::<u32>()
            .map_err(|_| format!("Invalid range end: {field}"))?;
        if start > end || start < min || end > max {
            return Err(format!("Invalid range: {field}"));
        }
        return Ok((start..=end).collect());
    }

    // List: M,N,O
    if field.contains(',') {
        let values: Result<Vec<u32>, _> = field
            .split(',')
            .map(|v| {
                v.trim()
                    .parse::<u32>()
                    .map_err(|_| format!("Invalid value in list: {field}"))
            })
            .collect();
        let values = values?;
        for v in &values {
            if *v < min || *v > max {
                return Err(format!("Value {v} out of range {min}-{max} in: {field}"));
            }
        }
        return Ok(values);
    }

    // Single value
    let value = field
        .parse::<u32>()
        .map_err(|_| format!("Invalid cron field: {field}"))?;
    if value < min || value > max {
        return Err(format!(
            "Value {value} out of range {min}-{max} in: {field}"
        ));
    }
    Ok(vec![value])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_every_minute() {
        let schedule = CronSchedule::parse("* * * * *").unwrap();
        assert_eq!(schedule.minutes.len(), 60);
        assert_eq!(schedule.hours.len(), 24);
    }

    #[test]
    fn parse_daily_at_8() {
        let schedule = CronSchedule::parse("0 8 * * *").unwrap();
        assert_eq!(schedule.minutes, vec![0]);
        assert_eq!(schedule.hours, vec![8]);
    }

    #[test]
    fn parse_every_2_hours() {
        let schedule = CronSchedule::parse("0 */2 * * *").unwrap();
        assert_eq!(
            schedule.hours,
            vec![0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]
        );
    }

    #[test]
    fn matches_works() {
        let schedule = CronSchedule::parse("30 9 * * *").unwrap();
        let dt = chrono::NaiveDate::from_ymd_opt(2026, 2, 22)
            .unwrap()
            .and_hms_opt(9, 30, 0)
            .unwrap();
        assert!(schedule.matches(&dt));

        let dt2 = chrono::NaiveDate::from_ymd_opt(2026, 2, 22)
            .unwrap()
            .and_hms_opt(10, 30, 0)
            .unwrap();
        assert!(!schedule.matches(&dt2));
    }

    #[test]
    fn invalid_expression_rejected() {
        assert!(CronSchedule::parse("bad").is_err());
        assert!(CronSchedule::parse("* * *").is_err());
    }
}
