from pydantic import BaseModel, Field
from typing import Any, Literal, Optional

OrganizationProfileType = Literal["owner_operator", "management_company"]


class ListResponse(BaseModel):
    data: list[dict]


class CreateOrganizationInput(BaseModel):
    name: str
    legal_name: Optional[str] = None
    ruc: Optional[str] = None
    profile_type: OrganizationProfileType = "management_company"
    default_currency: str = "PYG"
    timezone: str = "America/Asuncion"


class UpdateOrganizationInput(BaseModel):
    name: Optional[str] = None
    legal_name: Optional[str] = None
    ruc: Optional[str] = None
    profile_type: Optional[OrganizationProfileType] = None
    default_currency: Optional[str] = None
    timezone: Optional[str] = None


class CreateOrganizationMemberInput(BaseModel):
    user_id: str
    role: str = "operator"
    is_primary: bool = False


class UpdateOrganizationMemberInput(BaseModel):
    role: Optional[str] = None
    is_primary: Optional[bool] = None


class CreateOrganizationInviteInput(BaseModel):
    email: str
    role: str = "operator"
    expires_in_days: Optional[int] = 14


class AcceptOrganizationInviteInput(BaseModel):
    token: str


class CreatePropertyInput(BaseModel):
    organization_id: str
    name: str
    code: Optional[str] = None
    status: str = "active"
    address_line1: Optional[str] = None
    city: str = "Asuncion"
    country_code: str = "PY"


class UpdatePropertyInput(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    address_line1: Optional[str] = None
    city: Optional[str] = None


class CreateUnitInput(BaseModel):
    organization_id: str
    property_id: str
    code: str
    name: str
    max_guests: int = 2
    bedrooms: int = 1
    bathrooms: float = 1.0
    currency: str = "PYG"


class UpdateUnitInput(BaseModel):
    name: Optional[str] = None
    max_guests: Optional[int] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[float] = None
    is_active: Optional[bool] = None


class CreateChannelInput(BaseModel):
    organization_id: str
    kind: str
    name: str
    external_account_ref: Optional[str] = None


class UpdateChannelInput(BaseModel):
    kind: Optional[str] = None
    name: Optional[str] = None
    external_account_ref: Optional[str] = None
    is_active: Optional[bool] = None


class CreateListingInput(BaseModel):
    organization_id: str
    unit_id: str
    channel_id: str
    external_listing_id: Optional[str] = None
    public_name: str
    marketplace_publishable: bool = False
    public_slug: Optional[str] = None
    ical_import_url: Optional[str] = None


class UpdateListingInput(BaseModel):
    external_listing_id: Optional[str] = None
    public_name: Optional[str] = None
    marketplace_publishable: Optional[bool] = None
    public_slug: Optional[str] = None
    ical_import_url: Optional[str] = None
    is_active: Optional[bool] = None


class CreateGuestInput(BaseModel):
    organization_id: str
    full_name: str
    email: Optional[str] = None
    phone_e164: Optional[str] = None
    document_type: Optional[str] = None
    document_number: Optional[str] = None
    country_code: Optional[str] = None
    preferred_language: str = "es"
    notes: Optional[str] = None


class UpdateGuestInput(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone_e164: Optional[str] = None
    document_type: Optional[str] = None
    document_number: Optional[str] = None
    country_code: Optional[str] = None
    preferred_language: Optional[str] = None
    notes: Optional[str] = None


class CreateReservationInput(BaseModel):
    organization_id: str
    unit_id: str
    listing_id: Optional[str] = None
    channel_id: Optional[str] = None
    guest_id: Optional[str] = None
    external_reservation_id: Optional[str] = None
    source: str = "manual"
    status: str = "pending"
    check_in_date: str
    check_out_date: str
    adults: int = 1
    children: int = 0
    infants: int = 0
    pets: int = 0
    currency: str = "PYG"
    nightly_rate: float = 0
    cleaning_fee: float = 0
    tax_amount: float = 0
    extra_fees: float = 0
    discount_amount: float = 0
    total_amount: float
    amount_paid: float = 0
    payment_method: Optional[str] = None
    notes: Optional[str] = None


class UpdateReservationInput(BaseModel):
    guest_id: Optional[str] = None
    amount_paid: Optional[float] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None


class ReservationStatusInput(BaseModel):
    status: str
    reason: Optional[str] = None


class CreateCalendarBlockInput(BaseModel):
    organization_id: str
    unit_id: str
    starts_on: str
    ends_on: str
    source: str = "manual"
    reason: Optional[str] = None


class UpdateCalendarBlockInput(BaseModel):
    starts_on: Optional[str] = None
    ends_on: Optional[str] = None
    reason: Optional[str] = None


class CreateTaskInput(BaseModel):
    organization_id: str
    title: str
    type: str = "custom"
    status: str = "todo"
    priority: str = "medium"
    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    reservation_id: Optional[str] = None
    assigned_user_id: Optional[str] = None
    description: Optional[str] = None
    due_at: Optional[str] = None
    sla_due_at: Optional[str] = None
    sla_breached_at: Optional[str] = None


class UpdateTaskInput(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_user_id: Optional[str] = None
    description: Optional[str] = None
    due_at: Optional[str] = None
    sla_due_at: Optional[str] = None
    sla_breached_at: Optional[str] = None


class CompleteTaskInput(BaseModel):
    completion_notes: Optional[str] = None


class CreateTaskItemInput(BaseModel):
    label: str
    is_required: bool = True
    sort_order: Optional[int] = None


class UpdateTaskItemInput(BaseModel):
    label: Optional[str] = None
    is_required: Optional[bool] = None
    is_completed: Optional[bool] = None
    sort_order: Optional[int] = None


class CreateExpenseInput(BaseModel):
    organization_id: str
    category: str
    expense_date: str
    amount: float
    currency: str = "PYG"
    fx_rate_to_pyg: Optional[float] = Field(default=None, gt=0)
    payment_method: str = "bank_transfer"
    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    reservation_id: Optional[str] = None
    vendor_name: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_ruc: Optional[str] = None
    receipt_url: str
    notes: Optional[str] = None


class UpdateExpenseInput(BaseModel):
    category: Optional[str] = None
    expense_date: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    fx_rate_to_pyg: Optional[float] = Field(default=None, gt=0)
    payment_method: Optional[str] = None
    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    reservation_id: Optional[str] = None
    vendor_name: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_ruc: Optional[str] = None
    receipt_url: Optional[str] = None
    notes: Optional[str] = None


class CreateOwnerStatementInput(BaseModel):
    organization_id: str
    period_start: str
    period_end: str
    currency: str = "PYG"
    property_id: Optional[str] = None
    unit_id: Optional[str] = None


class CreateMessageTemplateInput(BaseModel):
    organization_id: str
    template_key: str
    name: str
    channel: str = "whatsapp"
    language_code: str = "es-PY"
    subject: Optional[str] = None
    body: str
    variables: list[str] = Field(default_factory=list)


class SendMessageInput(BaseModel):
    organization_id: str
    channel: str
    recipient: str
    template_id: Optional[str] = None
    reservation_id: Optional[str] = None
    guest_id: Optional[str] = None
    variables: Optional[dict[str, Any]] = None
    scheduled_at: Optional[str] = None


class FeeLineInput(BaseModel):
    fee_type: str
    label: str
    amount: float = Field(default=0, ge=0)
    is_refundable: bool = False
    is_recurring: bool = False
    sort_order: Optional[int] = Field(default=None, gt=0)


class CreatePricingTemplateInput(BaseModel):
    organization_id: str
    name: str
    description: Optional[str] = None
    currency: str = "PYG"
    is_default: bool = False
    is_active: bool = True
    lines: list[FeeLineInput] = Field(default_factory=list)


class UpdatePricingTemplateInput(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    currency: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    lines: Optional[list[FeeLineInput]] = None


class CreateMarketplaceListingInput(BaseModel):
    organization_id: str
    listing_id: Optional[str] = None
    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    pricing_template_id: Optional[str] = None
    public_slug: str
    title: str
    summary: Optional[str] = None
    description: Optional[str] = None
    neighborhood: Optional[str] = None
    city: str = "Asuncion"
    country_code: str = "PY"
    currency: str = "PYG"
    application_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    gallery_image_urls: list[str] = Field(default_factory=list)
    bedrooms: Optional[int] = Field(default=None, ge=0)
    bathrooms: Optional[float] = Field(default=None, ge=0)
    square_meters: Optional[float] = Field(default=None, ge=0)
    property_type: Optional[str] = None
    furnished: bool = False
    pet_policy: Optional[str] = None
    parking_spaces: Optional[int] = Field(default=None, ge=0)
    minimum_lease_months: Optional[int] = Field(default=None, ge=1)
    available_from: Optional[str] = None
    amenities: list[str] = Field(default_factory=list)
    maintenance_fee: float = Field(default=0, ge=0)
    fee_lines: list[FeeLineInput] = Field(default_factory=list)


class UpdateMarketplaceListingInput(BaseModel):
    listing_id: Optional[str] = None
    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    pricing_template_id: Optional[str] = None
    public_slug: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    description: Optional[str] = None
    neighborhood: Optional[str] = None
    city: Optional[str] = None
    country_code: Optional[str] = None
    currency: Optional[str] = None
    application_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    gallery_image_urls: Optional[list[str]] = None
    bedrooms: Optional[int] = Field(default=None, ge=0)
    bathrooms: Optional[float] = Field(default=None, ge=0)
    square_meters: Optional[float] = Field(default=None, ge=0)
    property_type: Optional[str] = None
    furnished: Optional[bool] = None
    pet_policy: Optional[str] = None
    parking_spaces: Optional[int] = Field(default=None, ge=0)
    minimum_lease_months: Optional[int] = Field(default=None, ge=1)
    available_from: Optional[str] = None
    amenities: Optional[list[str]] = None
    maintenance_fee: Optional[float] = Field(default=None, ge=0)
    is_published: Optional[bool] = None
    fee_lines: Optional[list[FeeLineInput]] = None


class PublicMarketplaceApplicationInput(BaseModel):
    org_id: Optional[str] = None
    marketplace_listing_id: Optional[str] = None
    listing_slug: Optional[str] = None
    full_name: str
    email: str
    phone_e164: Optional[str] = None
    document_number: Optional[str] = None
    monthly_income: Optional[float] = Field(default=None, ge=0)
    guarantee_choice: str = "cash_deposit"
    message: Optional[str] = None
    source: str = "marketplace"
    metadata: dict[str, Any] = Field(default_factory=dict)


class ApplicationStatusInput(BaseModel):
    status: str
    assigned_user_id: Optional[str] = None
    rejected_reason: Optional[str] = None
    note: Optional[str] = None


class ConvertApplicationToLeaseInput(BaseModel):
    starts_on: str
    ends_on: Optional[str] = None
    currency: str = "PYG"
    monthly_rent: float = Field(default=0, ge=0)
    service_fee_flat: float = Field(default=0, ge=0)
    security_deposit: float = Field(default=0, ge=0)
    guarantee_option_fee: float = Field(default=0, ge=0)
    tax_iva: float = Field(default=0, ge=0)
    platform_fee: float = Field(default=0, ge=0)
    notes: Optional[str] = None
    generate_first_collection: bool = True
    first_collection_due_date: Optional[str] = None
    collection_schedule_months: Optional[int] = Field(default=None, ge=1, le=120)


class CreateLeaseChargeInput(BaseModel):
    charge_date: str
    charge_type: str
    description: Optional[str] = None
    amount: float = Field(default=0, ge=0)
    currency: str = "PYG"
    status: str = "scheduled"


class CreateLeaseInput(BaseModel):
    organization_id: str
    application_id: Optional[str] = None
    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    tenant_full_name: str
    tenant_email: Optional[str] = None
    tenant_phone_e164: Optional[str] = None
    lease_status: str = "draft"
    starts_on: str
    ends_on: Optional[str] = None
    currency: str = "PYG"
    monthly_rent: float = Field(default=0, ge=0)
    service_fee_flat: float = Field(default=0, ge=0)
    security_deposit: float = Field(default=0, ge=0)
    guarantee_option_fee: float = Field(default=0, ge=0)
    tax_iva: float = Field(default=0, ge=0)
    platform_fee: float = Field(default=0, ge=0)
    notes: Optional[str] = None
    charges: list[CreateLeaseChargeInput] = Field(default_factory=list)
    generate_first_collection: bool = True
    first_collection_due_date: Optional[str] = None
    collection_schedule_months: Optional[int] = Field(default=None, ge=1, le=120)


class UpdateLeaseInput(BaseModel):
    tenant_full_name: Optional[str] = None
    tenant_email: Optional[str] = None
    tenant_phone_e164: Optional[str] = None
    lease_status: Optional[str] = None
    starts_on: Optional[str] = None
    ends_on: Optional[str] = None
    currency: Optional[str] = None
    monthly_rent: Optional[float] = Field(default=None, ge=0)
    service_fee_flat: Optional[float] = Field(default=None, ge=0)
    security_deposit: Optional[float] = Field(default=None, ge=0)
    guarantee_option_fee: Optional[float] = Field(default=None, ge=0)
    tax_iva: Optional[float] = Field(default=None, ge=0)
    platform_fee: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None


class CreateCollectionInput(BaseModel):
    organization_id: str
    lease_id: str
    lease_charge_id: Optional[str] = None
    due_date: str
    amount: float = Field(default=0, ge=0)
    currency: str = "PYG"
    status: str = "scheduled"
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    scheduled_at: Optional[str] = None
    paid_at: Optional[str] = None
    notes: Optional[str] = None


class MarkCollectionPaidInput(BaseModel):
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    paid_at: Optional[str] = None
    notes: Optional[str] = None


class AgentConversationMessageInput(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AgentChatInput(BaseModel):
    org_id: str
    message: str = Field(min_length=1, max_length=4000)
    conversation: list[AgentConversationMessageInput] = Field(
        default_factory=list,
        max_length=20,
    )
    allow_mutations: bool = False


class AgentDefinition(BaseModel):
    id: str
    slug: str
    name: str
    description: str
    icon_key: str
    is_active: bool = True


class CreateAgentChatInput(BaseModel):
    org_id: str
    agent_slug: str = Field(min_length=2, max_length=80)
    title: Optional[str] = Field(default=None, max_length=180)


class SendAgentMessageInput(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    allow_mutations: bool = False
    confirm_write: bool = False


class AgentChatSummary(BaseModel):
    id: str
    org_id: str
    agent_id: str
    agent_slug: str
    agent_name: str
    title: str
    is_archived: bool
    last_message_at: str
    created_at: str
    updated_at: str
    latest_message_preview: Optional[str] = None


class AgentChatMessage(BaseModel):
    id: str
    chat_id: str
    org_id: str
    role: Literal["user", "assistant"]
    content: str
    tool_trace: Optional[list[dict[str, Any]]] = None
    model_used: Optional[str] = None
    fallback_used: bool = False
    created_at: str
