"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatCurrency } from "@/lib/format";

type ExportRow = {
  id: string;
  status: string;
  check_in_date: string | null;
  check_out_date: string | null;
  guest_name: string | null;
  unit_name: string | null;
  property_name: string | null;
  channel_name: string | null;
  source: string | null;
  total_amount: number | null;
  amount_paid: number | null;
  currency: string | null;
};

type ReservationsExportButtonProps = {
  rows: ExportRow[];
  isEn: boolean;
  locale: string;
  format: "csv" | "pdf";
};

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function loadPdfLibs() {
  const jsPDFModule = await import("jspdf");
  const autoTableModule = await import("jspdf-autotable");
  return { jsPDF: jsPDFModule.default, autoTable: autoTableModule.default };
}

function buildAndSavePdf(
  jsPDF: typeof import("jspdf").default,
  autoTable: typeof import("jspdf-autotable").default,
  opts: {
    pdfHeaders: string[];
    pdfBody: string[][];
    reportTitle: string;
    generatedLabel: string;
    recordsLabel: string;
    generatedByLabel: string;
    pageLabel: string;
    locale: string;
    rowCount: number;
  }
): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  let y = 15;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(opts.reportTitle, margin, y);
  y += 6;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  const subTitle =
    opts.generatedLabel +
    ": " +
    new Date().toLocaleDateString(opts.locale) +
    " \u2014 " +
    String(opts.rowCount) +
    " " +
    opts.recordsLabel;
  doc.text(subTitle, margin, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [opts.pdfHeaders],
    body: opts.pdfBody,
    theme: "striped",
    headStyles: { fillColor: [41, 41, 41], fontSize: 8 },
    bodyStyles: { fontSize: 7 },
    columnStyles: { 6: { halign: "right" } },
    margin: { left: margin, right: margin },
  });

  const pageCount = doc.getNumberOfPages();
  const footerLeft = `${opts.generatedByLabel} Casaora`;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150);
    const footerY = doc.internal.pageSize.getHeight() - 8;
    const footerRight = `${opts.pageLabel} ${String(i)}/${String(pageCount)}`;
    doc.text(footerLeft, margin, footerY);
    doc.text(footerRight, pageWidth - margin, footerY, { align: "right" });
  }

  const date = new Date().toISOString().slice(0, 10);
  doc.save(`reservations-${date}.pdf`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ReservationsExportButton({
  rows,
  isEn,
  locale,
  format,
}: ReservationsExportButtonProps) {
  "use no memo";
  const [generating, setGenerating] = useState(false);

  const headers = [
    isEn ? "Status" : "Estado",
    "Check-in",
    "Check-out",
    isEn ? "Guest" : "Huésped",
    isEn ? "Unit" : "Unidad",
    isEn ? "Property" : "Propiedad",
    isEn ? "Channel" : "Canal",
    isEn ? "Source" : "Origen",
    isEn ? "Amount" : "Monto",
    isEn ? "Paid" : "Pagado",
    isEn ? "Currency" : "Moneda",
  ];

  const toRow = (r: ExportRow): string[] => [
    r.status ?? "",
    r.check_in_date ?? "",
    r.check_out_date ?? "",
    r.guest_name ?? "",
    r.unit_name ?? "",
    r.property_name ?? "",
    r.channel_name ?? "",
    r.source ?? "manual",
    r.total_amount != null ? String(r.total_amount) : "",
    r.amount_paid != null ? String(r.amount_paid) : "",
    r.currency ?? "PYG",
  ];

  const handleCSV = () => {
    const lines = [
      headers.map(escapeCSV).join(","),
      ...rows.map((r) => toRow(r).map(escapeCSV).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `reservations-${date}.csv`);
  };

  const handlePDF = async () => {
    setGenerating(true);

    const pdfBody = rows.map((r) => {
      const status = r.status != null ? r.status : "";
      const checkIn = r.check_in_date != null ? r.check_in_date : "";
      const checkOut = r.check_out_date != null ? r.check_out_date : "";
      const guest = r.guest_name != null ? r.guest_name : "";
      const unit = r.unit_name != null ? r.unit_name : "";
      const source =
        r.source === "direct_booking"
          ? "Marketplace"
          : r.source != null
            ? r.source
            : "Manual";
      const currency = r.currency != null ? r.currency : "PYG";
      const amount =
        r.total_amount != null
          ? formatCurrency(r.total_amount, currency, locale)
          : "-";
      return [status, checkIn, checkOut, guest, unit, source, amount];
    });

    const reportTitle = isEn ? "Reservations Report" : "Reporte de Reservas";
    const generatedLabel = isEn ? "Generated" : "Generado";
    const recordsLabel = isEn ? "records" : "registros";
    const pdfHeaders = [
      isEn ? "Status" : "Estado",
      "Check-in",
      "Check-out",
      isEn ? "Guest" : "Huésped",
      isEn ? "Unit" : "Unidad",
      isEn ? "Source" : "Origen",
      isEn ? "Amount" : "Monto",
    ];
    const generatedByLabel = isEn ? "Generated by" : "Generado por";
    const pageLabel = isEn ? "Page" : "Página";

    const { jsPDF, autoTable } = await loadPdfLibs();

    try {
      buildAndSavePdf(jsPDF, autoTable, {
        pdfHeaders,
        pdfBody,
        reportTitle,
        generatedLabel,
        recordsLabel,
        generatedByLabel,
        pageLabel,
        locale,
        rowCount: rows.length,
      });
    } catch (err) {
      console.error("PDF generation failed:", err);
    }
    setGenerating(false);
  };

  if (format === "csv") {
    return (
      <Button onClick={handleCSV} size="sm" variant="outline">
        CSV
      </Button>
    );
  }

  return (
    <Button
      disabled={generating}
      onClick={handlePDF}
      size="sm"
      variant="outline"
    >
      {generating ? (
        <>
          <Spinner size="sm" />
          PDF...
        </>
      ) : (
        "PDF"
      )}
    </Button>
  );
}
