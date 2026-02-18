use serde::Deserialize;
use validator::Validate;

use crate::error::AppError;

#[allow(dead_code)]
pub fn validate_input<T: Validate>(input: &T) -> Result<(), AppError> {
    input
        .validate()
        .map_err(|errors| AppError::UnprocessableEntity(format!("Validation failed: {errors}")))
}

fn default_management_company() -> String {
    "management_company".to_string()
}
fn default_currency_pyg() -> String {
    "PYG".to_string()
}
fn default_timezone_asuncion() -> String {
    "America/Asuncion".to_string()
}
fn default_operator_role() -> String {
    "operator".to_string()
}
fn default_expires_in_days() -> i32 {
    14
}
fn default_false() -> bool {
    false
}
fn default_property_status() -> String {
    "active".to_string()
}
fn default_city_asuncion() -> String {
    "Asuncion".to_string()
}
fn default_country_py() -> String {
    "PY".to_string()
}
fn default_max_guests() -> i16 {
    2
}
fn default_bedrooms() -> i16 {
    1
}
fn default_bathrooms() -> f64 {
    1.0
}
fn default_es_lang() -> String {
    "es".to_string()
}

#[derive(Debug, Clone, Deserialize, serde::Serialize, Validate)]
pub struct CreateOrganizationInput {
    #[validate(length(min = 1, max = 255))]
    pub name: String,
    pub legal_name: Option<String>,
    pub ruc: Option<String>,
    #[serde(default = "default_management_company")]
    pub profile_type: String,
    #[serde(default = "default_currency_pyg")]
    pub default_currency: String,
    #[serde(default = "default_timezone_asuncion")]
    pub timezone: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateOrganizationInput {
    pub name: Option<String>,
    pub legal_name: Option<String>,
    pub ruc: Option<String>,
    pub profile_type: Option<String>,
    pub default_currency: Option<String>,
    pub timezone: Option<String>,
    pub bank_name: Option<String>,
    pub bank_account_number: Option<String>,
    pub bank_account_holder: Option<String>,
    pub qr_image_url: Option<String>,
    pub logo_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize, Validate)]
pub struct CreateOrganizationInviteInput {
    #[validate(email)]
    pub email: String,
    #[serde(default = "default_operator_role")]
    pub role: String,
    #[serde(default = "default_expires_in_days")]
    pub expires_in_days: i32,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct AcceptOrganizationInviteInput {
    pub token: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateOrganizationMemberInput {
    pub user_id: String,
    #[serde(default = "default_operator_role")]
    pub role: String,
    #[serde(default = "default_false")]
    pub is_primary: bool,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateOrganizationMemberInput {
    pub role: Option<String>,
    pub is_primary: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreatePropertyInput {
    pub organization_id: String,
    pub name: String,
    pub code: Option<String>,
    #[serde(default = "default_property_status")]
    pub status: String,
    pub address_line1: Option<String>,
    #[serde(default = "default_city_asuncion")]
    pub city: String,
    #[serde(default = "default_country_py")]
    pub country_code: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdatePropertyInput {
    pub name: Option<String>,
    pub status: Option<String>,
    pub address_line1: Option<String>,
    pub city: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateUnitInput {
    pub organization_id: String,
    pub property_id: String,
    pub code: String,
    pub name: String,
    #[serde(default = "default_max_guests")]
    pub max_guests: i16,
    #[serde(default = "default_bedrooms")]
    pub bedrooms: i16,
    #[serde(default = "default_bathrooms")]
    pub bathrooms: f64,
    #[serde(default = "default_currency_pyg")]
    pub currency: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateUnitInput {
    pub name: Option<String>,
    pub max_guests: Option<i16>,
    pub bedrooms: Option<i16>,
    pub bathrooms: Option<f64>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateIntegrationInput {
    pub organization_id: String,
    pub unit_id: String,
    pub kind: String,
    pub channel_name: String,
    pub external_account_ref: Option<String>,
    pub external_listing_id: Option<String>,
    pub public_name: String,
    #[serde(default = "default_false")]
    pub marketplace_publishable: bool,
    pub public_slug: Option<String>,
    pub ical_import_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateIntegrationInput {
    pub kind: Option<String>,
    pub channel_name: Option<String>,
    pub external_account_ref: Option<String>,
    pub external_listing_id: Option<String>,
    pub public_name: Option<String>,
    pub marketplace_publishable: Option<bool>,
    pub public_slug: Option<String>,
    pub ical_import_url: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize, Validate)]
pub struct CreateGuestInput {
    pub organization_id: String,
    #[validate(length(min = 1, max = 255))]
    pub full_name: String,
    #[validate(email)]
    pub email: Option<String>,
    pub phone_e164: Option<String>,
    pub document_type: Option<String>,
    pub document_number: Option<String>,
    pub country_code: Option<String>,
    #[serde(default = "default_es_lang")]
    pub preferred_language: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateGuestInput {
    pub full_name: Option<String>,
    pub email: Option<String>,
    pub phone_e164: Option<String>,
    pub document_type: Option<String>,
    pub document_number: Option<String>,
    pub country_code: Option<String>,
    pub preferred_language: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ListOrganizationsQuery {
    pub org_id: Option<String>,
    #[serde(default = "default_limit_100")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct PropertiesQuery {
    pub org_id: String,
    pub status: Option<String>,
    #[serde(default = "default_limit_100")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UnitsQuery {
    pub org_id: String,
    pub property_id: Option<String>,
    #[serde(default = "default_limit_100")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct IntegrationsQuery {
    pub org_id: String,
    pub unit_id: Option<String>,
    pub kind: Option<String>,
    #[serde(default = "default_limit_100")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct GuestsQuery {
    pub org_id: String,
    #[serde(default = "default_limit_100")]
    pub limit: i64,
}

pub fn clamp_limit(limit: i64) -> i64 {
    limit.clamp(1, 500)
}

fn default_limit_100() -> i64 {
    100
}

pub fn serialize_to_map<T>(value: &T) -> serde_json::Map<String, serde_json::Value>
where
    T: serde::Serialize,
{
    let json = serde_json::to_value(value)
        .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));
    json.as_object().cloned().unwrap_or_default()
}

pub fn remove_nulls(
    mut map: serde_json::Map<String, serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    map.retain(|_, value| !value.is_null());
    map
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct OrgPath {
    pub org_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct OrgInvitePath {
    pub org_id: String,
    pub invite_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct OrgMemberPath {
    pub org_id: String,
    pub member_user_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct PropertyPath {
    pub property_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UnitPath {
    pub unit_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct IntegrationPath {
    pub integration_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct GuestPath {
    pub guest_id: String,
}

fn default_source_manual() -> String {
    "manual".to_string()
}
fn default_deposit_status_none() -> String {
    "none".to_string()
}
fn default_refund_percent() -> f64 {
    100.0
}
fn default_cutoff_hours() -> i32 {
    48
}
fn default_reservation_status_pending() -> String {
    "pending".to_string()
}
fn default_booking_source_manual() -> String {
    "manual".to_string()
}
fn default_adults() -> i32 {
    1
}
fn default_children() -> i32 {
    0
}
fn default_infants() -> i32 {
    0
}
fn default_pets() -> i32 {
    0
}
fn default_payment_method_bank_transfer() -> String {
    "bank_transfer".to_string()
}
fn default_task_type_custom() -> String {
    "custom".to_string()
}
fn default_task_status_todo() -> String {
    "todo".to_string()
}
fn default_task_priority_medium() -> String {
    "medium".to_string()
}
fn default_true() -> bool {
    true
}
fn default_lease_status_draft() -> String {
    "draft".to_string()
}
fn default_collection_status_scheduled() -> String {
    "scheduled".to_string()
}
fn default_limit_200() -> i64 {
    200
}
fn default_limit_300() -> i64 {
    300
}
fn default_limit_400() -> i64 {
    400
}
fn default_limit_120() -> i64 {
    120
}
fn default_limit_250() -> i64 {
    250
}
fn default_limit_60() -> i64 {
    60
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateReservationInput {
    pub organization_id: String,
    pub unit_id: String,
    pub integration_id: Option<String>,
    pub guest_id: Option<String>,
    pub external_reservation_id: Option<String>,
    #[serde(default = "default_booking_source_manual")]
    pub source: String,
    #[serde(default = "default_reservation_status_pending")]
    pub status: String,
    pub check_in_date: String,
    pub check_out_date: String,
    #[serde(default = "default_adults")]
    pub adults: i32,
    #[serde(default = "default_children")]
    pub children: i32,
    #[serde(default = "default_infants")]
    pub infants: i32,
    #[serde(default = "default_pets")]
    pub pets: i32,
    #[serde(default = "default_currency_pyg")]
    pub currency: String,
    #[serde(default)]
    pub nightly_rate: f64,
    #[serde(default)]
    pub cleaning_fee: f64,
    #[serde(default)]
    pub tax_amount: f64,
    #[serde(default)]
    pub extra_fees: f64,
    #[serde(default)]
    pub discount_amount: f64,
    pub total_amount: f64,
    #[serde(default)]
    pub amount_paid: f64,
    pub payment_method: Option<String>,
    pub notes: Option<String>,
    pub cancellation_policy_id: Option<String>,
    #[serde(default)]
    pub deposit_amount: f64,
    #[serde(default = "default_deposit_status_none")]
    pub deposit_status: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateReservationInput {
    pub guest_id: Option<String>,
    pub amount_paid: Option<f64>,
    pub payment_method: Option<String>,
    pub notes: Option<String>,
    pub cancellation_policy_id: Option<String>,
    pub deposit_amount: Option<f64>,
    pub deposit_status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ReservationStatusInput {
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateCalendarBlockInput {
    pub organization_id: String,
    pub unit_id: String,
    pub starts_on: String,
    pub ends_on: String,
    #[serde(default = "default_source_manual")]
    pub source: String,
    pub reason: Option<String>,
    pub recurrence_rule: Option<String>,
    pub recurrence_end_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateCalendarBlockInput {
    pub starts_on: Option<String>,
    pub ends_on: Option<String>,
    pub reason: Option<String>,
    pub recurrence_rule: Option<String>,
    pub recurrence_end_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateCancellationPolicyInput {
    pub organization_id: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(default = "default_refund_percent")]
    pub refund_percent: f64,
    #[serde(default = "default_cutoff_hours")]
    pub cutoff_hours: i32,
    #[serde(default = "default_false")]
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateCancellationPolicyInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub refund_percent: Option<f64>,
    pub cutoff_hours: Option<i32>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CancellationPoliciesQuery {
    pub org_id: String,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CancellationPolicyPath {
    pub policy_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct DepositRefundInput {
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateTaskInput {
    pub organization_id: String,
    pub title: String,
    #[serde(rename = "type")]
    #[serde(default = "default_task_type_custom")]
    pub task_type: String,
    #[serde(default = "default_task_status_todo")]
    pub status: String,
    #[serde(default = "default_task_priority_medium")]
    pub priority: String,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
    pub reservation_id: Option<String>,
    pub assigned_user_id: Option<String>,
    pub description: Option<String>,
    pub due_at: Option<String>,
    pub sla_due_at: Option<String>,
    pub sla_breached_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateTaskInput {
    pub title: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub assigned_user_id: Option<String>,
    pub description: Option<String>,
    pub due_at: Option<String>,
    pub sla_due_at: Option<String>,
    pub sla_breached_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CompleteTaskInput {
    pub completion_notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateTaskItemInput {
    pub label: String,
    #[serde(default = "default_true")]
    pub is_required: bool,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateTaskItemInput {
    pub label: Option<String>,
    pub is_required: Option<bool>,
    pub is_completed: Option<bool>,
    pub sort_order: Option<i32>,
    pub photo_urls: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateExpenseInput {
    pub organization_id: String,
    pub category: String,
    pub expense_date: String,
    pub amount: f64,
    #[serde(default = "default_currency_pyg")]
    pub currency: String,
    pub fx_rate_to_pyg: Option<f64>,
    #[serde(default = "default_payment_method_bank_transfer")]
    pub payment_method: String,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
    pub reservation_id: Option<String>,
    pub vendor_name: Option<String>,
    pub invoice_number: Option<String>,
    pub invoice_ruc: Option<String>,
    pub receipt_url: String,
    pub notes: Option<String>,
    #[serde(default = "default_false")]
    pub iva_applicable: bool,
    pub iva_amount: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateExpenseInput {
    pub category: Option<String>,
    pub expense_date: Option<String>,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    pub fx_rate_to_pyg: Option<f64>,
    pub payment_method: Option<String>,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
    pub reservation_id: Option<String>,
    pub vendor_name: Option<String>,
    pub invoice_number: Option<String>,
    pub invoice_ruc: Option<String>,
    pub receipt_url: Option<String>,
    pub notes: Option<String>,
    pub iva_applicable: Option<bool>,
    pub iva_amount: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateLeaseChargeInput {
    pub charge_date: String,
    pub charge_type: String,
    pub description: Option<String>,
    #[serde(default)]
    pub amount: f64,
    #[serde(default = "default_currency_pyg")]
    pub currency: String,
    #[serde(default = "default_collection_status_scheduled")]
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateLeaseInput {
    pub organization_id: String,
    pub application_id: Option<String>,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
    pub tenant_full_name: String,
    pub tenant_email: Option<String>,
    pub tenant_phone_e164: Option<String>,
    #[serde(default = "default_lease_status_draft")]
    pub lease_status: String,
    pub starts_on: String,
    pub ends_on: Option<String>,
    #[serde(default = "default_currency_pyg")]
    pub currency: String,
    #[serde(default)]
    pub monthly_rent: f64,
    #[serde(default)]
    pub service_fee_flat: f64,
    #[serde(default)]
    pub security_deposit: f64,
    #[serde(default)]
    pub guarantee_option_fee: f64,
    #[serde(default)]
    pub tax_iva: f64,
    #[serde(default)]
    pub platform_fee: f64,
    pub notes: Option<String>,
    #[serde(default)]
    pub charges: Vec<CreateLeaseChargeInput>,
    #[serde(default = "default_true")]
    pub generate_first_collection: bool,
    pub first_collection_due_date: Option<String>,
    pub collection_schedule_months: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateLeaseInput {
    pub tenant_full_name: Option<String>,
    pub tenant_email: Option<String>,
    pub tenant_phone_e164: Option<String>,
    pub lease_status: Option<String>,
    pub starts_on: Option<String>,
    pub ends_on: Option<String>,
    pub currency: Option<String>,
    pub monthly_rent: Option<f64>,
    pub service_fee_flat: Option<f64>,
    pub security_deposit: Option<f64>,
    pub guarantee_option_fee: Option<f64>,
    pub tax_iva: Option<f64>,
    pub platform_fee: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateCollectionInput {
    pub organization_id: String,
    pub lease_id: String,
    pub lease_charge_id: Option<String>,
    pub due_date: String,
    #[serde(default)]
    pub amount: f64,
    #[serde(default = "default_currency_pyg")]
    pub currency: String,
    #[serde(default = "default_collection_status_scheduled")]
    pub status: String,
    pub payment_method: Option<String>,
    pub payment_reference: Option<String>,
    pub scheduled_at: Option<String>,
    pub paid_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct MarkCollectionPaidInput {
    pub payment_method: Option<String>,
    pub payment_reference: Option<String>,
    pub paid_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ReservationsQuery {
    pub org_id: String,
    pub unit_id: Option<String>,
    pub integration_id: Option<String>,
    pub guest_id: Option<String>,
    pub status: Option<String>,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CalendarAvailabilityQuery {
    pub org_id: String,
    pub unit_id: String,
    #[serde(rename = "from")]
    pub from_date: String,
    #[serde(rename = "to")]
    pub to_date: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CalendarBlocksQuery {
    pub org_id: String,
    pub unit_id: Option<String>,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct TasksQuery {
    pub org_id: String,
    pub status: Option<String>,
    pub assigned_user_id: Option<String>,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
    pub reservation_id: Option<String>,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct TaskItemsQuery {
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ExpensesQuery {
    pub org_id: String,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
    pub category: Option<String>,
    pub currency: Option<String>,
    pub payment_method: Option<String>,
    pub vendor_name: Option<String>,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
    pub reservation_id: Option<String>,
    pub approval_status: Option<String>,
    #[serde(default = "default_limit_300")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CollectionsQuery {
    pub org_id: String,
    pub status: Option<String>,
    pub lease_id: Option<String>,
    pub due_from: Option<String>,
    pub due_to: Option<String>,
    #[serde(default = "default_limit_400")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct LeasesQuery {
    pub org_id: String,
    pub lease_status: Option<String>,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
    #[serde(default = "default_limit_300")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ReservationPath {
    pub reservation_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct BlockPath {
    pub block_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct TaskPath {
    pub task_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct TaskItemPath {
    pub task_id: String,
    pub item_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ExpenseApprovalInput {
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ExpensePath {
    pub expense_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CollectionPath {
    pub collection_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct LeasePath {
    pub lease_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct FeeLineInput {
    pub fee_type: String,
    pub label: String,
    #[serde(default)]
    pub amount: f64,
    #[serde(default)]
    pub is_refundable: bool,
    #[serde(default)]
    pub is_recurring: bool,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreatePricingTemplateInput {
    pub organization_id: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(default = "default_currency_pyg")]
    pub currency: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default = "default_true")]
    pub is_active: bool,
    #[serde(default)]
    pub lines: Vec<FeeLineInput>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdatePricingTemplateInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub currency: Option<String>,
    pub is_default: Option<bool>,
    pub is_active: Option<bool>,
    pub lines: Option<Vec<FeeLineInput>>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateMessageTemplateInput {
    pub organization_id: String,
    pub template_key: String,
    pub name: String,
    #[serde(default = "default_channel_whatsapp")]
    pub channel: String,
    #[serde(default = "default_language_es_py")]
    pub language_code: String,
    pub subject: Option<String>,
    pub body: String,
    #[serde(default)]
    pub variables: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct SendMessageInput {
    pub organization_id: String,
    pub channel: String,
    pub recipient: String,
    pub template_id: Option<String>,
    pub reservation_id: Option<String>,
    pub guest_id: Option<String>,
    pub variables: Option<serde_json::Value>,
    pub scheduled_at: Option<String>,
    pub body: Option<String>,
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct PricingTemplatesQuery {
    pub org_id: String,
    pub is_active: Option<bool>,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct MessageTemplatesQuery {
    pub org_id: String,
    pub channel: Option<String>,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct IntegrationEventsQuery {
    pub org_id: String,
    pub provider: Option<String>,
    pub event_type: Option<String>,
    pub status: Option<String>,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct AuditLogsQuery {
    pub org_id: String,
    pub action: Option<String>,
    pub entity_name: Option<String>,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct TemplatePath {
    pub template_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct IntegrationEventPath {
    pub event_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct AuditLogPath {
    pub log_id: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct IcalPath {
    pub token: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ApplicationsQuery {
    pub org_id: String,
    pub status: Option<String>,
    pub assigned_user_id: Option<String>,
    pub listing_id: Option<String>,
    #[serde(default = "default_limit_250")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ApplicationPath {
    pub application_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ApplicationStatusInput {
    pub status: String,
    pub assigned_user_id: Option<String>,
    pub rejected_reason: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ConvertApplicationToLeaseInput {
    pub starts_on: String,
    pub ends_on: Option<String>,
    #[serde(default = "default_currency_pyg")]
    pub currency: String,
    #[serde(default)]
    pub monthly_rent: f64,
    #[serde(default)]
    pub service_fee_flat: f64,
    #[serde(default)]
    pub security_deposit: f64,
    #[serde(default)]
    pub guarantee_option_fee: f64,
    #[serde(default)]
    pub tax_iva: f64,
    #[serde(default)]
    pub platform_fee: f64,
    pub notes: Option<String>,
    #[serde(default = "default_true")]
    pub generate_first_collection: bool,
    pub first_collection_due_date: Option<String>,
    pub collection_schedule_months: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct OwnerStatementsQuery {
    pub org_id: String,
    pub status: Option<String>,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
    #[serde(default = "default_limit_120")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateOwnerStatementInput {
    pub organization_id: String,
    pub period_start: String,
    pub period_end: String,
    #[serde(default = "default_currency_pyg")]
    pub currency: String,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct OwnerStatementPath {
    pub statement_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct OwnerSummaryQuery {
    pub org_id: String,
    #[serde(rename = "from")]
    pub from_date: String,
    #[serde(rename = "to")]
    pub to_date: String,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ReportsPeriodQuery {
    pub org_id: String,
    #[serde(rename = "from")]
    pub from_date: String,
    #[serde(rename = "to")]
    pub to_date: String,
}

fn default_page() -> i64 {
    1
}
fn default_per_page() -> i64 {
    50
}
fn default_sort_by_created_at() -> String {
    "created_at".to_string()
}
fn default_sort_order_desc() -> String {
    "desc".to_string()
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ListingsQuery {
    pub org_id: String,
    pub is_published: Option<bool>,
    pub integration_id: Option<String>,
    pub unit_id: Option<String>,
    pub status: Option<String>,
    pub q: Option<String>,
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_per_page")]
    pub per_page: i64,
    #[serde(default = "default_sort_by_created_at")]
    pub sort_by: String,
    #[serde(default = "default_sort_order_desc")]
    pub sort_order: String,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct SlugAvailableQuery {
    pub slug: String,
    pub org_id: String,
    pub exclude_listing_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ListingPath {
    pub listing_id: String,
}

fn default_marketplace_source() -> String {
    "marketplace".to_string()
}
fn default_cash_deposit() -> String {
    "cash_deposit".to_string()
}
fn default_asuncion_city() -> String {
    "Asuncion".to_string()
}
fn default_country_code_py() -> String {
    "PY".to_string()
}
fn default_empty_strings() -> Vec<String> {
    Vec::new()
}
fn default_zero() -> f64 {
    0.0
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateListingInput {
    pub organization_id: String,
    pub integration_id: Option<String>,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
    pub pricing_template_id: Option<String>,
    pub public_slug: String,
    pub title: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub neighborhood: Option<String>,
    #[serde(default = "default_asuncion_city")]
    pub city: String,
    #[serde(default = "default_country_code_py")]
    pub country_code: String,
    #[serde(default = "default_currency_pyg")]
    pub currency: String,
    pub application_url: Option<String>,
    pub cover_image_url: Option<String>,
    #[serde(default = "default_empty_strings")]
    pub gallery_image_urls: Vec<String>,
    pub bedrooms: Option<i32>,
    pub bathrooms: Option<f64>,
    pub square_meters: Option<f64>,
    pub property_type: Option<String>,
    #[serde(default)]
    pub furnished: bool,
    pub pet_policy: Option<String>,
    pub parking_spaces: Option<i32>,
    pub minimum_lease_months: Option<i32>,
    pub available_from: Option<String>,
    #[serde(default = "default_empty_strings")]
    pub amenities: Vec<String>,
    #[serde(default = "default_zero")]
    pub maintenance_fee: f64,
    #[serde(default)]
    pub fee_lines: Vec<FeeLineInput>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateListingInput {
    pub integration_id: Option<String>,
    pub property_id: Option<String>,
    pub unit_id: Option<String>,
    pub pricing_template_id: Option<String>,
    pub public_slug: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub neighborhood: Option<String>,
    pub city: Option<String>,
    pub country_code: Option<String>,
    pub currency: Option<String>,
    pub application_url: Option<String>,
    pub cover_image_url: Option<String>,
    pub gallery_image_urls: Option<Vec<String>>,
    pub bedrooms: Option<i32>,
    pub bathrooms: Option<f64>,
    pub square_meters: Option<f64>,
    pub property_type: Option<String>,
    pub furnished: Option<bool>,
    pub pet_policy: Option<String>,
    pub parking_spaces: Option<i32>,
    pub minimum_lease_months: Option<i32>,
    pub available_from: Option<String>,
    pub amenities: Option<Vec<String>>,
    pub maintenance_fee: Option<f64>,
    pub is_published: Option<bool>,
    pub fee_lines: Option<Vec<FeeLineInput>>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct PublicListingsQuery {
    pub city: Option<String>,
    pub neighborhood: Option<String>,
    pub q: Option<String>,
    pub property_type: Option<String>,
    pub furnished: Option<bool>,
    pub pet_policy: Option<String>,
    pub min_parking: Option<i32>,
    pub min_monthly: Option<f64>,
    pub max_monthly: Option<f64>,
    pub min_move_in: Option<f64>,
    pub max_move_in: Option<f64>,
    pub min_bedrooms: Option<i32>,
    pub min_bathrooms: Option<f64>,
    pub org_id: Option<String>,
    #[serde(default = "default_limit_60")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct PublicListingSlugPath {
    pub slug: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize, Validate)]
pub struct PublicListingApplicationInput {
    pub org_id: Option<String>,
    pub listing_id: Option<String>,
    pub listing_slug: Option<String>,
    #[validate(length(min = 1, max = 255))]
    pub full_name: String,
    #[validate(email)]
    pub email: String,
    pub phone_e164: Option<String>,
    pub document_number: Option<String>,
    pub monthly_income: Option<f64>,
    #[serde(default = "default_cash_deposit")]
    pub guarantee_choice: String,
    pub message: Option<String>,
    #[serde(default = "default_marketplace_source")]
    pub source: String,
    #[serde(default)]
    pub metadata: serde_json::Map<String, serde_json::Value>,
}

// ---------- Payment instructions ----------

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreatePaymentInstructionInput {
    pub payment_method: Option<String>,
    pub bank_name: Option<String>,
    pub account_number: Option<String>,
    pub account_holder: Option<String>,
    pub qr_payload_url: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct PaymentInstructionsQuery {
    pub org_id: String,
    pub status: Option<String>,
    pub collection_record_id: Option<String>,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct PaymentInstructionPath {
    pub instruction_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct PaymentReferencePath {
    pub reference_code: String,
}

// ---------- Notification rules ----------

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateNotificationRuleInput {
    pub organization_id: String,
    pub trigger_event: String,
    pub message_template_id: Option<String>,
    #[serde(default = "default_channel_whatsapp")]
    pub channel: String,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateNotificationRuleInput {
    pub message_template_id: Option<String>,
    pub channel: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct NotificationRulesQuery {
    pub org_id: String,
    pub is_active: Option<bool>,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct NotificationRulePath {
    pub rule_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct NotificationRulesMetadataQuery {
    pub org_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct NotificationsQuery {
    pub org_id: String,
    pub status: Option<String>,
    pub category: Option<String>,
    pub cursor: Option<String>,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct NotificationPath {
    pub notification_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ReadAllNotificationsInput {
    pub org_id: String,
}

pub fn clamp_limit_in_range(limit: i64, minimum: i64, maximum: i64) -> i64 {
    limit.clamp(minimum, maximum)
}

fn default_channel_whatsapp() -> String {
    "whatsapp".to_string()
}

fn default_language_es_py() -> String {
    "es-PY".to_string()
}

fn default_limit_500() -> i64 {
    500
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct MessageLogsQuery {
    pub org_id: String,
    pub channel: Option<String>,
    pub status: Option<String>,
    pub direction: Option<String>,
    pub guest_id: Option<String>,
    #[serde(default = "default_limit_500")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize, Validate)]
pub struct MarketplaceInquiryInput {
    #[validate(length(min = 1, max = 255))]
    pub full_name: String,
    #[validate(email)]
    pub email: String,
    pub phone_e164: Option<String>,
    #[validate(length(min = 1, max = 2000))]
    pub message: String,
}

// ===== Contract Templates =====

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ContractTemplatesQuery {
    pub org_id: String,
    #[serde(default = "default_limit_200")]
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ContractTemplatePath {
    pub template_id: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CreateContractTemplateInput {
    pub organization_id: String,
    pub name: String,
    #[serde(default = "default_language_es")]
    pub language: String,
    #[serde(default)]
    pub body_template: String,
    #[serde(default)]
    pub variables: Vec<String>,
    #[serde(default)]
    pub is_default: bool,
}

fn default_language_es() -> String {
    "es".to_string()
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateContractTemplateInput {
    pub name: Option<String>,
    pub language: Option<String>,
    pub body_template: Option<String>,
    pub variables: Option<Vec<String>>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct RenderContractInput {
    pub lease_id: String,
}

// ===== Properties Bulk Import =====

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct BulkImportPropertiesInput {
    pub organization_id: String,
    pub rows: Vec<BulkPropertyRow>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct BulkPropertyRow {
    pub name: String,
    pub code: Option<String>,
    pub address_line1: Option<String>,
    pub city: Option<String>,
    pub country_code: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}
