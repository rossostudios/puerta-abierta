"use client";

import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type EditableCellProps = {
  value: string;
  onCommit: (next: string) => Promise<void>;
  displayNode?: ReactNode;
  type?: "text" | "select";
  options?: { label: string; value: string }[];
  className?: string;
};

type CellState = "display" | "editing" | "saving";

export function EditableCell({
  value,
  onCommit,
  displayNode,
  type = "text",
  options,
  className,
}: EditableCellProps) {
  const [state, setState] = useState<CellState>("display");
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (state === "editing") {
      if (type === "select") {
        selectRef.current?.focus();
      } else {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
  }, [state, type]);

  const commit = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (trimmed === value) {
        setState("display");
        return;
      }
      setState("saving");
      try {
        await onCommit(trimmed);
      } finally {
        setState("display");
      }
    },
    [onCommit, value]
  );

  const cancel = useCallback(() => {
    setDraft(value);
    setState("display");
  }, [value]);

  if (state === "display") {
    return (
      <button
        className={cn(
          "group/cell flex w-full min-h-[28px] items-center gap-1.5 rounded px-1 -mx-1 text-left transition-colors hover:bg-primary/[0.04]",
          className
        )}
        onClick={() => setState("editing")}
        type="button"
      >
        <span className="flex-1 truncate">
          {displayNode ?? <span className="text-sm">{value || "\u00A0"}</span>}
        </span>
        <Icon
          className="shrink-0 text-muted-foreground/0 transition-colors group-hover/cell:text-muted-foreground/50"
          icon={PencilEdit02Icon}
          size={12}
        />
      </button>
    );
  }

  if (type === "select" && options) {
    return (
      <select
        className="h-7 w-full rounded border border-ring/40 bg-transparent px-1.5 text-sm outline-none ring-1 ring-ring/20 focus:ring-ring/50"
        onBlur={(e) => commit(e.target.value)}
        onChange={(e) => {
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
        }}
        ref={selectRef}
        value={draft}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className={cn(
        "h-7 w-full rounded border border-ring/40 bg-transparent px-1.5 text-sm outline-none ring-1 ring-ring/20 focus:ring-ring/50",
        state === "saving" && "opacity-60 pointer-events-none"
      )}
      disabled={state === "saving"}
      onBlur={() => commit(draft)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(draft);
        }
        if (e.key === "Escape") cancel();
      }}
      ref={inputRef}
      type="text"
      value={draft}
    />
  );
}
