#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub struct AgentSpec {
    pub slug: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub system_prompt: &'static str,
    pub max_steps: i32,
    pub mutation_tools: &'static [&'static str],
    pub allowed_tools: Option<&'static [&'static str]>,
}

const SUPERVISOR_ALLOWED_TOOLS: &[&str] = &[
    "list_tables",
    "get_org_snapshot",
    "list_rows",
    "get_row",
    "create_row",
    "update_row",
    "delete_row",
    "classify_and_delegate",
    "delegate_to_agent",
    "send_message",
    "search_knowledge",
    "recall_memory",
    "store_memory",
    "create_execution_plan",
    "evaluate_agent_response",
    "get_agent_health",
    "execute_playbook",
    "get_risk_radar",
];

const LEASING_ALLOWED_TOOLS: &[&str] = &[
    "list_tables",
    "get_org_snapshot",
    "list_rows",
    "get_row",
    "create_row",
    "update_row",
    "advance_application_stage",
    "schedule_property_viewing",
    "generate_lease_offer",
    "send_application_update",
    "score_application",
    "match_applicant_to_units",
    "auto_qualify_lead",
    "send_tour_reminder",
    "send_message",
    "get_lease_risk_summary",
    "search_knowledge",
    "recall_memory",
    "store_memory",
    "create_execution_plan",
    "check_lease_compliance",
    "abstract_lease_document",
    "check_paraguayan_compliance",
    "track_lease_deadlines",
    "auto_populate_lease_charges",
    "get_risk_radar",
    "forecast_demand",
];

const MAINTENANCE_ALLOWED_TOOLS: &[&str] = &[
    "list_tables",
    "get_org_snapshot",
    "list_rows",
    "get_row",
    "create_row",
    "update_row",
    "classify_maintenance_request",
    "auto_assign_maintenance",
    "check_maintenance_sla",
    "escalate_maintenance",
    "request_vendor_quote",
    "select_vendor",
    "dispatch_to_vendor",
    "verify_completion",
    "get_vendor_performance",
    "analyze_inspection_photos",
    "compare_inspections",
    "create_defect_tickets",
    "verify_cleaning",
    "create_maintenance_task",
    "get_staff_availability",
    "send_message",
    "recall_memory",
    "store_memory",
    "create_execution_plan",
    "search_knowledge",
];

const FINANCE_ALLOWED_TOOLS: &[&str] = &[
    "list_tables",
    "get_org_snapshot",
    "list_rows",
    "get_row",
    "create_row",
    "update_row",
    "get_revenue_analytics",
    "get_seasonal_demand",
    "get_collections_risk",
    "get_owner_statement_summary",
    "get_anomaly_alerts",
    "generate_owner_statement",
    "reconcile_collections",
    "categorize_expense",
    "auto_reconcile_all",
    "generate_pricing_recommendations",
    "apply_pricing_recommendation",
    "fetch_market_data",
    "simulate_rate_impact",
    "get_portfolio_kpis",
    "get_property_comparison",
    "simulate_investment_scenario",
    "get_portfolio_trends",
    "get_property_heatmap",
    "generate_performance_digest",
    "simulate_renovation_roi",
    "simulate_stress_test",
    "import_bank_transactions",
    "auto_reconcile_batch",
    "handle_split_payment",
    "check_lease_compliance",
    "check_document_expiry",
    "get_risk_radar",
    "forecast_demand",
    "recall_memory",
    "store_memory",
    "create_execution_plan",
    "search_knowledge",
];

pub const SUPERVISOR_SPEC: AgentSpec = AgentSpec {
    slug: "supervisor",
    name: "Operations Supervisor",
    description: "Orchestrates multi-agent workflows. Routes requests to specialist agents, monitors cross-domain operations, and handles escalations.",
    system_prompt: r#"You are the Operations Supervisor for Casaora, a property-management platform in Paraguay. You orchestrate the agent team and handle cross-domain requests.

Your capabilities:
1. ROUTING: Classify user requests and delegate to the best specialist agent (guest-concierge, maintenance-triage, finance-agent, leasing-agent).
2. CROSS-DOMAIN: Handle requests that span multiple domains.
3. ESCALATION: Handle escalated requests from specialist agents that exceed their authority.
4. MONITORING: Provide high-level operational summaries across all domains.
5. PLANNING: Decompose complex multi-step operations into coordinated plans.

Decision rules:
- Always attempt to classify before delegating.
- If a request touches 2+ domains, handle each part sequentially by delegating.
- Budget-related escalations: if spend exceeds org limits, block and notify admin.
- Quality monitoring: evaluate agent responses for accuracy and helpfulness.
- When in doubt, ask the user for clarification rather than guessing."#,
    max_steps: 12,
    mutation_tools: &[
        "create_row",
        "update_row",
        "delete_row",
        "send_message",
        "execute_playbook",
    ],
    allowed_tools: Some(SUPERVISOR_ALLOWED_TOOLS),
};

pub const GUEST_CONCIERGE_SPEC: AgentSpec = AgentSpec {
    slug: "guest-concierge",
    name: "Guest Concierge",
    description:
        "Primary operations copilot for guest inquiries, reservations, and property operations.",
    system_prompt: r#"You are the Guest Concierge for Casaora, a property-management platform in Paraguay. You are the primary operations copilot.

Your capabilities:
1. GUEST MANAGEMENT: Look up guest information, reservation details, check-in/out status.
2. OPERATIONS: Provide daily ops briefs, manage tasks, track maintenance requests.
3. ANALYTICS: Surface revenue analytics, occupancy forecasts, anomaly alerts.
4. COMMUNICATION: Send messages to guests via WhatsApp, email, or SMS.
5. KNOWLEDGE: Search the organization knowledge base for policies and procedures.
6. PLANNING: Decompose complex multi-step tasks into execution plans.
7. MEMORY: Store and recall important facts about guests, properties, and interactions.

CRITICAL RULES:
- KNOWLEDGE FIRST: Before answering property policies/procedures/amenities/house-rules questions, ALWAYS call search_knowledge first.
- AUTO-MEMORY: After resolving a guest issue or learning a new fact, call store_memory.
- For financial operations over $5,000, recommend human review.
- When unsure about a domain, delegate to the specialist agent using classify_and_delegate.
- Keep responses concise and action-oriented. Use tables for multi-row data.
- Always verify data before making changes."#,
    max_steps: 10,
    mutation_tools: &[
        "create_row",
        "update_row",
        "delete_row",
        "send_message",
        "create_maintenance_task",
        "generate_access_code",
        "send_access_code",
        "revoke_access_code",
        "store_memory",
    ],
    allowed_tools: None,
};

pub const LEASING_SPEC: AgentSpec = AgentSpec {
    slug: "leasing-agent",
    name: "Leasing Agent",
    description: "Manages the full leasing funnel: qualification, matching, viewing, screening, and lease execution.",
    system_prompt: r#"You are the Leasing Agent for Casaora, a property-management platform in Paraguay. You autonomously manage the tenant acquisition pipeline.

Your workflow:
1. QUALIFICATION: Review completeness and score applicants.
2. SCREENING: Validate income-to-rent ratio, employment, and references.
3. PROPERTY MATCHING: Match applicant preferences to units.
4. VIEWINGS: Schedule viewings and send confirmations.
5. OFFERS: Generate lease offers with move-in cost breakdown.
6. COMMUNICATION: Keep applicants informed at every stage.

Decision rules:
- Score >= 70: auto-advance.
- Score < 40: flag for human review.
- Income-to-rent ratio must be >= 3:1 for auto-qualification.
- Stalled applications (48h no activity): trigger follow-up.
- Always confirm viewing times with tenant and staff."#,
    max_steps: 10,
    mutation_tools: &[
        "create_row",
        "update_row",
        "advance_application_stage",
        "schedule_property_viewing",
        "generate_lease_offer",
        "send_application_update",
        "send_tour_reminder",
        "send_message",
        "auto_populate_lease_charges",
    ],
    allowed_tools: Some(LEASING_ALLOWED_TOOLS),
};

pub const MAINTENANCE_SPEC: AgentSpec = AgentSpec {
    slug: "maintenance-triage",
    name: "Maintenance Triage",
    description: "Autonomous maintenance dispatch from classification through SLA escalation and verification.",
    system_prompt: r#"You are the Maintenance Triage Agent for Casaora, a property-management platform in Paraguay. You autonomously manage the maintenance lifecycle.

Your workflow:
1. CLASSIFY: Category + urgency.
2. ASSIGN: Best-fit staff/vendor by availability and specialization.
3. DISPATCH: Send work orders with required context.
4. MONITOR: Track SLA compliance.
5. ESCALATE: Auto-escalate SLA breaches.
6. VERIFY: Request completion photos and verify.

Decision rules:
- Critical issues (water leak, gas, fire): immediate escalation + emergency dispatch.
- Vendor selection scoring: specialty 40% + rating 30% + availability 20% + proximity 10%.
- SLA breach: re-assign and notify manager.
- Always create a task for every maintenance request."#,
    max_steps: 10,
    mutation_tools: &[
        "create_row",
        "update_row",
        "create_maintenance_task",
        "auto_assign_maintenance",
        "escalate_maintenance",
        "select_vendor",
        "request_vendor_quote",
        "dispatch_to_vendor",
        "verify_completion",
        "create_defect_tickets",
        "send_message",
    ],
    allowed_tools: Some(MAINTENANCE_ALLOWED_TOOLS),
};

pub const FINANCE_SPEC: AgentSpec = AgentSpec {
    slug: "finance-agent",
    name: "Finance Agent",
    description: "Financial operations specialist for analytics, collections, reconciliation, statements, and compliance.",
    system_prompt: r#"You are the Finance Agent for Casaora, a property-management platform in Paraguay. You manage financial operations and reporting.

Your capabilities:
1. REVENUE: Analyze RevPAN, ADR, occupancy, and revenue trends.
2. COLLECTIONS: Track outstanding payments and reconcile collections.
3. STATEMENTS: Generate owner statements with IVA (10%) calculations.
4. EXPENSES: Categorize expenses and detect anomalies.
5. RECONCILIATION: Match bank transactions to expected payments.
6. COMPLIANCE: Validate lease financial terms and local regulatory requirements.
7. FORECASTING: Build revenue and expense projections.

Decision rules:
- All financial calculations include IVA (10%) for Paraguay.
- Currency is PYG unless property is configured in USD.
- Flag discrepancies > 5% between expected and actual collections.
- Owner statements must reconcile exactly.
- For bulk operations, present summary before execution."#,
    max_steps: 8,
    mutation_tools: &[
        "create_row",
        "update_row",
        "generate_owner_statement",
        "reconcile_collections",
        "categorize_expense",
        "apply_pricing_recommendation",
        "fetch_market_data",
        "auto_reconcile_all",
        "import_bank_transactions",
        "auto_reconcile_batch",
        "handle_split_payment",
    ],
    allowed_tools: Some(FINANCE_ALLOWED_TOOLS),
};

const AGENT_SPECS: &[AgentSpec] = &[
    SUPERVISOR_SPEC,
    GUEST_CONCIERGE_SPEC,
    LEASING_SPEC,
    MAINTENANCE_SPEC,
    FINANCE_SPEC,
];

pub fn get_agent_spec(slug: &str) -> Option<&'static AgentSpec> {
    let trimmed = slug.trim();
    AGENT_SPECS.iter().find(|spec| spec.slug == trimmed)
}

pub fn allowed_tools_for_slug(slug: &str) -> Option<Vec<String>> {
    get_agent_spec(slug)
        .and_then(|spec| spec.allowed_tools)
        .map(|tools| tools.iter().map(|value| (*value).to_string()).collect())
}

pub fn default_max_steps_for_slug(slug: &str) -> Option<i32> {
    get_agent_spec(slug).map(|spec| spec.max_steps)
}
