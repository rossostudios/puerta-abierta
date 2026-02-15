use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::{Datelike, Months, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::require_user_id,
    error::{AppError, AppResult},
    repository::table_service::{create_row, list_rows},
    state::AppState,
    tenancy::assert_org_role,
};

pub fn router() -> axum::Router<AppState> {
    axum::Router::new().route("/demo/seed", axum::routing::post(seed_demo))
}

/// Generate a deterministic UUID from the org namespace + a key.
fn demo_uuid(ns: &Uuid, key: &str) -> Uuid {
    Uuid::new_v5(ns, key.as_bytes())
}

/// Format a NaiveDate as YYYY-MM-DD string.
fn d(date: chrono::NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

/// Shortcut to create a row, returning the JSON value.
async fn ins(pool: &sqlx::PgPool, table: &str, data: Value) -> AppResult<Value> {
    let map = serde_json::from_value(data).unwrap_or_default();
    create_row(pool, table, &map).await
}

async fn seed_demo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user_id(&state, &headers).await?;
    let pool = db_pool(&state)?;

    let org_id = payload
        .get("organization_id")
        .or_else(|| payload.get("org_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::BadRequest("organization_id is required.".to_string()))?
        .to_string();

    let org_uuid = Uuid::parse_str(&org_id).map_err(|_| {
        AppError::BadRequest("Invalid organization_id (expected UUID).".to_string())
    })?;

    assert_org_role(&state, &user_id, &org_id, &["owner_admin"]).await?;

    // Only seed into an empty org.
    let existing = list_rows(
        pool,
        "properties",
        Some(&serde_json::from_value(json!({"organization_id": org_id})).unwrap_or_default()),
        1,
        0,
        "created_at",
        false,
    )
    .await?;
    if !existing.is_empty() {
        return Err(AppError::Conflict(
            "Demo data already exists for this organization (properties found).".to_string(),
        ));
    }

    let ns = org_uuid;
    let today = Utc::now().date_naive();
    let period_start = today.with_day(1).unwrap_or(today);

    let mut summary = serde_json::Map::new();

    // ──────────────────────────────────────────
    // 1. Properties (5)
    // ──────────────────────────────────────────
    struct PropDef {
        key: &'static str,
        name: &'static str,
        code: &'static str,
        address: &'static str,
        city: &'static str,
    }

    let properties = [
        PropDef {
            key: "prop:villa-morra",
            name: "Villa Morra Apartments (Demo)",
            code: "DEMO-VM",
            address: "Av. Mcal. López 3820",
            city: "Asuncion",
        },
        PropDef {
            key: "prop:carmelitas",
            name: "Carmelitas Residences (Demo)",
            code: "DEMO-CAR",
            address: "Calle Senador Long 651",
            city: "Asuncion",
        },
        PropDef {
            key: "prop:manora",
            name: "Manorá Tower (Demo)",
            code: "DEMO-MAN",
            address: "Av. Aviadores del Chaco 1240",
            city: "Asuncion",
        },
        PropDef {
            key: "prop:recoleta",
            name: "Recoleta Heights (Demo)",
            code: "DEMO-REC",
            address: "Calle Lomas Valentinas 450",
            city: "Asuncion",
        },
        PropDef {
            key: "prop:sajonia",
            name: "Sajonia Studios (Demo)",
            code: "DEMO-SAJ",
            address: "Calle Cap. Figari 280",
            city: "Asuncion",
        },
    ];

    let mut prop_ids = Vec::new();
    for p in &properties {
        let id = demo_uuid(&ns, p.key);
        ins(
            pool,
            "properties",
            json!({
                "id": id.to_string(),
                "organization_id": org_id,
                "name": p.name,
                "code": p.code,
                "address_line1": p.address,
                "city": p.city,
                "country_code": "PY",
            }),
        )
        .await?;
        prop_ids.push(id);
    }
    summary.insert(
        "property_ids".into(),
        json!(prop_ids.iter().map(|u| u.to_string()).collect::<Vec<_>>()),
    );

    // ──────────────────────────────────────────
    // 2. Units (15 — 3 per property)
    // ──────────────────────────────────────────
    struct UnitDef {
        key: &'static str,
        code: &'static str,
        name: &'static str,
        bedrooms: &'static str,
        bathrooms: &'static str,
        sqm: &'static str,
        max_guests: &'static str,
        nightly: &'static str,
        cleaning: &'static str,
    }

    let units_per_prop: [&[UnitDef]; 5] = [
        // Villa Morra
        &[
            UnitDef {
                key: "unit:vm:101",
                code: "VM-101",
                name: "Depto 101 – Studio",
                bedrooms: "0",
                bathrooms: "1.0",
                sqm: "35",
                max_guests: "2",
                nightly: "180000",
                cleaning: "60000",
            },
            UnitDef {
                key: "unit:vm:201",
                code: "VM-201",
                name: "Depto 201 – 1BR",
                bedrooms: "1",
                bathrooms: "1.0",
                sqm: "52",
                max_guests: "2",
                nightly: "250000",
                cleaning: "80000",
            },
            UnitDef {
                key: "unit:vm:301",
                code: "VM-301",
                name: "Depto 301 – 2BR",
                bedrooms: "2",
                bathrooms: "2.0",
                sqm: "78",
                max_guests: "4",
                nightly: "380000",
                cleaning: "120000",
            },
        ],
        // Carmelitas
        &[
            UnitDef {
                key: "unit:car:A",
                code: "CAR-A",
                name: "Suite A – 1BR",
                bedrooms: "1",
                bathrooms: "1.0",
                sqm: "45",
                max_guests: "2",
                nightly: "220000",
                cleaning: "70000",
            },
            UnitDef {
                key: "unit:car:B",
                code: "CAR-B",
                name: "Suite B – 2BR",
                bedrooms: "2",
                bathrooms: "1.5",
                sqm: "65",
                max_guests: "4",
                nightly: "340000",
                cleaning: "100000",
            },
            UnitDef {
                key: "unit:car:C",
                code: "CAR-C",
                name: "Suite C – 3BR",
                bedrooms: "3",
                bathrooms: "2.0",
                sqm: "95",
                max_guests: "6",
                nightly: "480000",
                cleaning: "150000",
            },
        ],
        // Manorá
        &[
            UnitDef {
                key: "unit:man:801",
                code: "MAN-801",
                name: "Depto 801 – 1BR (View)",
                bedrooms: "1",
                bathrooms: "1.0",
                sqm: "55",
                max_guests: "2",
                nightly: "300000",
                cleaning: "90000",
            },
            UnitDef {
                key: "unit:man:802",
                code: "MAN-802",
                name: "Depto 802 – 2BR (View)",
                bedrooms: "2",
                bathrooms: "2.0",
                sqm: "82",
                max_guests: "4",
                nightly: "450000",
                cleaning: "130000",
            },
            UnitDef {
                key: "unit:man:PH",
                code: "MAN-PH",
                name: "Penthouse – 3BR",
                bedrooms: "3",
                bathrooms: "3.0",
                sqm: "140",
                max_guests: "6",
                nightly: "750000",
                cleaning: "200000",
            },
        ],
        // Recoleta
        &[
            UnitDef {
                key: "unit:rec:1A",
                code: "REC-1A",
                name: "Casa 1A – 2BR",
                bedrooms: "2",
                bathrooms: "1.5",
                sqm: "70",
                max_guests: "4",
                nightly: "280000",
                cleaning: "90000",
            },
            UnitDef {
                key: "unit:rec:1B",
                code: "REC-1B",
                name: "Casa 1B – 3BR",
                bedrooms: "3",
                bathrooms: "2.0",
                sqm: "100",
                max_guests: "6",
                nightly: "420000",
                cleaning: "130000",
            },
            UnitDef {
                key: "unit:rec:2A",
                code: "REC-2A",
                name: "Casa 2A – 1BR",
                bedrooms: "1",
                bathrooms: "1.0",
                sqm: "40",
                max_guests: "2",
                nightly: "200000",
                cleaning: "65000",
            },
        ],
        // Sajonia
        &[
            UnitDef {
                key: "unit:saj:S1",
                code: "SAJ-S1",
                name: "Studio S1",
                bedrooms: "0",
                bathrooms: "1.0",
                sqm: "28",
                max_guests: "2",
                nightly: "150000",
                cleaning: "50000",
            },
            UnitDef {
                key: "unit:saj:S2",
                code: "SAJ-S2",
                name: "Studio S2",
                bedrooms: "0",
                bathrooms: "1.0",
                sqm: "30",
                max_guests: "2",
                nightly: "160000",
                cleaning: "50000",
            },
            UnitDef {
                key: "unit:saj:1A",
                code: "SAJ-1A",
                name: "Depto 1A – 1BR",
                bedrooms: "1",
                bathrooms: "1.0",
                sqm: "45",
                max_guests: "2",
                nightly: "210000",
                cleaning: "70000",
            },
        ],
    ];

    // Flat list of (property_index, unit_id) for use by leases and marketplace.
    let mut all_units: Vec<(usize, Uuid)> = Vec::new();

    for (pi, units) in units_per_prop.iter().enumerate() {
        for u in *units {
            let uid = demo_uuid(&ns, u.key);
            ins(
                pool,
                "units",
                json!({
                    "id": uid.to_string(),
                    "organization_id": org_id,
                    "property_id": prop_ids[pi].to_string(),
                    "code": u.code,
                    "name": u.name,
                    "max_guests": u.max_guests,
                    "bedrooms": u.bedrooms,
                    "bathrooms": u.bathrooms,
                    "square_meters": u.sqm,
                    "default_nightly_rate": u.nightly,
                    "default_cleaning_fee": u.cleaning,
                    "currency": "PYG",
                    "is_active": "true",
                }),
            )
            .await?;
            all_units.push((pi, uid));
        }
    }
    summary.insert("unit_count".into(), json!(all_units.len()));

    // ──────────────────────────────────────────
    // 3. Integrations (STR: Airbnb + Booking.com)
    // ──────────────────────────────────────────
    let str_listing_a = demo_uuid(&ns, "integration:airbnb:vm-201");
    let str_listing_b = demo_uuid(&ns, "integration:booking:vm-301");
    ins(
        pool,
        "integrations",
        json!({
            "id": str_listing_a.to_string(),
            "organization_id": org_id,
            "unit_id": all_units[1].1.to_string(), // VM-201
            "kind": "airbnb",
            "channel_name": "Airbnb (Demo)",
            "external_listing_id": "airbnb-demo-VM-201",
            "public_name": "VM 201 – Cozy 1BR (Airbnb Demo)",
            "is_active": "true",
        }),
    )
    .await?;
    ins(
        pool,
        "integrations",
        json!({
            "id": str_listing_b.to_string(),
            "organization_id": org_id,
            "unit_id": all_units[2].1.to_string(), // VM-301
            "kind": "bookingcom",
            "channel_name": "Booking.com (Demo)",
            "external_listing_id": "booking-demo-VM-301",
            "public_name": "VM 301 – Spacious 2BR (Booking Demo)",
            "is_active": "true",
        }),
    )
    .await?;

    // ──────────────────────────────────────────
    // 5. Guests (4)
    // ──────────────────────────────────────────
    struct GuestDef {
        key: &'static str,
        name: &'static str,
        email: &'static str,
        phone: &'static str,
        lang: &'static str,
    }

    let guests = [
        GuestDef {
            key: "guest:ana-perez",
            name: "Ana Perez (Demo)",
            email: "ana.perez@example.com",
            phone: "+595981000001",
            lang: "es",
        },
        GuestDef {
            key: "guest:carlos-lopez",
            name: "Carlos López (Demo)",
            email: "carlos.lopez@example.com",
            phone: "+595981000002",
            lang: "es",
        },
        GuestDef {
            key: "guest:maria-gimenez",
            name: "María Giménez (Demo)",
            email: "maria.gimenez@example.com",
            phone: "+595981000003",
            lang: "es",
        },
        GuestDef {
            key: "guest:john-smith",
            name: "John Smith (Demo)",
            email: "john.smith@example.com",
            phone: "+15551234567",
            lang: "en",
        },
    ];

    let mut guest_ids = Vec::new();
    for g in &guests {
        let gid = demo_uuid(&ns, g.key);
        ins(
            pool,
            "guests",
            json!({
                "id": gid.to_string(),
                "organization_id": org_id,
                "full_name": g.name,
                "email": g.email,
                "phone_e164": g.phone,
                "preferred_language": g.lang,
            }),
        )
        .await?;
        guest_ids.push(gid);
    }

    // ──────────────────────────────────────────
    // 6. Reservations (3 — STR bookings)
    // ──────────────────────────────────────────
    let res1 = demo_uuid(&ns, "res:ana:vm-201");
    let check_in1 = today + chrono::Duration::days(7);
    let check_out1 = today + chrono::Duration::days(10);
    ins(
        pool,
        "reservations",
        json!({
            "id": res1.to_string(),
            "organization_id": org_id,
            "unit_id": all_units[1].1.to_string(),
            "integration_id": str_listing_a.to_string(),
            "guest_id": guest_ids[0].to_string(),
            "status": "confirmed",
            "source": "manual",
            "check_in_date": d(check_in1),
            "check_out_date": d(check_out1),
            "currency": "PYG",
            "nightly_rate": "250000",
            "cleaning_fee": "80000",
            "total_amount": "830000",
            "owner_payout_estimate": "830000",
        }),
    )
    .await?;

    let res2 = demo_uuid(&ns, "res:john:vm-301");
    let check_in2 = today + chrono::Duration::days(14);
    let check_out2 = today + chrono::Duration::days(21);
    ins(
        pool,
        "reservations",
        json!({
            "id": res2.to_string(),
            "organization_id": org_id,
            "unit_id": all_units[2].1.to_string(),
            "integration_id": str_listing_b.to_string(),
            "guest_id": guest_ids[3].to_string(),
            "status": "confirmed",
            "source": "manual",
            "check_in_date": d(check_in2),
            "check_out_date": d(check_out2),
            "currency": "PYG",
            "nightly_rate": "380000",
            "cleaning_fee": "120000",
            "total_amount": "2780000",
            "owner_payout_estimate": "2780000",
        }),
    )
    .await?;

    let res3 = demo_uuid(&ns, "res:carlos:vm-201:past");
    let check_in3 = today - chrono::Duration::days(10);
    let check_out3 = today - chrono::Duration::days(7);
    ins(
        pool,
        "reservations",
        json!({
            "id": res3.to_string(),
            "organization_id": org_id,
            "unit_id": all_units[1].1.to_string(),
            "integration_id": str_listing_a.to_string(),
            "guest_id": guest_ids[1].to_string(),
            "status": "checked_out",
            "source": "manual",
            "check_in_date": d(check_in3),
            "check_out_date": d(check_out3),
            "currency": "PYG",
            "nightly_rate": "250000",
            "cleaning_fee": "80000",
            "total_amount": "830000",
            "owner_payout_estimate": "830000",
        }),
    )
    .await?;

    summary.insert("reservation_count".into(), json!(3));

    // ──────────────────────────────────────────
    // 7. Calendar block
    // ──────────────────────────────────────────
    let block_id = demo_uuid(&ns, "block:maint:vm-201");
    let maint_start = today + chrono::Duration::days(25);
    let maint_end = today + chrono::Duration::days(27);
    ins(
        pool,
        "calendar_blocks",
        json!({
            "id": block_id.to_string(),
            "organization_id": org_id,
            "unit_id": all_units[1].1.to_string(),
            "source": "manual",
            "starts_on": d(maint_start),
            "ends_on": d(maint_end),
            "reason": "Plumbing maintenance (Demo)",
        }),
    )
    .await?;

    // ──────────────────────────────────────────
    // 8. Tasks (3 — cleaning, maintenance, inspection)
    // ──────────────────────────────────────────
    let task1 = demo_uuid(&ns, "task:cleaning:vm-201");
    ins(
        pool,
        "tasks",
        json!({
            "id": task1.to_string(),
            "organization_id": org_id,
            "property_id": prop_ids[0].to_string(),
            "unit_id": all_units[1].1.to_string(),
            "reservation_id": res1.to_string(),
            "type": "cleaning",
            "status": "todo",
            "priority": "high",
            "title": "Turnover cleaning VM-201 (Demo)",
            "description": "Clean and prepare unit for next guest.",
        }),
    )
    .await?;
    ins(
        pool,
        "task_items",
        json!({
            "id": demo_uuid(&ns, "ti:clean:1").to_string(),
            "task_id": task1.to_string(),
            "sort_order": "1",
            "label": "Replace linens + towels",
            "is_required": "true",
            "is_completed": "false",
        }),
    )
    .await?;
    ins(
        pool,
        "task_items",
        json!({
            "id": demo_uuid(&ns, "ti:clean:2").to_string(),
            "task_id": task1.to_string(),
            "sort_order": "2",
            "label": "Restock water + coffee",
            "is_required": "true",
            "is_completed": "false",
        }),
    )
    .await?;

    let task2 = demo_uuid(&ns, "task:maint:car-B");
    ins(
        pool,
        "tasks",
        json!({
            "id": task2.to_string(),
            "organization_id": org_id,
            "property_id": prop_ids[1].to_string(),
            "unit_id": all_units[4].1.to_string(), // CAR-B
            "type": "maintenance",
            "status": "in_progress",
            "priority": "medium",
            "title": "Fix leaky faucet in CAR-B (Demo)",
            "description": "Kitchen faucet has a slow drip. Plumber scheduled.",
        }),
    )
    .await?;

    let task3 = demo_uuid(&ns, "task:inspect:rec-1A");
    ins(
        pool,
        "tasks",
        json!({
            "id": task3.to_string(),
            "organization_id": org_id,
            "property_id": prop_ids[3].to_string(),
            "unit_id": all_units[9].1.to_string(), // REC-1A
            "type": "inspection",
            "status": "todo",
            "priority": "low",
            "title": "Pre-lease inspection REC-1A (Demo)",
            "description": "Inspect unit condition before new tenant moves in.",
        }),
    )
    .await?;

    // ──────────────────────────────────────────
    // 9. Leases (10 — LTR across properties)
    // ──────────────────────────────────────────
    struct LeaseDef {
        key: &'static str,
        unit_idx: usize,
        tenant: &'static str,
        email: &'static str,
        phone: &'static str,
        status: &'static str,
        months_ago_start: u32,
        duration_months: Option<u32>,
        rent: &'static str,
        deposit: &'static str,
        service_fee: &'static str,
    }

    let leases = [
        LeaseDef {
            key: "lease:vm-101:gonzalez",
            unit_idx: 0,
            tenant: "Roberto González (Demo)",
            email: "roberto.gonzalez@example.com",
            phone: "+595982000001",
            status: "active",
            months_ago_start: 6,
            duration_months: Some(12),
            rent: "1800000",
            deposit: "3600000",
            service_fee: "180000",
        },
        LeaseDef {
            key: "lease:car-A:martinez",
            unit_idx: 3,
            tenant: "Laura Martínez (Demo)",
            email: "laura.martinez@example.com",
            phone: "+595982000002",
            status: "active",
            months_ago_start: 3,
            duration_months: Some(12),
            rent: "2200000",
            deposit: "4400000",
            service_fee: "220000",
        },
        LeaseDef {
            key: "lease:car-B:rojas",
            unit_idx: 4,
            tenant: "Diego Rojas (Demo)",
            email: "diego.rojas@example.com",
            phone: "+595982000003",
            status: "active",
            months_ago_start: 10,
            duration_months: Some(24),
            rent: "3400000",
            deposit: "6800000",
            service_fee: "340000",
        },
        LeaseDef {
            key: "lease:car-C:benitez",
            unit_idx: 5,
            tenant: "Familia Benítez (Demo)",
            email: "benitez.fam@example.com",
            phone: "+595982000004",
            status: "active",
            months_ago_start: 1,
            duration_months: Some(12),
            rent: "4800000",
            deposit: "9600000",
            service_fee: "480000",
        },
        LeaseDef {
            key: "lease:man-801:duarte",
            unit_idx: 6,
            tenant: "Sofia Duarte (Demo)",
            email: "sofia.duarte@example.com",
            phone: "+595982000005",
            status: "active",
            months_ago_start: 8,
            duration_months: Some(12),
            rent: "3000000",
            deposit: "6000000",
            service_fee: "300000",
        },
        LeaseDef {
            key: "lease:man-802:villalba",
            unit_idx: 7,
            tenant: "Pablo Villalba (Demo)",
            email: "pablo.villalba@example.com",
            phone: "+595982000006",
            status: "delinquent",
            months_ago_start: 5,
            duration_months: Some(12),
            rent: "4500000",
            deposit: "9000000",
            service_fee: "450000",
        },
        LeaseDef {
            key: "lease:rec-1A:acosta",
            unit_idx: 9,
            tenant: "Carmen Acosta (Demo)",
            email: "carmen.acosta@example.com",
            phone: "+595982000007",
            status: "draft",
            months_ago_start: 0,
            duration_months: Some(12),
            rent: "2800000",
            deposit: "5600000",
            service_fee: "280000",
        },
        LeaseDef {
            key: "lease:rec-2A:fernandez",
            unit_idx: 11,
            tenant: "Miguel Fernández (Demo)",
            email: "miguel.fernandez@example.com",
            phone: "+595982000008",
            status: "active",
            months_ago_start: 4,
            duration_months: Some(6),
            rent: "2000000",
            deposit: "4000000",
            service_fee: "200000",
        },
        LeaseDef {
            key: "lease:saj-S1:torres",
            unit_idx: 12,
            tenant: "Valentina Torres (Demo)",
            email: "valentina.torres@example.com",
            phone: "+595982000009",
            status: "active",
            months_ago_start: 2,
            duration_months: Some(12),
            rent: "1500000",
            deposit: "3000000",
            service_fee: "150000",
        },
        LeaseDef {
            key: "lease:saj-1A:mendoza",
            unit_idx: 14,
            tenant: "Andrés Mendoza (Demo)",
            email: "andres.mendoza@example.com",
            phone: "+595982000010",
            status: "terminated",
            months_ago_start: 11,
            duration_months: Some(12),
            rent: "2100000",
            deposit: "4200000",
            service_fee: "210000",
        },
    ];

    let mut lease_ids = Vec::new();
    for l in &leases {
        let lid = demo_uuid(&ns, l.key);
        let starts_on = if l.months_ago_start > 0 {
            today
                .checked_sub_months(Months::new(l.months_ago_start))
                .unwrap_or(today)
        } else {
            today + chrono::Duration::days(15)
        };
        let ends_on = l.duration_months.map(|dm| {
            starts_on
                .checked_add_months(Months::new(dm))
                .unwrap_or(starts_on)
        });
        let (prop_idx, unit_id) = all_units[l.unit_idx];
        let rent: f64 = l.rent.parse().unwrap_or(0.0);
        let svc: f64 = l.service_fee.parse().unwrap_or(0.0);
        let dep: f64 = l.deposit.parse().unwrap_or(0.0);
        let iva = (rent * 0.10).round();
        let total_move_in = rent + svc + dep + iva;
        let monthly_recurring = rent + svc + iva;

        ins(
            pool,
            "leases",
            json!({
                "id": lid.to_string(),
                "organization_id": org_id,
                "property_id": prop_ids[prop_idx].to_string(),
                "unit_id": unit_id.to_string(),
                "tenant_full_name": l.tenant,
                "tenant_email": l.email,
                "tenant_phone_e164": l.phone,
                "lease_status": l.status,
                "starts_on": d(starts_on),
                "ends_on": ends_on.map(d),
                "currency": "PYG",
                "monthly_rent": l.rent,
                "service_fee_flat": l.service_fee,
                "security_deposit": l.deposit,
                "tax_iva": iva.to_string(),
                "total_move_in": total_move_in.to_string(),
                "monthly_recurring_total": monthly_recurring.to_string(),
            }),
        )
        .await?;
        lease_ids.push((lid, l.status, l.months_ago_start, monthly_recurring));
    }
    summary.insert("lease_count".into(), json!(lease_ids.len()));

    // ──────────────────────────────────────────
    // 10. Collection records (rent schedule for active leases)
    // ──────────────────────────────────────────
    let mut collection_count = 0u32;
    for (lid, status, months_ago, monthly) in &lease_ids {
        if *status != "active" && *status != "delinquent" {
            continue;
        }
        // Generate collection records for each past month plus current + next.
        let num_past = (*months_ago).min(6); // Cap at 6 months of history.
        for m in 0..=(num_past + 1) {
            let cr_id = demo_uuid(&ns, &format!("coll:{}:{}", lid, m));
            let due = if m <= num_past {
                today
                    .checked_sub_months(Months::new(num_past - m))
                    .unwrap_or(today)
                    .with_day(1)
                    .unwrap_or(today)
            } else {
                today
                    .checked_add_months(Months::new(1))
                    .unwrap_or(today)
                    .with_day(1)
                    .unwrap_or(today)
            };

            let (coll_status, paid_at) = if m < num_past {
                // Past months — paid (unless delinquent with last 2 months unpaid).
                if *status == "delinquent" && m >= num_past.saturating_sub(2) {
                    ("late", None)
                } else {
                    ("paid", Some(d(due + chrono::Duration::days(3))))
                }
            } else if m == num_past {
                // Current month.
                if *status == "delinquent" {
                    ("late", None)
                } else {
                    ("pending", None)
                }
            } else {
                // Next month — scheduled.
                ("scheduled", None)
            };

            let mut rec = json!({
                "id": cr_id.to_string(),
                "organization_id": org_id,
                "lease_id": lid.to_string(),
                "due_date": d(due),
                "amount": monthly.to_string(),
                "currency": "PYG",
                "status": coll_status,
            });
            if let Some(pa) = paid_at {
                rec["paid_at"] = json!(pa);
                rec["payment_method"] = json!("bank_transfer");
            }
            ins(pool, "collection_records", rec).await?;
            collection_count += 1;
        }
    }
    summary.insert("collection_record_count".into(), json!(collection_count));

    // ──────────────────────────────────────────
    // 11. Marketplace listings (5 — published LTR units)
    // ──────────────────────────────────────────
    #[allow(dead_code)]
    struct MktDef {
        key: &'static str,
        slug: &'static str,
        unit_idx: usize,
        title: &'static str,
        summary: &'static str,
        description: &'static str,
        neighborhood: &'static str,
        bedrooms: i32,
        bathrooms: &'static str,
        sqm: &'static str,
        property_type: &'static str,
        furnished: bool,
        pet_policy: &'static str,
        parking: i32,
        min_lease: i32,
        rent: &'static str,
        maintenance: &'static str,
    }

    let mkt_listings = [
        MktDef {
            key: "mkt:vm-301", slug: "demo-villa-morra-2br-penthouse", unit_idx: 2,
            title: "Moderno 2BR en Villa Morra con Piscina",
            summary: "Departamento de 2 habitaciones con amenidades premium en el corazón de Villa Morra.",
            description: "Hermoso departamento completamente amoblado con 2 dormitorios y 2 baños. Incluye piscina, gimnasio, seguridad 24hs, y estacionamiento. Ubicado a 2 cuadras del Shopping del Sol. Ideal para profesionales o parejas.",
            neighborhood: "Villa Morra",
            bedrooms: 2, bathrooms: "2.0", sqm: "78", property_type: "apartment", furnished: true, pet_policy: "small_only", parking: 1, min_lease: 12,
            rent: "3800000", maintenance: "350000",
        },
        MktDef {
            key: "mkt:car-C", slug: "demo-carmelitas-3br-family", unit_idx: 5,
            title: "Amplio 3BR en Carmelitas – Ideal Familia",
            summary: "Espacioso departamento de 3 dormitorios en zona residencial tranquila.",
            description: "Departamento de 95m² con 3 dormitorios, 2 baños completos, cocina equipada y lavadero. Edificio con portería, parrilla común y jardín. A 3 cuadras del Paseo Carmelitas. Mascotas bienvenidas.",
            neighborhood: "Carmelitas",
            bedrooms: 3, bathrooms: "2.0", sqm: "95", property_type: "apartment", furnished: false, pet_policy: "allowed", parking: 1, min_lease: 12,
            rent: "4800000", maintenance: "450000",
        },
        MktDef {
            key: "mkt:man-801", slug: "demo-manora-1br-skyline-view", unit_idx: 6,
            title: "1BR con Vista Panorámica – Manorá Tower",
            summary: "Departamento de 1 dormitorio en piso alto con vista a la ciudad.",
            description: "Elegante departamento en el piso 8 de Manorá Tower. Vista panorámica al skyline de Asunción. Completamente amoblado con electrodomésticos nuevos. Edificio con piscina infinity, gym, sauna, coworking y seguridad 24hs.",
            neighborhood: "Aviadores del Chaco",
            bedrooms: 1, bathrooms: "1.0", sqm: "55", property_type: "apartment", furnished: true, pet_policy: "not_allowed", parking: 1, min_lease: 6,
            rent: "3000000", maintenance: "500000",
        },
        MktDef {
            key: "mkt:rec-1B", slug: "demo-recoleta-3br-house", unit_idx: 10,
            title: "Casa 3BR en Recoleta con Jardín",
            summary: "Casa independiente con jardín privado en barrio residencial.",
            description: "Casa de 100m² con 3 dormitorios, 2 baños, sala, comedor, cocina amplia y jardín privado. Barrio tranquilo y seguro, ideal para familias. Incluye estacionamiento para 2 vehículos. Sin muebles.",
            neighborhood: "Recoleta",
            bedrooms: 3, bathrooms: "2.0", sqm: "100", property_type: "house", furnished: false, pet_policy: "allowed", parking: 2, min_lease: 12,
            rent: "4200000", maintenance: "200000",
        },
        MktDef {
            key: "mkt:saj-S2", slug: "demo-sajonia-studio-affordable", unit_idx: 13,
            title: "Studio Económico en Sajonia – Todo Incluido",
            summary: "Studio compacto y económico ideal para estudiantes o jóvenes profesionales.",
            description: "Studio de 30m² completamente amoblado con cocina integrada, baño privado y balcón. Servicios básicos incluidos (agua, electricidad hasta 300kWh, WiFi 100Mbps). Zona céntrica con fácil acceso a transporte público.",
            neighborhood: "Sajonia",
            bedrooms: 0, bathrooms: "1.0", sqm: "30", property_type: "studio", furnished: true, pet_policy: "not_allowed", parking: 0, min_lease: 3,
            rent: "1600000", maintenance: "0",
        },
    ];

    let amenity_sets: [&[&str]; 5] = [
        &[
            "wifi",
            "pool",
            "gym",
            "ac",
            "parking",
            "security_24h",
            "washer",
            "elevator",
        ],
        &[
            "wifi",
            "ac",
            "parking",
            "security_24h",
            "washer",
            "bbq_area",
            "garden",
            "elevator",
        ],
        &[
            "wifi",
            "pool",
            "gym",
            "ac",
            "parking",
            "security_24h",
            "coworking",
            "sauna",
            "elevator",
        ],
        &["wifi", "ac", "parking", "garden", "washer", "dryer"],
        &["wifi", "ac", "furnished", "utilities_included"],
    ];

    let mut mkt_ids = Vec::new();
    for (i, ml) in mkt_listings.iter().enumerate() {
        let mid = demo_uuid(&ns, ml.key);
        let (prop_idx, unit_id) = all_units[ml.unit_idx];
        let amenities: Vec<&str> = amenity_sets[i].to_vec();
        let avail_from = today + chrono::Duration::days(15 + (i as i64) * 10);

        ins(
            pool,
            "listings",
            json!({
                "id": mid.to_string(),
                "organization_id": org_id,
                "property_id": prop_ids[prop_idx].to_string(),
                "unit_id": unit_id.to_string(),
                "public_slug": ml.slug,
                "title": ml.title,
                "summary": ml.summary,
                "description": ml.description,
                "neighborhood": ml.neighborhood,
                "city": "Asuncion",
                "country_code": "PY",
                "currency": "PYG",
                "is_published": true,
                "published_at": Utc::now().to_rfc3339(),
                "bedrooms": ml.bedrooms,
                "bathrooms": ml.bathrooms,
                "square_meters": ml.sqm,
                "property_type": ml.property_type,
                "furnished": ml.furnished,
                "pet_policy": ml.pet_policy,
                "parking_spaces": ml.parking,
                "minimum_lease_months": ml.min_lease,
                "available_from": d(avail_from),
                "amenities": json!(amenities),
                "maintenance_fee": ml.maintenance,
            }),
        )
        .await?;
        mkt_ids.push(mid);
    }
    summary.insert("listing_count".into(), json!(mkt_ids.len()));
    summary.insert(
        "listing_slugs".into(),
        json!(mkt_listings.iter().map(|ml| ml.slug).collect::<Vec<_>>()),
    );

    // ──────────────────────────────────────────
    // 12. Expenses (6 — varied categories)
    // ──────────────────────────────────────────
    struct ExpDef {
        key: &'static str,
        prop_idx: usize,
        category: &'static str,
        vendor: &'static str,
        amount: &'static str,
        days_ago: i64,
        notes: &'static str,
    }

    let expenses = [
        ExpDef {
            key: "exp:supplies:vm",
            prop_idx: 0,
            category: "supplies",
            vendor: "Stock (Demo)",
            amount: "95000",
            days_ago: 3,
            notes: "Cleaning supplies for turnover.",
        },
        ExpDef {
            key: "exp:repair:car",
            prop_idx: 1,
            category: "repair",
            vendor: "Plomero Asunción (Demo)",
            amount: "350000",
            days_ago: 5,
            notes: "Kitchen faucet replacement in CAR-B.",
        },
        ExpDef {
            key: "exp:utilities:man",
            prop_idx: 2,
            category: "utilities",
            vendor: "ANDE (Demo)",
            amount: "520000",
            days_ago: 15,
            notes: "Electricity bill — common areas, January.",
        },
        ExpDef {
            key: "exp:insurance:rec",
            prop_idx: 3,
            category: "insurance",
            vendor: "Aseguradora Tajy (Demo)",
            amount: "1200000",
            days_ago: 30,
            notes: "Annual property insurance renewal.",
        },
        ExpDef {
            key: "exp:cleaning:saj",
            prop_idx: 4,
            category: "cleaning",
            vendor: "Limpieza Express (Demo)",
            amount: "180000",
            days_ago: 7,
            notes: "Deep cleaning of common areas.",
        },
        ExpDef {
            key: "exp:tax:vm",
            prop_idx: 0,
            category: "tax",
            vendor: "SET Paraguay (Demo)",
            amount: "890000",
            days_ago: 20,
            notes: "IVA payment for January.",
        },
    ];

    for e in &expenses {
        let eid = demo_uuid(&ns, e.key);
        let exp_date = today - chrono::Duration::days(e.days_ago);
        ins(
            pool,
            "expenses",
            json!({
                "id": eid.to_string(),
                "organization_id": org_id,
                "property_id": prop_ids[e.prop_idx].to_string(),
                "category": e.category,
                "vendor_name": e.vendor,
                "expense_date": d(exp_date),
                "amount": e.amount,
                "currency": "PYG",
                "payment_method": "bank_transfer",
                "notes": e.notes,
            }),
        )
        .await?;
    }
    summary.insert("expense_count".into(), json!(expenses.len()));

    // ──────────────────────────────────────────
    // 13. Owner statements (2)
    // ──────────────────────────────────────────
    let stmt1 = demo_uuid(&ns, "stmt:vm:current");
    ins(
        pool,
        "owner_statements",
        json!({
            "id": stmt1.to_string(),
            "organization_id": org_id,
            "property_id": prop_ids[0].to_string(),
            "period_start": d(period_start),
            "period_end": d(today),
            "currency": "PYG",
            "gross_revenue": "2630000",
            "operating_expenses": "985000",
            "net_payout": "1645000",
            "status": "draft",
        }),
    )
    .await?;

    let stmt2 = demo_uuid(&ns, "stmt:car:current");
    ins(
        pool,
        "owner_statements",
        json!({
            "id": stmt2.to_string(),
            "organization_id": org_id,
            "property_id": prop_ids[1].to_string(),
            "period_start": d(period_start),
            "period_end": d(today),
            "currency": "PYG",
            "gross_revenue": "10400000",
            "operating_expenses": "350000",
            "net_payout": "10050000",
            "status": "sent",
        }),
    )
    .await?;

    // ──────────────────────────────────────────
    // 14. Maintenance requests (4)
    // ──────────────────────────────────────────
    #[allow(dead_code)]
    struct MaintDef {
        key: &'static str,
        prop_idx: usize,
        unit_idx: usize,
        lease_key: &'static str,
        category: &'static str,
        urgency: &'static str,
        status: &'static str,
        title: &'static str,
        desc: &'static str,
        submitter_name: &'static str,
        submitter_phone: &'static str,
    }

    let maint_requests = [
        MaintDef {
            key: "maint:car-B:faucet", prop_idx: 1, unit_idx: 4,
            lease_key: "lease:car-B:rojas", category: "plumbing", urgency: "medium",
            status: "in_progress", title: "Grifo de cocina gotea",
            desc: "El grifo de la cocina tiene un goteo constante. Se necesita reemplazo.",
            submitter_name: "Diego Rojas", submitter_phone: "+595982000003",
        },
        MaintDef {
            key: "maint:man-802:ac", prop_idx: 2, unit_idx: 7,
            lease_key: "lease:man-802:villalba", category: "appliance", urgency: "high",
            status: "submitted", title: "Aire acondicionado no enfría",
            desc: "El A/C del dormitorio principal no enfría. Hace ruido pero no baja la temperatura.",
            submitter_name: "Pablo Villalba", submitter_phone: "+595982000006",
        },
        MaintDef {
            key: "maint:saj-S1:electrical", prop_idx: 4, unit_idx: 12,
            lease_key: "lease:saj-S1:torres", category: "electrical", urgency: "low",
            status: "completed", title: "Tomacorriente no funciona",
            desc: "El tomacorriente al lado de la cama no funciona. Los demás sí funcionan.",
            submitter_name: "Valentina Torres", submitter_phone: "+595982000009",
        },
        MaintDef {
            key: "maint:rec-2A:pest", prop_idx: 3, unit_idx: 11,
            lease_key: "lease:rec-2A:fernandez", category: "pest", urgency: "medium",
            status: "scheduled", title: "Hormigas en la cocina",
            desc: "Se ven hormigas entrando por debajo de la puerta de la cocina. Necesita fumigación.",
            submitter_name: "Miguel Fernández", submitter_phone: "+595982000008",
        },
    ];

    for mr in &maint_requests {
        let mid = demo_uuid(&ns, mr.key);
        let lease_id = demo_uuid(&ns, mr.lease_key);
        let (prop_idx, unit_id) = all_units[mr.unit_idx];
        ins(
            pool,
            "maintenance_requests",
            json!({
                "id": mid.to_string(),
                "organization_id": org_id,
                "lease_id": lease_id.to_string(),
                "property_id": prop_ids[prop_idx].to_string(),
                "unit_id": unit_id.to_string(),
                "category": mr.category,
                "title": mr.title,
                "description": mr.desc,
                "urgency": mr.urgency,
                "status": mr.status,
                "submitted_by_name": mr.submitter_name,
                "submitted_by_phone": mr.submitter_phone,
            }),
        )
        .await?;
    }
    summary.insert(
        "maintenance_request_count".into(),
        json!(maint_requests.len()),
    );

    // ──────────────────────────────────────────
    // 15. Workflow rules (5 default automations)
    // ──────────────────────────────────────────
    let workflow_defs = [
        (
            "wf:res-confirmed-task",
            "Auto-task on reservation confirmed",
            "reservation_confirmed",
            "create_task",
            json!({"task_type": "cleaning", "priority": "high", "title_template": "Turnover cleaning for {{unit_code}}"}),
            0,
        ),
        (
            "wf:checkout-clean",
            "Auto-cleaning task on checkout",
            "checked_out",
            "create_task",
            json!({"task_type": "cleaning", "priority": "high", "title_template": "Post-checkout cleaning {{unit_code}}"}),
            0,
        ),
        (
            "wf:overdue-notify",
            "WhatsApp on collection overdue",
            "collection_overdue",
            "send_notification",
            json!({"channel": "whatsapp", "template": "rent_overdue"}),
            60,
        ),
        (
            "wf:app-received-notify",
            "Email on application received",
            "application_received",
            "send_notification",
            json!({"channel": "email", "template": "new_application"}),
            0,
        ),
        (
            "wf:maint-task",
            "Auto-task on maintenance request",
            "maintenance_submitted",
            "create_task",
            json!({"task_type": "maintenance", "priority": "medium", "title_template": "Maintenance: {{request_title}}"}),
            0,
        ),
    ];

    for (key, name, trigger, action, config, delay) in &workflow_defs {
        let wid = demo_uuid(&ns, key);
        ins(
            pool,
            "workflow_rules",
            json!({
                "id": wid.to_string(),
                "organization_id": org_id,
                "name": name,
                "trigger_event": trigger,
                "action_type": action,
                "action_config": config,
                "delay_minutes": delay,
                "is_active": true,
            }),
        )
        .await?;
    }
    summary.insert("workflow_rule_count".into(), json!(workflow_defs.len()));

    // ──────────────────────────────────────────
    // 16. Notification rules (4 default triggers)
    // ──────────────────────────────────────────
    let notif_defs = [
        ("notif:rent-due-3d", "rent_due_3d", "whatsapp"),
        ("notif:rent-due-1d", "rent_due_1d", "whatsapp"),
        ("notif:rent-overdue-1d", "rent_overdue_1d", "whatsapp"),
        ("notif:app-received", "application_received", "email"),
    ];

    for (key, trigger, channel) in &notif_defs {
        let nid = demo_uuid(&ns, key);
        ins(
            pool,
            "notification_rules",
            json!({
                "id": nid.to_string(),
                "organization_id": org_id,
                "trigger_event": trigger,
                "channel": channel,
                "is_active": true,
            }),
        )
        .await?;
    }
    summary.insert("notification_rule_count".into(), json!(notif_defs.len()));

    // ──────────────────────────────────────────
    // 17. Message templates (WhatsApp rent cycle)
    // ──────────────────────────────────────────
    let msg_templates = [
        (
            "tpl:rent-reminder-3d",
            "rent_reminder_3d",
            "Recordatorio de pago (3 días)",
            "whatsapp",
            "es-PY",
            "Hola {{tenant_name}} 👋\n\nTe recordamos que tu pago de alquiler de {{amount}} vence el {{due_date}}.\n\nPuedes ver los detalles y realizar tu pago en:\n{{payment_link}}\n\nGracias por tu puntualidad.\n— Puerta Abierta",
        ),
        (
            "tpl:rent-reminder-1d",
            "rent_reminder_1d",
            "Recordatorio de pago (1 día)",
            "whatsapp",
            "es-PY",
            "Hola {{tenant_name}},\n\nTu pago de {{amount}} vence mañana ({{due_date}}).\n\nSi ya realizaste el pago, por favor envía tu comprobante.\n{{payment_link}}\n\n— Puerta Abierta",
        ),
        (
            "tpl:rent-due-today",
            "rent_due_today",
            "Pago vence hoy",
            "whatsapp",
            "es-PY",
            "⚠️ {{tenant_name}}, hoy vence tu pago de alquiler de {{amount}}.\n\nPor favor realiza tu pago hoy para evitar recargos.\n{{payment_link}}\n\n— Puerta Abierta",
        ),
        (
            "tpl:rent-late",
            "rent_late_notice",
            "Aviso de pago atrasado",
            "whatsapp",
            "es-PY",
            "🔴 {{tenant_name}}, tu pago de {{amount}} (vencimiento: {{due_date}}) está atrasado.\n\nPor favor regulariza tu situación lo antes posible.\n{{payment_link}}\n\nSi ya realizaste el pago, envía tu comprobante.\n— Puerta Abierta",
        ),
        (
            "tpl:payment-confirmed",
            "payment_confirmed",
            "Confirmación de pago",
            "whatsapp",
            "es-PY",
            "✅ {{tenant_name}}, tu pago de {{amount}} ha sido confirmado.\n\nGracias por tu puntualidad.\n— Puerta Abierta",
        ),
        (
            "tpl:maintenance-update",
            "maintenance_update",
            "Actualización de mantenimiento",
            "whatsapp",
            "es-PY",
            "🔧 Hola {{tenant_name}},\n\nTu solicitud de mantenimiento \"{{request_title}}\" ha sido actualizada.\nEstado: {{status}}\n\n— Puerta Abierta",
        ),
    ];

    for (key, template_key, name, channel, lang, body) in &msg_templates {
        let tid = demo_uuid(&ns, key);
        ins(
            pool,
            "message_templates",
            json!({
                "id": tid.to_string(),
                "organization_id": org_id,
                "template_key": template_key,
                "name": name,
                "channel": channel,
                "language_code": lang,
                "body": body,
                "variables": ["tenant_name", "amount", "due_date", "payment_link"],
            }),
        )
        .await?;
    }
    summary.insert("message_template_count".into(), json!(msg_templates.len()));

    // ──────────────────────────────────────────
    // 18. Pricing template (transparent fee breakdown)
    // ──────────────────────────────────────────
    let pt_id = demo_uuid(&ns, "pricing:standard-ltr");
    ins(
        pool,
        "pricing_templates",
        json!({
            "id": pt_id.to_string(),
            "organization_id": org_id,
            "name": "Alquiler Estándar Paraguay",
            "description": "Desglose transparente de costos para alquiler a largo plazo en Paraguay.",
            "is_active": true,
            "currency": "PYG",
        }),
    )
    .await?;

    let fee_lines = [
        ("Alquiler mensual", "rent", "100", true),
        ("Comisión de servicio (10%)", "service_fee", "10", true),
        ("IVA (10% sobre alquiler)", "tax", "10", true),
        ("Depósito de garantía (2 meses)", "security_deposit", "200", false),
        ("Garantía inmobiliaria (1 mes)", "guarantee_fee", "100", false),
    ];

    for (i, (label, fee_type, pct, is_recurring)) in fee_lines.iter().enumerate() {
        let fl_id = demo_uuid(&ns, &format!("pricing:line:{i}"));
        ins(
            pool,
            "pricing_template_lines",
            json!({
                "id": fl_id.to_string(),
                "pricing_template_id": pt_id.to_string(),
                "fee_type": fee_type,
                "label": label,
                "amount": 0,
                "percentage_of_rent": pct.parse::<f64>().unwrap_or(0.0),
                "is_recurring": is_recurring,
                "sort_order": i + 1,
            }),
        )
        .await?;
    }
    summary.insert("pricing_template_count".into(), json!(1));

    // ──────────────────────────────────────────
    // Done
    // ──────────────────────────────────────────
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "ok": true,
            "organization_id": org_id,
            "created": Value::Object(summary),
        })),
    ))
}

fn db_pool(state: &AppState) -> AppResult<&sqlx::PgPool> {
    state.db_pool.as_ref().ok_or_else(|| {
        AppError::Dependency(
            "Supabase database is not configured. Set SUPABASE_DB_URL or DATABASE_URL.".to_string(),
        )
    })
}
