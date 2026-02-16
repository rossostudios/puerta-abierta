"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type OwnerStatementPdfProps = {
  reportData: Record<string, unknown>;
  orgName: string;
  periodLabel: string;
  locale: string;
  isEn: boolean;
};

function fmt(value: unknown, currency = "PYG", locale = "es-PY"): string {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "-";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "PYG" ? 0 : 2,
    maximumFractionDigits: currency === "PYG" ? 0 : 2,
  }).format(n);
}

function pct(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

export function OwnerStatementPdfButton({
  reportData,
  orgName,
  periodLabel,
  locale,
  isEn,
}: OwnerStatementPdfProps) {
  const [generating, setGenerating] = useState(false);

  const handleDownload = async () => {
    if (generating) return;
    setGenerating(true);

    try {
      const { default: jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 15;
      let y = 20;

      // Header
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text(isEn ? "Owner Statement" : "Estado de Cuenta del Propietario", margin, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100);
      doc.text(orgName, margin, y);
      y += 5;
      doc.text(periodLabel, margin, y);
      y += 3;

      // Divider
      doc.setDrawColor(200);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      // Summary cards
      doc.setTextColor(0);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(isEn ? "Summary" : "Resumen", margin, y);
      y += 7;

      const summaryData = [
        [isEn ? "Gross Revenue" : "Ingresos Brutos", fmt(reportData.gross_revenue, "PYG", locale)],
        [isEn ? "Lease Collections" : "Cobros de Alquiler", fmt(reportData.lease_collections ?? reportData.total_collections, "PYG", locale)],
        [isEn ? "Service Fees" : "Cuotas de Servicio", fmt(reportData.service_fees, "PYG", locale)],
        [isEn ? "Expenses" : "Gastos", fmt(reportData.expenses ?? reportData.operating_expenses, "PYG", locale)],
        [isEn ? "Platform Fees" : "Comisiones de Plataforma", fmt(reportData.platform_fees, "PYG", locale)],
        [isEn ? "Taxes" : "Impuestos", fmt(reportData.taxes_collected ?? reportData.taxes, "PYG", locale)],
      ].filter(([, val]) => val !== "-");

      autoTable(doc, {
        startY: y,
        head: [[isEn ? "Item" : "Concepto", isEn ? "Amount" : "Monto"]],
        body: summaryData,
        theme: "striped",
        headStyles: { fillColor: [41, 41, 41], fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 1: { halign: "right" } },
        margin: { left: margin, right: margin },
      });

      // @ts-expect-error - jspdf-autotable adds lastAutoTable to doc
      y = doc.lastAutoTable.finalY + 10;

      // Net payout highlight
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      const netPayout = fmt(reportData.net_payout, "PYG", locale);
      doc.text(
        `${isEn ? "Net Payout" : "Pago Neto"}: ${netPayout}`,
        margin,
        y
      );
      y += 10;

      // Occupancy & Performance
      if (reportData.occupancy_rate !== undefined || reportData.collection_rate !== undefined) {
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(isEn ? "Performance" : "Rendimiento", margin, y);
        y += 7;

        const perfData = [
          reportData.occupancy_rate !== undefined
            ? [isEn ? "Occupancy Rate" : "Tasa de Ocupación", pct(reportData.occupancy_rate)]
            : null,
          reportData.collection_rate !== undefined
            ? [isEn ? "Collection Rate" : "Tasa de Cobro", pct(reportData.collection_rate)]
            : null,
          reportData.total_units !== undefined
            ? [isEn ? "Total Units" : "Total Unidades", String(reportData.total_units)]
            : null,
          reportData.active_leases !== undefined
            ? [isEn ? "Active Leases" : "Contratos Activos", String(reportData.active_leases)]
            : null,
        ].filter(Boolean) as string[][];

        if (perfData.length > 0) {
          autoTable(doc, {
            startY: y,
            head: [[isEn ? "Metric" : "Métrica", isEn ? "Value" : "Valor"]],
            body: perfData,
            theme: "striped",
            headStyles: { fillColor: [41, 41, 41], fontSize: 9 },
            bodyStyles: { fontSize: 9 },
            columnStyles: { 1: { halign: "right" } },
            margin: { left: margin, right: margin },
          });
        }
      }

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(150);
        const footerY = doc.internal.pageSize.getHeight() - 10;
        doc.text(
          `${isEn ? "Generated by" : "Generado por"} Stoa — ${new Date().toLocaleDateString(locale)}`,
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

      // Download
      const fileName = `${isEn ? "owner-statement" : "estado-cuenta"}-${periodLabel.replace(/\s+/g, "-")}.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={generating}
    >
      {generating ? (
        <>
          <Spinner size="sm" />
          {isEn ? "Generating..." : "Generando..."}
        </>
      ) : isEn ? (
        "Download PDF"
      ) : (
        "Descargar PDF"
      )}
    </Button>
  );
}
