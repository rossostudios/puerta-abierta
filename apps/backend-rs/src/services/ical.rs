use chrono::{NaiveDate, Utc};
use reqwest::Client;
use serde_json::{Map, Value};
use sha1::{Digest, Sha1};
use sqlx::PgPool;

use crate::{
    error::{AppError, AppResult},
    repository::table_service::{create_row, list_rows, update_row},
};

const ACTIVE_RESERVATION_STATUSES: &[&str] = &["pending", "confirmed", "checked_in"];

pub async fn build_unit_ical_export(
    pool: &PgPool,
    org_id: &str,
    unit_id: &str,
    calendar_name: &str,
) -> AppResult<String> {
    let reservations = list_rows(
        pool,
        "reservations",
        Some(&json_map(&[
            ("organization_id", Value::String(org_id.to_string())),
            ("unit_id", Value::String(unit_id.to_string())),
        ])),
        5000,
        0,
        "check_in_date",
        true,
    )
    .await?;
    let blocks = list_rows(
        pool,
        "calendar_blocks",
        Some(&json_map(&[
            ("organization_id", Value::String(org_id.to_string())),
            ("unit_id", Value::String(unit_id.to_string())),
        ])),
        5000,
        0,
        "starts_on",
        true,
    )
    .await?;

    let active_reservations = reservations
        .into_iter()
        .filter(|row| {
            row.as_object()
                .and_then(|obj| obj.get("status"))
                .and_then(Value::as_str)
                .map(str::trim)
                .is_some_and(|status| ACTIVE_RESERVATION_STATUSES.contains(&status))
        })
        .collect::<Vec<_>>();

    let now_stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//Casaora//iCal Export//EN".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        "METHOD:PUBLISH".to_string(),
        format!("X-WR-CALNAME:{}", escape_ical_text(calendar_name)),
    ];

    for row in active_reservations {
        let Some(obj) = row.as_object() else {
            continue;
        };
        let reservation_id = string_value(obj.get("id")).unwrap_or_default();
        let start = compact_date(obj.get("check_in_date")).unwrap_or_default();
        let end = compact_date(obj.get("check_out_date")).unwrap_or_default();
        if reservation_id.is_empty() || start.len() != 8 || end.len() != 8 {
            continue;
        }

        add_event(
            &mut lines,
            &now_stamp,
            &format!("pa-resv-{reservation_id}"),
            &start,
            &end,
            "Reserved",
            "Busy (reservation)",
        );
    }

    for row in blocks {
        let Some(obj) = row.as_object() else {
            continue;
        };
        let block_id = string_value(obj.get("id")).unwrap_or_default();
        let start = compact_date(obj.get("starts_on")).unwrap_or_default();
        let end = compact_date(obj.get("ends_on")).unwrap_or_default();
        if block_id.is_empty() || start.len() != 8 || end.len() != 8 {
            continue;
        }

        let reason = string_value(obj.get("reason"))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Busy (calendar block)".to_string());

        add_event(
            &mut lines,
            &now_stamp,
            &format!("pa-block-{block_id}"),
            &start,
            &end,
            "Blocked",
            &reason,
        );
    }

    lines.push("END:VCALENDAR".to_string());

    let mut folded = Vec::new();
    for line in lines {
        folded.extend(fold_ical_line(&line, 75));
    }
    Ok(format!("{}\r\n", folded.join("\r\n")))
}

fn add_event(
    lines: &mut Vec<String>,
    now_stamp: &str,
    uid: &str,
    start: &str,
    end: &str,
    summary: &str,
    description: &str,
) {
    lines.push("BEGIN:VEVENT".to_string());
    lines.push(format!("UID:{uid}"));
    lines.push(format!("DTSTAMP:{now_stamp}"));
    lines.push(format!("DTSTART;VALUE=DATE:{start}"));
    lines.push(format!("DTEND;VALUE=DATE:{end}"));
    lines.push(format!("SUMMARY:{}", escape_ical_text(summary)));
    lines.push(format!("DESCRIPTION:{}", escape_ical_text(description)));
    lines.push("END:VEVENT".to_string());
}

fn escape_ical_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\\n")
}

fn fold_ical_line(line: &str, limit: usize) -> Vec<String> {
    if line.len() <= limit {
        return vec![line.to_string()];
    }

    let mut out = Vec::new();
    let mut remaining = line.to_string();
    while remaining.len() > limit {
        out.push(remaining[..limit].to_string());
        remaining = format!(" {}", &remaining[limit..]);
    }
    out.push(remaining);
    out
}

fn compact_date(value: Option<&Value>) -> Option<String> {
    string_value(value).map(|raw| raw.replace('-', ""))
}

fn string_value(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn json_map(entries: &[(&str, Value)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert((*key).to_string(), value.clone());
    }
    map
}

// ---------------------------------------------------------------------------
// iCal sync all integrations
// ---------------------------------------------------------------------------

/// Sync all active iCal integrations across all organizations.
pub async fn sync_all_ical_integrations(
    pool: &PgPool,
    client: &Client,
) -> Value {
    let mut filters = Map::new();
    filters.insert("is_active".to_string(), Value::Bool(true));

    let integrations = match list_rows(pool, "integrations", Some(&filters), 1000, 0, "created_at", true).await {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "Failed to fetch integrations for iCal sync");
            return serde_json::json!({
                "error": "Failed to fetch integrations",
                "synced": 0,
                "failed": 0,
            });
        }
    };

    let mut synced = 0u32;
    let mut failed = 0u32;
    let mut skipped = 0u32;

    for integration in &integrations {
        let ical_url = string_value(
            integration
                .as_object()
                .and_then(|o| o.get("ical_import_url")),
        );
        if ical_url.is_none() {
            skipped += 1;
            continue;
        }

        let integration_id = string_value(
            integration.as_object().and_then(|o| o.get("id")),
        )
        .unwrap_or_default();

        match sync_listing_ical_reservations(pool, client, integration, "system").await {
            Ok(_result) => {
                // Update last_ical_sync_at, clear error
                let mut patch = Map::new();
                patch.insert(
                    "last_ical_sync_at".to_string(),
                    Value::String(Utc::now().to_rfc3339()),
                );
                patch.insert("ical_sync_error".to_string(), Value::Null);
                let _ = update_row(pool, "integrations", &integration_id, &patch, "id").await;
                synced += 1;
            }
            Err(e) => {
                let error_msg = format!("{e}");
                let mut patch = Map::new();
                patch.insert(
                    "last_ical_sync_at".to_string(),
                    Value::String(Utc::now().to_rfc3339()),
                );
                patch.insert(
                    "ical_sync_error".to_string(),
                    Value::String(error_msg),
                );
                let _ = update_row(pool, "integrations", &integration_id, &patch, "id").await;
                failed += 1;
            }
        }
    }

    serde_json::json!({
        "total_integrations": integrations.len(),
        "synced": synced,
        "failed": failed,
        "skipped": skipped,
        "synced_at": Utc::now().to_rfc3339(),
    })
}

// ---------------------------------------------------------------------------
// iCal import / sync
// ---------------------------------------------------------------------------

const PA_UID_PREFIXES: &[&str] = &["pa-resv-", "pa-block-", "pa-"];

fn unfold_ical_lines(text: &str) -> Vec<String> {
    let mut unfolded: Vec<String> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            continue;
        }
        if (line.starts_with(' ') || line.starts_with('\t')) && !unfolded.is_empty() {
            if let Some(last) = unfolded.last_mut() {
                last.push_str(&line[1..]);
            }
        } else {
            unfolded.push(line.to_string());
        }
    }
    unfolded
}

fn parse_ical_date(value: &str, params: &Map<String, Value>) -> Option<NaiveDate> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if value.len() < 8 {
        return None;
    }
    // Both VALUE=DATE (all-day) and date-time formats use YYYYMMDD prefix.
    let _ = params; // params checked for VALUE=DATE in Python, but logic is identical
    let yyyymmdd = &value[..8];
    let formatted = format!(
        "{}-{}-{}",
        &yyyymmdd[0..4],
        &yyyymmdd[4..6],
        &yyyymmdd[6..8]
    );
    NaiveDate::parse_from_str(&formatted, "%Y-%m-%d").ok()
}

struct ICalEvent {
    uid: String,
    start_date: String,
    end_date: String,
    summary: String,
    description: String,
    status: String,
}

fn parse_ical_events(ics_text: &str) -> Vec<ICalEvent> {
    let unfolded = unfold_ical_lines(ics_text);
    // Each event is a map of property name -> Vec<(params, value)>.
    let mut events: Vec<Map<String, Value>> = Vec::new();
    let mut current: Option<Map<String, Value>> = None;

    for line in &unfolded {
        let upper = line.to_uppercase();
        if upper == "BEGIN:VEVENT" {
            current = Some(Map::new());
            continue;
        }
        if upper == "END:VEVENT" {
            if let Some(event) = current.take() {
                events.push(event);
            }
            continue;
        }
        let Some(ref mut event) = current else {
            continue;
        };
        let Some(colon_pos) = line.find(':') else {
            continue;
        };
        let key_part = &line[..colon_pos];
        let value = line[colon_pos + 1..].trim().to_string();

        let key_bits: Vec<&str> = key_part.split(';').collect();
        let key = key_bits[0].trim().to_uppercase();
        if key.is_empty() {
            continue;
        }

        let mut params = Map::new();
        for raw_param in &key_bits[1..] {
            let raw_param = raw_param.trim();
            if raw_param.is_empty() {
                continue;
            }
            if let Some((pkey, pval)) = raw_param.split_once('=') {
                params.insert(
                    pkey.trim().to_uppercase(),
                    Value::String(pval.trim().to_string()),
                );
            } else {
                params.insert(raw_param.to_uppercase(), Value::String("TRUE".to_string()));
            }
        }

        // Store as array of [params_object, value_string].
        let entry = Value::Array(vec![Value::Object(params), Value::String(value)]);
        if let Some(arr) = event
            .entry(&key)
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
        {
            arr.push(entry);
        }
    }

    let mut parsed = Vec::new();
    for event in &events {
        let (uid_params, uid_value) = first_prop(event, "UID");
        let (dtstart_params, dtstart_value) = first_prop(event, "DTSTART");
        let (dtend_params, dtend_value) = first_prop(event, "DTEND");
        let (_summary_params, summary_value) = first_prop(event, "SUMMARY");
        let (_desc_params, desc_value) = first_prop(event, "DESCRIPTION");
        let (_status_params, status_value) = first_prop(event, "STATUS");

        let _ = uid_params;

        let Some(start) = parse_ical_date(&dtstart_value, &dtstart_params) else {
            continue;
        };
        let Some(end) = parse_ical_date(&dtend_value, &dtend_params) else {
            continue;
        };
        if end <= start {
            continue;
        }

        let uid = if uid_value.trim().is_empty() {
            let stable = format!(
                "{}|{}|{}|{}",
                start.format("%Y-%m-%d"),
                end.format("%Y-%m-%d"),
                summary_value,
                desc_value
            );
            let mut hasher = Sha1::new();
            hasher.update(stable.as_bytes());
            format!("ical-{:x}", hasher.finalize())
        } else {
            uid_value.trim().to_string()
        };

        parsed.push(ICalEvent {
            uid,
            start_date: start.format("%Y-%m-%d").to_string(),
            end_date: end.format("%Y-%m-%d").to_string(),
            summary: summary_value.trim().to_string(),
            description: desc_value.trim().to_string(),
            status: status_value.trim().to_uppercase(),
        });
    }

    parsed
}

fn first_prop(event: &Map<String, Value>, name: &str) -> (Map<String, Value>, String) {
    let items = event
        .get(&name.to_uppercase())
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if items.is_empty() {
        return (Map::new(), String::new());
    }
    let pair = items[0].as_array().cloned().unwrap_or_default();
    let params = pair
        .first()
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let value = pair
        .get(1)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    (params, value)
}

fn should_ignore_uid(uid: &str) -> bool {
    let lowered = uid.trim().to_lowercase();
    PA_UID_PREFIXES
        .iter()
        .any(|prefix| lowered.starts_with(prefix))
}

async fn fetch_ical_text(client: &Client, url: &str) -> AppResult<String> {
    let url = url.trim();
    if url.is_empty() {
        return Err(AppError::BadRequest(
            "iCal import URL is empty.".to_string(),
        ));
    }

    let resp = client
        .get(url)
        .timeout(std::time::Duration::from_secs(20))
        .header("Accept", "text/calendar, text/plain;q=0.9, */*;q=0.1")
        .header(
            "User-Agent",
            "Casaora/1.0 (+https://casaora.co)",
        )
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, url = %url, "iCal fetch request failed");
            if e.is_timeout() {
                AppError::Dependency("iCal fetch timed out.".to_string())
            } else {
                AppError::Dependency("iCal fetch failed.".to_string())
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        tracing::error!(status = %status, url = %url, "iCal fetch returned non-success status");
        return Err(AppError::Dependency(
            "iCal fetch failed with non-success status.".to_string(),
        ));
    }

    resp.text().await.map_err(|e| {
        tracing::error!(error = %e, url = %url, "iCal fetch body read failed");
        AppError::Dependency("iCal fetch failed.".to_string())
    })
}

pub async fn sync_listing_ical_reservations(
    pool: &PgPool,
    client: &Client,
    listing: &Value,
    user_id: &str,
) -> AppResult<Value> {
    let obj = listing
        .as_object()
        .ok_or_else(|| AppError::BadRequest("Invalid listing object.".to_string()))?;

    let integration_id = string_value(obj.get("id"))
        .ok_or_else(|| AppError::BadRequest("Integration is missing id.".to_string()))?;
    let org_id = string_value(obj.get("organization_id"))
        .ok_or_else(|| AppError::BadRequest("Integration is missing organization_id.".to_string()))?;
    let unit_id = string_value(obj.get("unit_id"))
        .ok_or_else(|| AppError::BadRequest("Integration is missing unit_id.".to_string()))?;
    let ical_url = string_value(obj.get("ical_import_url")).ok_or_else(|| {
        AppError::BadRequest("Listing does not have an iCal import URL configured.".to_string())
    })?;

    let ics_text = fetch_ical_text(client, &ical_url).await?;
    let events = parse_ical_events(&ics_text);

    let mut desired: std::collections::HashMap<String, &ICalEvent> =
        std::collections::HashMap::new();
    let mut ignored_uid_prefix: u64 = 0;
    for event in &events {
        let uid = event.uid.trim();
        if uid.is_empty() {
            continue;
        }
        if should_ignore_uid(uid) {
            ignored_uid_prefix += 1;
            continue;
        }
        desired.insert(uid.to_string(), event);
    }

    // Pull only iCal-sourced reservations for this listing.
    let existing = list_rows(
        pool,
        "reservations",
        Some(&json_map(&[
            ("organization_id", Value::String(org_id.clone())),
            ("integration_id", Value::String(integration_id.clone())),
            ("source", Value::String("ical".to_string())),
        ])),
        5000,
        0,
        "check_in_date",
        true,
    )
    .await?;

    let mut existing_by_external: std::collections::HashMap<String, &Value> =
        std::collections::HashMap::new();
    for row in &existing {
        if let Some(ext) = row
            .as_object()
            .and_then(|o| o.get("external_reservation_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            existing_by_external.insert(ext.to_string(), row);
        }
    }

    let mut created: u64 = 0;
    let mut updated: u64 = 0;
    let mut cancelled: u64 = 0;
    let mut ignored: u64 = 0;
    let mut conflicts: u64 = 0;
    let mut errors: Vec<String> = Vec::new();

    let now_iso = Utc::now().to_rfc3339();

    for (uid, event) in &desired {
        let start_date = event.start_date.trim();
        let end_date = event.end_date.trim();
        let summary = event.summary.trim();
        let description = event.description.trim();
        let is_cancelled = event.status == "CANCELLED";

        if start_date.is_empty() || end_date.is_empty() {
            ignored += 1;
            continue;
        }

        let desired_status = if is_cancelled {
            "cancelled"
        } else {
            "confirmed"
        };

        if let Some(existing_row) = existing_by_external.get(uid.as_str()) {
            let Some(existing_obj) = existing_row.as_object() else {
                ignored += 1;
                continue;
            };
            let mut patch = Map::new();

            if string_value(existing_obj.get("unit_id")).as_deref() != Some(&unit_id) {
                patch.insert("unit_id".to_string(), Value::String(unit_id.clone()));
            }
            if string_value(existing_obj.get("integration_id")).as_deref() != Some(&integration_id) {
                patch.insert("integration_id".to_string(), Value::String(integration_id.clone()));
            }
            if string_value(existing_obj.get("integration_id")).as_deref() != Some(&integration_id) {
                patch.insert("integration_id".to_string(), Value::String(integration_id.clone()));
            }
            if string_value(existing_obj.get("source")).as_deref() != Some("ical") {
                patch.insert("source".to_string(), Value::String("ical".to_string()));
            }
            if string_value(existing_obj.get("check_in_date")).as_deref() != Some(start_date) {
                patch.insert(
                    "check_in_date".to_string(),
                    Value::String(start_date.to_string()),
                );
            }
            if string_value(existing_obj.get("check_out_date")).as_deref() != Some(end_date) {
                patch.insert(
                    "check_out_date".to_string(),
                    Value::String(end_date.to_string()),
                );
            }

            let current_status = string_value(existing_obj.get("status")).unwrap_or_default();
            if desired_status == "cancelled" {
                if current_status != "cancelled" {
                    patch.insert("status".to_string(), Value::String("cancelled".to_string()));
                    patch.insert(
                        "cancel_reason".to_string(),
                        Value::String("Cancelled in iCal feed".to_string()),
                    );
                    patch.insert("cancelled_at".to_string(), Value::String(now_iso.clone()));
                }
            } else if current_status != "checked_in"
                && current_status != "checked_out"
                && current_status != "confirmed"
            {
                patch.insert("status".to_string(), Value::String("confirmed".to_string()));
                patch.insert("cancel_reason".to_string(), Value::Null);
                patch.insert("cancelled_at".to_string(), Value::Null);
            }

            let existing_notes = string_value(existing_obj.get("notes")).unwrap_or_default();
            if existing_notes.is_empty() {
                if !summary.is_empty() {
                    patch.insert(
                        "notes".to_string(),
                        Value::String(format!("iCal: {summary}")),
                    );
                } else if !description.is_empty() {
                    let desc_trunc = if description.len() > 200 {
                        &description[..200]
                    } else {
                        description
                    };
                    patch.insert(
                        "notes".to_string(),
                        Value::String(format!("iCal: {desc_trunc}")),
                    );
                }
            }

            if !patch.is_empty() {
                let row_id = string_value(existing_obj.get("id")).unwrap_or_default();
                match update_row(pool, "reservations", &row_id, &patch, "id").await {
                    Ok(_) => updated += 1,
                    Err(e) => {
                        errors.push(e.detail_message());
                        conflicts += 1;
                    }
                }
            }
            continue;
        }

        // New event that's already cancelled in the feed — skip.
        if desired_status == "cancelled" {
            ignored += 1;
            continue;
        }

        let mut payload = json_map(&[
            ("organization_id", Value::String(org_id.clone())),
            ("unit_id", Value::String(unit_id.clone())),
            ("integration_id", Value::String(integration_id.clone())),
            ("integration_id", Value::String(integration_id.clone())),
            ("external_reservation_id", Value::String(uid.clone())),
            ("status", Value::String("confirmed".to_string())),
            ("source", Value::String("ical".to_string())),
            ("check_in_date", Value::String(start_date.to_string())),
            ("check_out_date", Value::String(end_date.to_string())),
            ("created_by_user_id", Value::String(user_id.to_string())),
        ]);
        if !summary.is_empty() {
            payload.insert(
                "notes".to_string(),
                Value::String(format!("iCal: {summary}")),
            );
        }

        match create_row(pool, "reservations", &payload).await {
            Ok(_) => created += 1,
            Err(e) => {
                errors.push(e.detail_message());
                conflicts += 1;
            }
        }
    }

    // Cancel reservations that disappeared from the feed.
    let desired_uids: std::collections::HashSet<&str> =
        desired.keys().map(String::as_str).collect();
    for row in &existing {
        let Some(obj) = row.as_object() else {
            continue;
        };
        let Some(ext) = obj
            .get("external_reservation_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
        else {
            continue;
        };
        if desired_uids.contains(ext) {
            continue;
        }
        let current_status = string_value(obj.get("status")).unwrap_or_default();
        if current_status != "pending" && current_status != "confirmed" {
            continue;
        }
        let row_id = string_value(obj.get("id")).unwrap_or_default();
        let cancel_patch = json_map(&[
            ("status", Value::String("cancelled".to_string())),
            (
                "cancel_reason",
                Value::String("Removed from iCal feed".to_string()),
            ),
            ("cancelled_at", Value::String(now_iso.clone())),
        ]);
        match update_row(pool, "reservations", &row_id, &cancel_patch, "id").await {
            Ok(_) => cancelled += 1,
            Err(e) => {
                errors.push(e.detail_message());
                conflicts += 1;
            }
        }
    }

    let mut result = serde_json::json!({
        "import_url": ical_url,
        "events_total": events.len(),
        "events_used": desired.len(),
        "events_ignored_uid_prefix": ignored_uid_prefix,
        "reservations_created": created,
        "reservations_updated": updated,
        "reservations_cancelled": cancelled,
        "reservations_ignored": ignored,
        "conflicts": conflicts,
        "processed_at": now_iso,
    });

    if !errors.is_empty() {
        let truncated = errors.len() > 8;
        result["errors"] = Value::Array(errors.into_iter().take(8).map(Value::String).collect());
        result["errors_truncated"] = Value::Bool(truncated);
    }

    Ok(result)
}
