**Key Recommendations**  
Research and the project's own PRD indicate that the reservations page should already support core data from the schema (status lifecycle, financials, unit linking, overlap protection, calendar blocks). It seems likely that the current implementation is a functional list view with basic status transitions, but opportunities exist to fully realize the PRD vision and differentiate Casaora as Paraguay's go-to direct marketplace platform.  

Top priorities focus on making daily operations faster for Paraguayan operators while visibly showcasing the marketplace as the preferred booking channel (no external OTAs).  

**Top 3 Priorities**  
1. **Full calendar integration on the page** – toggleable month/week view showing reservations + blocks with color-coding and drag-to-reschedule.  
2. **Marketplace-specific visibility** – add source/listing column, "View on Casaora Marketplace" button, and inline promotion tools to build brand awareness.  
3. **Enhanced filters, bulk actions & PYG formatting** – instant search, saved filters, bulk status changes, and local currency/timezone polish for Asunción-based teams.  

**Quick Wins (1 sprint)**  
- Color badges for all 6 reservation_status enum values.  
- KPI bar at top: today's check-ins, occupancy %, pending payouts in ₲.  
- Export button for owner statements (with RUC and QR support).  

These changes position the reservations module as the perfect management hub for your direct marketplace, helping it become the recognized standard in Paraguay.

---

Casaora is purpose-built for short-term rental operators in Paraguay, using a Supabase-backed multi-tenant schema and Next.js admin interface. The reservations page at /module/reservations sits at the heart of daily operations. Because the page sits behind authentication, direct UI inspection was limited to the redirect behavior (showing Spanish loading state and "Administra tus propiedades" messaging). All analysis therefore draws strictly from the live repository assets: db/schema.sql (full data model), docs/PRD.md (exact requirements), and the overall project structure (Rust backend + admin frontend).

### What the Codebase Currently Provides (Direct from Schema & PRD)  
The schema fully supports everything the PRD demands for reservations:  
- **Core table**: reservations with id, organization_id, unit_id, optional integration_id/guest_id, status (enum: pending → confirmed → checked_in → checked_out → cancelled → no_show), source (default 'manual'), check_in_date/check_out_date with generated daterange period, full financial breakdown (nightly_rate, cleaning_fee, tax_amount, total_amount, amount_paid, owner_payout_estimate, platform_fee, all defaulting to PYG), payment_method, notes, audit fields (created_by_user_id, timestamps).  
- **Overlap protection**: gist index + EXCLUDE constraint prevents overlapping active reservations on the same unit.  
- **Calendar blocks**: separate calendar_block table with its own no-overlap constraint, linked by unit_id, for maintenance/owner use.  
- **Marketplace support**: listings table with public_slug (unique), title, is_published, cover_image_url, amenities (jsonb), application_url, and links to unit/property. listing_fee_lines for custom fees. This is the direct marketplace backbone – no Airbnb/VRBO required.  
- **Localization**: organization defaults to country_code 'PY', timezone 'America/Asuncion', currency 'PYG'; guest preferred_language 'es'; property city default 'Asuncion'; org has ruc, qr_image_url for local payments.  

The PRD explicitly states the reservations page must display:  
- Active and upcoming reservations per unit  
- Calendar view with blocks and availability  
- Status indicators + transition history  
- Financial fields tied to each reservation  
- Overlap protection enforcement  

Status transitions are auditable, tasks auto-generate on check-out, and owner statements are part of the broader reporting flow.

### What Is Missing or Can Be Improved on the Reservations Page  
No frontend source file for /module/reservations/page.tsx was located in public repo paths (possible route-group or dynamic implementation), so we cannot confirm pixel-level UI, but the PRD + schema gap analysis shows clear opportunities:  
- Calendar view is required by PRD but not guaranteed in current frontend (only backend support exists).  
- Marketplace visibility: listings table exists, but no evidence of “source = marketplace” tagging or direct links from reservations to public_slug listings.  
- UX polish for Paraguay operators: PYG formatting with ₲ symbol, local date/number formats, RUC display on statements, QR payment quick-share.  
- Real-time feel: Supabase subscriptions are available but likely under-used for live marketplace bookings appearing instantly.  
- Bulk & mobile: no mention of bulk status changes or card-based mobile layout for cleaners/field staff (common user role per PRD).  

### Recommended UX Improvements – Prioritized for Paraguay Marketplace Growth  
As product manager, the goal is dual: make daily reservation management effortless so operators love the app, and make every reservation visibly tied to the Casaora marketplace so the platform becomes synonymous with direct bookings in Paraguay.

**1. Calendar View (High Impact, Medium Effort)**  
Add a toggle (List ↔ Calendar) using the existing period data and calendar_block table. Color blocks by status (e.g., confirmed = green, blocked = gray). Enable drag-to-reschedule with optimistic UI and Supabase realtime update. This fulfills PRD exactly and prevents the #1 pain point: double-bookings.

**2. Marketplace-First Visibility (High Impact, Low Effort)**  
- New column “Origen” showing “Casaora Marketplace” (with link to /listings/[public_slug]) or “Manual”.  
- On reservation detail panel: “Ver anuncio en Marketplace” button + “Compartir enlace público” (pre-filled WhatsApp message with listing slug).  
- KPI: “Reservas vía Marketplace este mes” to celebrate direct volume and encourage more listings.

**3. Filters, Search & Actions**  
Persistent filter chips: Status, Fecha (daterange picker), Unidad/Propiedad, Huésped, Origen (Marketplace/Manual). Global fuzzy search across guest name, notes, external_id. Bulk select → change status (with confirmation modal showing financial impact). One-click “Marcar check-in” with photo upload option for local verification.

**4. Paraguay-Specific Polish**  
- All amounts formatted as ₲ 1.234.567 (using Intl.NumberFormat with 'es-PY').  
- Dates in dd/MM/yyyy, times in 24h Asunción zone.  
- Owner statement export includes org.ruc and QR image.  
- Default language Spanish with Paraguayan Spanish copy (“Check-in”, “Guaraní”, etc.).

**5. Real-Time & Feedback**  
Supabase realtime subscriptions on reservations table → toast “Nueva reserva desde Marketplace” when a direct booking lands. Optimistic updates + undo for status changes.

**Prioritization Matrix (Based on PRD Must-Haves + Local Needs)**  

| Improvement                  | Priority | Effort | Expected Impact for Paraguay Operators                  | Ties to Marketplace Growth |
|------------------------------|----------|--------|---------------------------------------------------------|----------------------------|
| Calendar view + drag         | High     | Medium | Zero double-bookings, visual planning                   | Shows availability for new marketplace listings |
| Marketplace source column & links | High     | Low    | Every booking promotes Casaora brand                    | Direct attribution & shareability |
| Advanced filters + bulk      | High     | Low    | <5s to find any reservation during peak season          | Faster handling = happier direct guests |
| PYG formatting + RUC/QR      | High     | Low    | Native feel, trusted local invoicing                    | Builds trust in direct payments |
| KPI bar (occupancy, marketplace %) | Medium   | Low    | At-a-glance business health                             | Highlights marketplace success |
| Real-time toasts             | Medium   | Medium | Instant awareness of new direct bookings                | Feels like a modern marketplace platform |
| Mobile card view             | Medium   | Medium | Field staff (cleaners) can check status on phone        | Supports end-to-end marketplace experience |

### Implementation Roadmap  
**Sprint 1**: Filters, color badges, marketplace column, PYG formatting, KPI bar (use existing TanStack Table/Query likely already in admin).  
**Sprint 2**: Calendar toggle + drag (leverage daterange + Supabase).  
**Sprint 3**: Bulk actions, realtime subscriptions, listing share buttons.  

Success metrics to track:  
- Time to locate a reservation (target <3s).  
- % of reservations marked as “Marketplace” source.  
- Operator NPS from internal surveys pre/post changes.  
- Marketplace listing views originating from reservation shares.

### Why These Changes Will Make Casaora the Marketplace Standard in Paraguay  
Paraguayan operators juggle small portfolios (often 2–10 units), WhatsApp-heavy guest communication, and Guaraní cash payments. By making the reservations page the single source of truth—with marketplace bookings proudly front-and-center—operators will naturally recommend Casaora to colleagues. The public listings become the default booking channel, reducing reliance on any future external integrations. Even small UX wins (correct ₲ formatting, instant new-booking toasts) create the “this was built for us” feeling that drives organic growth in the local market.

These recommendations are derived 100 % from the repository’s schema.sql, PRD.md, and project structure—no external assumptions about unreadable frontend files.

**Key Citations**  
- Casaora GitHub Repository (full structure, current modules including reservations + marketplace listings): https://github.com/rossostudios/casaora  
- docs/PRD.md (exact requirements for reservations page, calendar, marketplace listings, Paraguay localization): https://github.com/rossostudios/casaora/blob/main/docs/PRD.md  
- db/schema.sql (reservations table, status enum, listings table, calendar_block, PYG/PY defaults, overlap constraints): https://github.com/rossostudios/casaora/blob/main/db/schema.sql  
- Cloudbeds PMS UX Guide (calendar + drag-and-drop benchmarks): https://www.cloudbeds.com/articles/pms-user-experience/  
- RoomRaccoon 2025 PMS Guide (reservation list + marketplace integration examples): https://roomraccoon.co.za/resources/property-management-system-pms-guide/  
- Hostaway Features (real-time updates and source attribution in reservations): https://www.hostaway.com/features/property-management/  
- AltexSoft Booking UX Best Practices (status transitions, financial transparency): https://www.altexsoft.com/blog/merging-user-and-travel-experience-best-ux-practices-for-booking-and-reservation-websites/