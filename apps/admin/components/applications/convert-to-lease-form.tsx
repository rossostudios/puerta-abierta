"use client";

import { useState } from "react";

import { convertApplicationToLeaseAction } from "@/app/(admin)/module/applications/actions";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";

export function ConvertToLeaseInlineForm({
  applicationId,
  nextPath,
  defaultStartDate,
  locale,
  isEn,
  onOptimisticConvert,
}: {
  applicationId: string;
  nextPath: string;
  defaultStartDate: string;
  locale: "es-PY" | "en-US";
  isEn: boolean;
  onOptimisticConvert?: () => void;
}) {
  const [startsOn, setStartsOn] = useState(defaultStartDate);
  const [platformFee, setPlatformFee] = useState("0");

  return (
    <form
      action={convertApplicationToLeaseAction}
      className="flex flex-wrap items-center gap-2"
      onSubmit={onOptimisticConvert}
    >
      <input name="application_id" type="hidden" value={applicationId} />
      <input name="next" type="hidden" value={nextPath} />

      <DatePicker
        className="h-8 min-w-[8.75rem] text-xs"
        locale={locale}
        name="starts_on"
        onValueChange={setStartsOn}
        value={startsOn}
      />

      <Input
        className="h-8 w-[4.75rem] text-xs"
        inputMode="decimal"
        min={0}
        name="platform_fee"
        onChange={(event) => setPlatformFee(event.target.value)}
        step="0.01"
        type="number"
        value={platformFee}
      />

      <Button disabled={!startsOn} size="sm" type="submit" variant="outline">
        {isEn ? "Convert to lease" : "Convertir a contrato"}
      </Button>
    </form>
  );
}
