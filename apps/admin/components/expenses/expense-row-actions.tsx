"use client";

import { Delete02Icon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { deleteExpenseAction } from "@/app/(admin)/module/expenses/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import type { ExpenseRow } from "@/lib/features/expenses/types";
import { asString } from "@/lib/features/expenses/utils";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export function ExpenseRowActions({
  row,
  nextPath,
  canManage,
  onEdit,
}: {
  row: ExpenseRow;
  nextPath: string;
  canManage: boolean;
  onEdit: (row: ExpenseRow) => void;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const id = asString(row.id).trim();
  if (!id) return null;

  return (
    <div className="flex items-center justify-end gap-2">
      <Link
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        href={`/module/expenses/${encodeURIComponent(id)}`}
      >
        {isEn ? "Open" : "Abrir"}
      </Link>
      {canManage ? (
        <Button
          onClick={() => onEdit(row)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Icon icon={PencilEdit01Icon} size={16} />
          <span className="sr-only">{isEn ? "Edit" : "Editar"}</span>
        </Button>
      ) : null}
      {canManage ? (
        <Form action={deleteExpenseAction}>
          <input name="expense_id" type="hidden" value={id} />
          <input name="next" type="hidden" value={nextPath} />
          <Button size="sm" type="submit" variant="ghost">
            <Icon icon={Delete02Icon} size={16} />
            <span className="sr-only">{isEn ? "Delete" : "Eliminar"}</span>
          </Button>
        </Form>
      ) : null}
    </div>
  );
}
