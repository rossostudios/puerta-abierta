import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type MarketplaceApplyFeedbackProps = {
  isEn: boolean;
  isSubmitting: boolean;
  error: string | null;
  successId: string | null;
};

export function MarketplaceApplyFeedback({
  isEn,
  isSubmitting,
  error,
  successId,
}: MarketplaceApplyFeedbackProps) {
  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>
            {isEn ? "Could not submit application" : "No se pudo enviar la aplicación"}
          </AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}

      {successId ? (
        <Alert variant="success">
          <AlertTitle>
            {isEn
              ? "Application submitted successfully."
              : "Aplicación enviada correctamente."}
          </AlertTitle>
          <AlertDescription className="mt-1 text-xs">
            ID: <span className="font-mono">{successId}</span>
          </AlertDescription>
        </Alert>
      ) : null}

      <Button className="w-full sm:w-auto" disabled={isSubmitting} type="submit">
        {isSubmitting
          ? isEn
            ? "Submitting..."
            : "Enviando..."
          : isEn
            ? "Submit application"
            : "Enviar aplicación"}
      </Button>
    </>
  );
}
