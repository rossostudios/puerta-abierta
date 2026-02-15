import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchPublicPaymentInfo } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";

type PaymentPageProps = {
  params: Promise<{ reference: string }>;
};

export async function generateMetadata({
  params,
}: PaymentPageProps): Promise<Metadata> {
  const { reference } = await params;
  return {
    title: `Pago | ${reference} | Puerta Abierta`,
    robots: { index: false, follow: false },
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function PublicPaymentPage({ params }: PaymentPageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const { reference } = await params;

  let payment: Record<string, unknown>;
  try {
    payment = await fetchPublicPaymentInfo(reference);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("(404)") || message.includes("(410)")) {
      notFound();
    }
    throw err;
  }

  const amount = asNumber(payment.amount);
  const currency = asString(payment.currency) || "PYG";
  const bankName = asString(payment.bank_name);
  const accountNumber = asString(payment.account_number);
  const accountHolder = asString(payment.account_holder);
  const qrPayloadUrl = asString(payment.qr_payload_url);
  const tenantName = asString(payment.tenant_name);
  const orgName = asString(payment.organization_name);
  const referenceCode = asString(payment.reference_code);
  const expiresAt = asString(payment.expires_at);

  const formattedAmount = formatCurrency(amount, currency, locale);
  const expiresDate = expiresAt
    ? new Date(expiresAt).toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const whatsappText = isEn
    ? `Hi, I've made a payment for reference ${referenceCode} - ${formattedAmount}`
    : `Hola, realicé el pago con referencia ${referenceCode} - ${formattedAmount}`;
  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;

  return (
    <div className="bg-background min-h-dvh">
      <PublicHeader locale={locale} />

      <main className="mx-auto max-w-lg px-4 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">
            {isEn ? "Payment Details" : "Datos de Pago"}
          </h1>
          {orgName && (
            <p className="text-muted-foreground mt-1">{orgName}</p>
          )}
        </div>

        {/* Amount card */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-center text-lg">
              {isEn ? "Amount Due" : "Monto a Pagar"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-primary text-center text-4xl font-bold">
              {formattedAmount}
            </p>
            {tenantName && (
              <p className="text-muted-foreground mt-2 text-center text-sm">
                {tenantName}
              </p>
            )}
            <p className="text-muted-foreground mt-1 text-center font-mono text-xs">
              {isEn ? "Ref:" : "Ref:"} {referenceCode}
            </p>
            {expiresDate && (
              <p className="text-muted-foreground mt-1 text-center text-xs">
                {isEn ? "Expires:" : "Vence:"} {expiresDate}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Bank transfer details */}
        {(bankName || accountNumber) && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {isEn ? "Bank Transfer" : "Transferencia Bancaria"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {bankName && (
                <div>
                  <p className="text-muted-foreground text-xs">
                    {isEn ? "Bank" : "Banco"}
                  </p>
                  <p className="font-medium">{bankName}</p>
                </div>
              )}
              {accountHolder && (
                <div>
                  <p className="text-muted-foreground text-xs">
                    {isEn ? "Account Holder" : "Titular"}
                  </p>
                  <p className="font-medium">{accountHolder}</p>
                </div>
              )}
              {accountNumber && (
                <div>
                  <p className="text-muted-foreground text-xs">
                    {isEn ? "Account Number" : "Nro. de Cuenta"}
                  </p>
                  <p className="font-mono font-medium">{accountNumber}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-xs">
                  {isEn ? "Reference" : "Referencia"}
                </p>
                <p className="font-mono font-medium">{referenceCode}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* QR code */}
        {qrPayloadUrl && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {isEn ? "Pay with QR" : "Pagar con QR"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="QR code for payment"
                className="h-64 w-64 rounded-lg"
                src={qrPayloadUrl}
              />
            </CardContent>
          </Card>
        )}

        {/* WhatsApp share */}
        <div className="flex justify-center">
          <a
            className="bg-[#25D366] hover:bg-[#20BD5A] inline-flex items-center gap-2 rounded-lg px-6 py-3 font-medium text-white transition-colors"
            href={whatsappShareUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <svg
              className="h-5 w-5"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            {isEn
              ? "Share Payment Confirmation"
              : "Compartir Confirmación de Pago"}
          </a>
        </div>

        <p className="text-muted-foreground mt-8 text-center text-xs">
          {isEn
            ? "After making your payment, please include the reference code in your transfer description."
            : "Después de realizar el pago, incluye el código de referencia en la descripción de tu transferencia."}
        </p>
      </main>

      <PublicFooter locale={locale} />
    </div>
  );
}
