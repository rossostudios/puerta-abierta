/// Auto-categorize an expense based on vendor name/description keyword matching.
///
/// Rules-based categorization:
/// - Vendor keywords ("limpieza" → cleaning, "ferreteria" → maintenance, etc.)
/// - Amount-based hints for uncategorized entries
///
/// Returns `None` if no match is found.
pub fn auto_categorize(vendor: &str, description: &str, amount: f64) -> Option<&'static str> {
    let text = format!("{} {}", vendor, description).to_lowercase();

    // Cleaning
    if contains_any(&text, &["limpieza", "cleaning", "lavandería", "laundry", "maid"]) {
        return Some("cleaning");
    }

    // Maintenance / repairs
    if contains_any(
        &text,
        &[
            "ferretería",
            "ferreteria",
            "hardware",
            "maintenance",
            "mantenimiento",
            "reparación",
            "reparacion",
            "repair",
            "plomero",
            "plumber",
            "electricista",
            "electrician",
            "pintura",
            "paint",
        ],
    ) {
        return Some("maintenance");
    }

    // Utilities
    if contains_any(
        &text,
        &[
            "tigo", "claro", "personal", "ande", "essap", "copaco",
            "internet", "wifi", "electricity", "electricidad",
            "water", "agua", "gas", "telecom", "utilities",
        ],
    ) {
        return Some("utilities");
    }

    // Supplies / amenities
    if contains_any(
        &text,
        &[
            "supermercado", "supermarket", "stock", "amenities",
            "insumos", "supplies", "papel", "jabón", "jabon",
            "shampoo", "toalla", "towel",
        ],
    ) {
        return Some("supplies");
    }

    // Insurance
    if contains_any(&text, &["seguro", "insurance", "póliza", "poliza"]) {
        return Some("insurance");
    }

    // Legal / professional services
    if contains_any(
        &text,
        &[
            "abogado", "lawyer", "legal", "notario", "notary",
            "contador", "accountant", "contable",
        ],
    ) {
        return Some("professional_services");
    }

    // Marketing / advertising
    if contains_any(
        &text,
        &[
            "publicidad", "advertising", "marketing", "anuncio",
            "airbnb", "booking.com", "facebook ads", "google ads",
        ],
    ) {
        return Some("marketing");
    }

    // Commission / platform fees
    if contains_any(&text, &["comisión", "comision", "commission", "fee", "tarifa"]) {
        return Some("commission");
    }

    // Furniture / equipment
    if contains_any(
        &text,
        &[
            "mueble", "furniture", "electrodoméstico", "electrodomestico",
            "appliance", "colchón", "colchon", "mattress",
            "sofá", "sofa", "mesa", "table", "silla", "chair",
        ],
    ) {
        return Some("furniture_equipment");
    }

    // Amount-based hint: very small amounts likely supplies, larger likely maintenance
    if amount > 0.0 && vendor.is_empty() && description.is_empty() {
        if amount < 100_000.0 {
            return Some("supplies");
        } else if amount > 1_000_000.0 {
            return Some("maintenance");
        }
    }

    None
}

fn contains_any(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|kw| text.contains(kw))
}
