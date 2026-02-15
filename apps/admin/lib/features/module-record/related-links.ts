export function buildRelatedLinks(
  slug: string,
  recordId: string,
  isEn: boolean
): Array<{ href: string; label: string }> {
  const links: Array<{ href: string; label: string }> = [];
  const q = (key: string, value: string) =>
    `${key}=${encodeURIComponent(value)}`;

  if (slug === "organizations") {
    links.push({
      href: "/setup",
      label: isEn ? "Open onboarding setup" : "Abrir configuración",
    });
    links.push({
      href: "/module/properties",
      label: isEn ? "Properties" : "Propiedades",
    });
    links.push({ href: "/module/units", label: isEn ? "Units" : "Unidades" });
    links.push({
      href: "/module/integrations",
      label: isEn ? "Integrations" : "Integraciones",
    });
    links.push({
      href: "/module/reservations",
      label: isEn ? "Reservations" : "Reservas",
    });
    links.push({ href: "/module/tasks", label: isEn ? "Tasks" : "Tareas" });
    links.push({
      href: "/module/expenses",
      label: isEn ? "Expenses" : "Gastos",
    });
    links.push({
      href: "/module/owner-statements",
      label: isEn ? "Owner statements" : "Estados del propietario",
    });
    return links;
  }

  if (slug === "properties") {
    links.push({
      href: `/module/units?${q("property_id", recordId)}`,
      label: isEn ? "Units in this property" : "Unidades en esta propiedad",
    });
    links.push({
      href: `/module/tasks?${q("property_id", recordId)}`,
      label: isEn ? "Tasks in this property" : "Tareas de esta propiedad",
    });
    links.push({
      href: `/module/expenses?${q("property_id", recordId)}`,
      label: isEn ? "Expenses in this property" : "Gastos de esta propiedad",
    });
    links.push({
      href: `/module/owner-statements?${q("property_id", recordId)}`,
      label: isEn
        ? "Owner statements in this property"
        : "Estados del propietario de esta propiedad",
    });
    links.push({
      href: `/module/leases?${q("property_id", recordId)}`,
      label: isEn ? "Related leases" : "Contratos relacionados",
    });
    links.push({
      href: `/module/applications?${q("property_id", recordId)}`,
      label: isEn ? "Related applications" : "Aplicaciones relacionadas",
    });
    links.push({
      href: `/module/collections?${q("property_id", recordId)}`,
      label: isEn ? "Related collections" : "Cobros relacionados",
    });
    return links;
  }

  if (slug === "units") {
    links.push({
      href: `/module/integrations?${q("unit_id", recordId)}`,
      label: isEn
        ? "Integrations for this unit"
        : "Integraciones de esta unidad",
    });
    links.push({
      href: `/module/reservations?${q("unit_id", recordId)}`,
      label: isEn ? "Reservations for this unit" : "Reservas de esta unidad",
    });
    links.push({
      href: `/module/calendar?${q("unit_id", recordId)}`,
      label: isEn ? "Calendar for this unit" : "Calendario de esta unidad",
    });
    links.push({
      href: `/module/tasks?${q("unit_id", recordId)}`,
      label: isEn ? "Tasks for this unit" : "Tareas de esta unidad",
    });
    links.push({
      href: `/module/expenses?${q("unit_id", recordId)}`,
      label: isEn ? "Expenses for this unit" : "Gastos de esta unidad",
    });
    links.push({
      href: `/module/owner-statements?${q("unit_id", recordId)}`,
      label: isEn
        ? "Owner statements for this unit"
        : "Estados del propietario de esta unidad",
    });
    return links;
  }

  if (slug === "integrations") {
    links.push({
      href: `/module/reservations?${q("integration_id", recordId)}`,
      label: isEn
        ? "Reservations for this integration"
        : "Reservas de esta integración",
    });
    return links;
  }

  if (slug === "guests") {
    links.push({
      href: `/module/reservations?${q("guest_id", recordId)}`,
      label: isEn ? "Reservations for this guest" : "Reservas de este huésped",
    });
    return links;
  }

  if (slug === "reservations") {
    links.push({
      href: `/module/tasks?${q("reservation_id", recordId)}`,
      label: isEn ? "Tasks for this reservation" : "Tareas de esta reserva",
    });
    links.push({
      href: `/module/expenses?${q("reservation_id", recordId)}`,
      label: isEn ? "Expenses for this reservation" : "Gastos de esta reserva",
    });
    return links;
  }

  return links;
}
