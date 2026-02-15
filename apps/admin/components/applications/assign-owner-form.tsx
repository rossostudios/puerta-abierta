"use client";

import { useMemo, useState } from "react";

import { assignApplicationAction } from "@/app/(admin)/module/applications/actions";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

export function AssignOwnerForm({
  applicationId,
  status,
  assignedUserId,
  assignedUserName,
  memberOptions,
  nextPath,
  isEn,
  onOptimisticAssign,
}: {
  applicationId: string;
  status: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  memberOptions: ComboboxOption[];
  nextPath: string;
  isEn: boolean;
  onOptimisticAssign?: (assignment: {
    assignedUserId: string | null;
    assignedUserName: string | null;
  }) => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState(
    assignedUserId ?? "__unassigned__"
  );

  const optionLabelByValue = useMemo(() => {
    const index = new Map(
      memberOptions.map((option) => [option.value, option.label] as const)
    );
    return index;
  }, [memberOptions]);

  return (
    <form
      action={assignApplicationAction}
      className="space-y-2"
      onSubmit={() => {
        const nextAssignedUserId =
          selectedUserId === "__unassigned__" ? null : selectedUserId;
        const nextAssignedUserName =
          selectedUserId === "__unassigned__"
            ? null
            : (optionLabelByValue.get(selectedUserId) ??
              assignedUserName ??
              null);
        onOptimisticAssign?.({
          assignedUserId: nextAssignedUserId,
          assignedUserName: nextAssignedUserName,
        });
      }}
    >
      <input name="application_id" type="hidden" value={applicationId} />
      <input name="status" type="hidden" value={status} />
      <input name="next" type="hidden" value={nextPath} />
      <input
        name="note"
        type="hidden"
        value={isEn ? "Assignment updated" : "Asignación actualizada"}
      />

      <Combobox
        className="h-8 text-xs"
        emptyLabel={isEn ? "No members found" : "Sin miembros"}
        name="assigned_user_id"
        onValueChange={setSelectedUserId}
        options={memberOptions}
        placeholder={isEn ? "Select owner" : "Seleccionar responsable"}
        searchPlaceholder={isEn ? "Search member..." : "Buscar miembro..."}
        value={selectedUserId}
      />

      <Button className="w-full" size="sm" type="submit" variant="outline">
        {isEn ? "Update owner" : "Actualizar responsable"}
      </Button>
    </form>
  );
}
