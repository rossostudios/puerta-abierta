/**
 * Generate a lease contract PDF using jsPDF.
 * Called from the leases manager row actions.
 */
export type LeaseContractData = {
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string;
  propertyName: string;
  unitName: string;
  startsOn: string;
  endsOn: string;
  monthlyRent: number;
  serviceFee: number;
  securityDeposit: number;
  guaranteeFee: number;
  taxIva: number;
  totalMoveIn: number;
  monthlyTotal: number;
  currency: string;
  notes: string;
  orgName: string;
};

function fmtAmount(value: number, currency: string): string {
  if (currency === "PYG") {
    const formatted = Math.round(value)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `₲${formatted}`;
  }
  return `$${value.toFixed(2)}`;
}

function fmtDate(dateStr: string, isEn: boolean): string {
  if (!dateStr) return isEn ? "Not specified" : "No especificada";
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(isEn ? "en-US" : "es-PY", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export async function generateLeaseContractPdf(
  data: LeaseContractData,
  isEn: boolean
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "legal" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 25;

  // Header
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(
    isEn ? "LEASE AGREEMENT" : "CONTRATO DE ALQUILER",
    pageWidth / 2,
    y,
    { align: "center" }
  );
  y += 10;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(data.orgName, pageWidth / 2, y, { align: "center" });
  y += 8;

  // Divider
  doc.setDrawColor(180);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // Parties section
  doc.setTextColor(0);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(isEn ? "1. PARTIES" : "1. PARTES", margin, y);
  y += 7;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  const partiesData = [
    [
      isEn ? "Landlord / Administrator" : "Arrendador / Administrador",
      data.orgName,
    ],
    [isEn ? "Tenant" : "Inquilino", data.tenantName],
    ...(data.tenantEmail
      ? [[isEn ? "Email" : "Correo", data.tenantEmail]]
      : []),
    ...(data.tenantPhone
      ? [[isEn ? "Phone" : "Teléfono", data.tenantPhone]]
      : []),
  ];

  autoTable(doc, {
    startY: y,
    body: partiesData,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 } },
    margin: { left: margin, right: margin },
  });

  // @ts-expect-error - jspdf-autotable adds lastAutoTable
  y = doc.lastAutoTable.finalY + 10;

  // Property section
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(isEn ? "2. PROPERTY" : "2. PROPIEDAD", margin, y);
  y += 7;

  const propertyData = [
    [isEn ? "Property" : "Propiedad", data.propertyName || "-"],
    [isEn ? "Unit" : "Unidad", data.unitName || "-"],
  ];

  autoTable(doc, {
    startY: y,
    body: propertyData,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 } },
    margin: { left: margin, right: margin },
  });

  // @ts-expect-error - jspdf-autotable adds lastAutoTable
  y = doc.lastAutoTable.finalY + 10;

  // Term section
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(isEn ? "3. LEASE TERM" : "3. PLAZO DEL CONTRATO", margin, y);
  y += 7;

  const termData = [
    [isEn ? "Start date" : "Fecha de inicio", fmtDate(data.startsOn, isEn)],
    [isEn ? "End date" : "Fecha de fin", fmtDate(data.endsOn, isEn)],
  ];

  autoTable(doc, {
    startY: y,
    body: termData,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 } },
    margin: { left: margin, right: margin },
  });

  // @ts-expect-error - jspdf-autotable adds lastAutoTable
  y = doc.lastAutoTable.finalY + 10;

  // Financial terms
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(
    isEn ? "4. FINANCIAL TERMS" : "4. CONDICIONES ECONÓMICAS",
    margin,
    y
  );
  y += 7;

  const cur = data.currency || "PYG";
  const financialData = [
    [isEn ? "Monthly rent" : "Renta mensual", fmtAmount(data.monthlyRent, cur)],
    ...(data.serviceFee > 0
      ? [[isEn ? "Service fee" : "Cuota de servicio", fmtAmount(data.serviceFee, cur)]]
      : []),
    ...(data.taxIva > 0
      ? [["IVA", fmtAmount(data.taxIva, cur)]]
      : []),
    ...(data.monthlyTotal > 0
      ? [[isEn ? "Monthly total" : "Total mensual", fmtAmount(data.monthlyTotal, cur)]]
      : []),
  ];

  autoTable(doc, {
    startY: y,
    head: [[isEn ? "Concept" : "Concepto", isEn ? "Amount" : "Monto"]],
    body: financialData,
    theme: "striped",
    headStyles: { fillColor: [41, 41, 41], fontSize: 9 },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 1: { halign: "right" } },
    margin: { left: margin, right: margin },
  });

  // @ts-expect-error - jspdf-autotable adds lastAutoTable
  y = doc.lastAutoTable.finalY + 8;

  // Move-in costs
  if (data.securityDeposit > 0 || data.guaranteeFee > 0 || data.totalMoveIn > 0) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(
      isEn ? "5. MOVE-IN COSTS" : "5. COSTOS DE INGRESO",
      margin,
      y
    );
    y += 7;

    const moveInData = [
      ...(data.securityDeposit > 0
        ? [[isEn ? "Security deposit" : "Depósito de garantía", fmtAmount(data.securityDeposit, cur)]]
        : []),
      ...(data.guaranteeFee > 0
        ? [[isEn ? "Guarantee fee" : "Cuota de garantía", fmtAmount(data.guaranteeFee, cur)]]
        : []),
      ...(data.totalMoveIn > 0
        ? [[isEn ? "Total move-in" : "Total de ingreso", fmtAmount(data.totalMoveIn, cur)]]
        : []),
    ];

    autoTable(doc, {
      startY: y,
      body: moveInData,
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 55 },
        1: { halign: "right" },
      },
      margin: { left: margin, right: margin },
    });

    // @ts-expect-error - jspdf-autotable adds lastAutoTable
    y = doc.lastAutoTable.finalY + 10;
  }

  // Notes
  if (data.notes) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(isEn ? "NOTES" : "NOTAS", margin, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(data.notes, pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 5 + 10;
  }

  // Signature lines
  if (y > doc.internal.pageSize.getHeight() - 60) {
    doc.addPage();
    y = 30;
  }

  y = Math.max(y, doc.internal.pageSize.getHeight() - 80);

  doc.setDrawColor(0);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  const sigWidth = (pageWidth - margin * 2 - 20) / 2;

  // Landlord signature
  doc.line(margin, y, margin + sigWidth, y);
  doc.text(
    isEn ? "Landlord / Administrator" : "Arrendador / Administrador",
    margin,
    y + 5
  );
  doc.text(data.orgName, margin, y + 10);

  // Tenant signature
  const sigX2 = margin + sigWidth + 20;
  doc.line(sigX2, y, sigX2 + sigWidth, y);
  doc.text(isEn ? "Tenant" : "Inquilino", sigX2, y + 5);
  doc.text(data.tenantName, sigX2, y + 10);

  y += 20;
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `${isEn ? "Date" : "Fecha"}: _____ / _____ / _____`,
    margin,
    y
  );
  doc.text(
    `${isEn ? "Date" : "Fecha"}: _____ / _____ / _____`,
    sigX2,
    y
  );

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150);
    const footerY = doc.internal.pageSize.getHeight() - 8;
    doc.text(
      `${isEn ? "Generated by" : "Generado por"} Stoa`,
      margin,
      footerY
    );
    doc.text(
      `${isEn ? "Page" : "Página"} ${i}/${pageCount}`,
      pageWidth - margin,
      footerY,
      { align: "right" }
    );
  }

  const fileName = `${isEn ? "lease" : "contrato"}-${data.tenantName.replace(/\s+/g, "-").toLowerCase()}.pdf`;
  doc.save(fileName);
}
