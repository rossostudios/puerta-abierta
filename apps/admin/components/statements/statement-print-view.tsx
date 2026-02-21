"use client";

import { CasaoraLogo } from "@/components/ui/casaora-logo";
import { formatCurrency } from "@/lib/format";

type LineItem = {
  id: string;
  label: string;
  amount: number;
};

type TaxSummary = {
  managementFee?: number;
  ivaRatePct?: number;
  ivaAmount?: number;
  irpApplicable?: boolean;
};

type StatementPrintViewProps = {
  orgName: string;
  periodLabel: string;
  generatedAt: string;
  currency: string;
  locale: string;
  collections: LineItem[];
  expenses: LineItem[];
  totalRevenue: number;
  totalExpenses: number;
  netPayout: number;
  taxSummary?: TaxSummary | null;
};

export function StatementPrintView({
  orgName,
  periodLabel,
  generatedAt,
  currency,
  locale,
  collections,
  expenses,
  totalRevenue,
  totalExpenses,
  netPayout,
  taxSummary,
}: StatementPrintViewProps) {
  const isEn = locale === "en-US";
  const fmt = (v: number) => formatCurrency(v, currency, locale);

  return (
    <div className="statement-print mx-auto max-w-3xl p-8 font-sans text-gray-900 text-sm">
      <style>{`
        @media print {
          body { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .statement-print { max-width: 100%; padding: 24px; }
        }
      `}</style>

      {/* Header */}
      <div className="mb-8 flex items-center justify-between border-b pb-6">
        <div className="flex items-center gap-3">
          <CasaoraLogo size={32} />
          <div>
            <h1 className="font-bold text-lg">Casaora</h1>
            <p className="text-gray-500 text-xs">{orgName}</p>
          </div>
        </div>
        <div className="text-right">
          <h2 className="font-semibold text-base">
            {isEn ? "Owner Statement" : "Estado de Cuenta"}
          </h2>
          <p className="text-gray-500 text-xs">{periodLabel}</p>
          <p className="text-gray-400 text-xs">
            {isEn ? "Generated" : "Generado"}: {generatedAt}
          </p>
        </div>
      </div>

      {/* Revenue / Collections */}
      <section className="mb-6">
        <h3 className="mb-2 font-semibold text-gray-500 text-xs uppercase tracking-wide">
          {isEn ? "Revenue / Collections" : "Ingresos / Cobros"}
        </h3>
        {collections.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500 text-xs">
                <th className="pb-1 font-medium">
                  {isEn ? "Description" : "Descripcion"}
                </th>
                <th className="pb-1 text-right font-medium">
                  {isEn ? "Amount" : "Monto"}
                </th>
              </tr>
            </thead>
            <tbody>
              {collections.map((item) => (
                <tr className="border-gray-100 border-b" key={item.id}>
                  <td className="py-1.5">{item.label}</td>
                  <td className="py-1.5 text-right">{fmt(item.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="pt-2">
                  {isEn ? "Total Revenue" : "Total Ingresos"}
                </td>
                <td className="pt-2 text-right">{fmt(totalRevenue)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="text-gray-400">
            {isEn
              ? "No collections this period."
              : "Sin cobros en este periodo."}
          </p>
        )}
      </section>

      {/* Expenses */}
      <section className="mb-6">
        <h3 className="mb-2 font-semibold text-gray-500 text-xs uppercase tracking-wide">
          {isEn ? "Expenses" : "Gastos"}
        </h3>
        {expenses.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500 text-xs">
                <th className="pb-1 font-medium">
                  {isEn ? "Description" : "Descripcion"}
                </th>
                <th className="pb-1 text-right font-medium">
                  {isEn ? "Amount" : "Monto"}
                </th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((item) => (
                <tr className="border-gray-100 border-b" key={item.id}>
                  <td className="py-1.5">{item.label}</td>
                  <td className="py-1.5 text-right text-red-600">
                    -{fmt(item.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="pt-2">
                  {isEn ? "Total Expenses" : "Total Gastos"}
                </td>
                <td className="pt-2 text-right text-red-600">
                  -{fmt(totalExpenses)}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="text-gray-400">
            {isEn ? "No expenses this period." : "Sin gastos en este periodo."}
          </p>
        )}
      </section>

      {/* Tax / Fees Summary */}
      {taxSummary &&
        (taxSummary.managementFee || taxSummary.ivaAmount) ? (
          <section className="mb-6">
            <h3 className="mb-2 font-semibold text-gray-500 text-xs uppercase tracking-wide">
              {isEn ? "Fees & Taxes" : "Comisiones e Impuestos"}
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {taxSummary.managementFee ? (
                  <tr className="border-gray-100 border-b">
                    <td className="py-1.5">
                      {isEn ? "Management Fee" : "Comisión de Administración"}
                    </td>
                    <td className="py-1.5 text-right text-red-600">
                      -{fmt(taxSummary.managementFee)}
                    </td>
                  </tr>
                ) : null}
                {taxSummary.ivaAmount ? (
                  <tr className="border-gray-100 border-b">
                    <td className="py-1.5">
                      IVA ({taxSummary.ivaRatePct ?? 10}%)
                    </td>
                    <td className="py-1.5 text-right text-red-600">
                      -{fmt(taxSummary.ivaAmount)}
                    </td>
                  </tr>
                ) : null}
                {taxSummary.irpApplicable ? (
                  <tr className="border-gray-100 border-b">
                    <td className="py-1.5 text-gray-500" colSpan={2}>
                      {isEn
                        ? "IRP applicable — income tracked for annual filing"
                        : "IRP aplicable — ingreso registrado para declaración anual"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ) : null}

      {/* Net Payout */}
      <section className="rounded-lg border-2 border-gray-900 p-4">
        <div className="flex items-center justify-between">
          <span className="font-bold text-base">
            {isEn ? "Net Payout" : "Pago Neto"}
          </span>
          <span className="font-bold text-xl">{fmt(netPayout)}</span>
        </div>
      </section>

      {/* Footer */}
      <div className="mt-8 border-t pt-4 text-center text-gray-400 text-xs">
        <p>Casaora &middot; casaora.co</p>
        <p>
          {isEn
            ? "This document is for informational purposes only."
            : "Este documento es solo para fines informativos."}
        </p>
      </div>
    </div>
  );
}
