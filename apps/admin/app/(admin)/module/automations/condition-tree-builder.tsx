"use client";

import { useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "contains"
  | "in";

export type LeafCondition = {
  field: string;
  operator: ConditionOperator;
  value: string;
};

export type ConditionGroup = {
  op: "and" | "or";
  conditions: ConditionNode[];
};

export type ConditionNode = LeafCondition | ConditionGroup;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isGroup(node: ConditionNode): node is ConditionGroup {
  return "op" in node && "conditions" in node;
}

const OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "greater_than", label: ">" },
  { value: "less_than", label: "<" },
  { value: "contains", label: "contains" },
  { value: "in", label: "in" },
];

function emptyLeaf(): LeafCondition {
  return { field: "", operator: "equals", value: "" };
}

function emptyGroup(): ConditionGroup {
  return { op: "and", conditions: [emptyLeaf()] };
}

// ---------------------------------------------------------------------------
// Serialization helpers (for external use)
// ---------------------------------------------------------------------------

/**
 * Serialize a ConditionNode tree into a JSON-compatible object.
 * Returns null when the tree is empty / has no meaningful content.
 */
export function serializeConditions(
  node: ConditionNode | null
): Record<string, unknown> | null {
  if (!node) return null;

  if (isGroup(node)) {
    const children = node.conditions
      .map((c) => serializeConditions(c))
      .filter(Boolean) as Record<string, unknown>[];
    if (children.length === 0) return null;
    return { op: node.op, conditions: children };
  }

  // Leaf — skip if field is blank
  if (!node.field.trim()) return null;
  return {
    field: node.field,
    operator: node.operator,
    value: node.value,
  };
}

/**
 * Deserialize a JSON object back into ConditionNode tree.
 */
export function deserializeConditions(raw: unknown): ConditionNode | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (obj.op && Array.isArray(obj.conditions)) {
    const op = obj.op === "or" ? "or" : "and";
    const children = (obj.conditions as unknown[])
      .map((c) => deserializeConditions(c))
      .filter(Boolean) as ConditionNode[];
    if (children.length === 0) return null;
    return { op, conditions: children };
  }

  if (typeof obj.field === "string") {
    return {
      field: obj.field as string,
      operator: (obj.operator as ConditionOperator) || "equals",
      value:
        typeof obj.value === "string" ? obj.value : String(obj.value ?? ""),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Leaf editor
// ---------------------------------------------------------------------------

function LeafEditor({
  node,
  onChange,
  onRemove,
  isEn,
}: {
  node: LeafCondition;
  onChange: (n: LeafCondition) => void;
  onRemove: () => void;
  isEn: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="h-8 w-36 text-xs"
        onChange={(e) => onChange({ ...node, field: e.target.value })}
        placeholder={isEn ? "Field name" : "Nombre del campo"}
        value={node.field}
      />
      <Select
        className="h-8 w-28 text-xs"
        onChange={(e) =>
          onChange({ ...node, operator: e.target.value as ConditionOperator })
        }
        value={node.operator}
      >
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </Select>
      <Input
        className="h-8 w-36 text-xs"
        onChange={(e) => onChange({ ...node, value: e.target.value })}
        placeholder={isEn ? "Value" : "Valor"}
        value={node.value}
      />
      <Button
        className="h-7 px-2 text-xs"
        onClick={onRemove}
        size="xs"
        type="button"
        variant="ghost"
      >
        {isEn ? "Remove" : "Quitar"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group editor (recursive)
// ---------------------------------------------------------------------------

function GroupEditor({
  node,
  onChange,
  onRemove,
  depth,
  isEn,
}: {
  node: ConditionGroup;
  onChange: (n: ConditionGroup) => void;
  onRemove: (() => void) | null;
  depth: number;
  isEn: boolean;
}) {
  const updateChild = useCallback(
    (index: number, child: ConditionNode) => {
      const next = [...node.conditions];
      next[index] = child;
      onChange({ ...node, conditions: next });
    },
    [node, onChange]
  );

  const removeChild = useCallback(
    (index: number) => {
      const next = node.conditions.filter((_, i) => i !== index);
      onChange({ ...node, conditions: next });
    },
    [node, onChange]
  );

  const addLeaf = useCallback(() => {
    onChange({ ...node, conditions: [...node.conditions, emptyLeaf()] });
  }, [node, onChange]);

  const addSubgroup = useCallback(() => {
    onChange({ ...node, conditions: [...node.conditions, emptyGroup()] });
  }, [node, onChange]);

  const toggleOp = useCallback(() => {
    onChange({ ...node, op: node.op === "and" ? "or" : "and" });
  }, [node, onChange]);

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-3",
        depth === 0
          ? "border-border bg-muted/20"
          : "border-border/60 border-dashed bg-muted/10"
      )}
    >
      <div className="flex items-center gap-2">
        <button
          className={cn(
            "rounded-md px-2 py-0.5 font-semibold text-xs transition-colors",
            node.op === "and"
              ? "bg-blue-500/15 text-blue-600"
              : "bg-amber-500/15 text-amber-600"
          )}
          onClick={toggleOp}
          type="button"
        >
          {node.op.toUpperCase()}
        </button>
        <span className="text-muted-foreground text-xs">
          {isEn
            ? `Match ${node.op === "and" ? "all" : "any"} of the following`
            : `Coincidir con ${node.op === "and" ? "todas" : "alguna"} de las siguientes`}
        </span>
        {onRemove && (
          <Button
            className="ml-auto h-6 px-2 text-[10px]"
            onClick={onRemove}
            size="xs"
            type="button"
            variant="ghost"
          >
            {isEn ? "Remove group" : "Quitar grupo"}
          </Button>
        )}
      </div>

      {node.conditions.map((child, i) => {
        const key = `${depth}-${i}`;
        if (isGroup(child)) {
          return (
            <GroupEditor
              depth={depth + 1}
              isEn={isEn}
              key={key}
              node={child}
              onChange={(updated) => updateChild(i, updated)}
              onRemove={() => removeChild(i)}
            />
          );
        }
        return (
          <LeafEditor
            isEn={isEn}
            key={key}
            node={child}
            onChange={(updated) => updateChild(i, updated)}
            onRemove={() => removeChild(i)}
          />
        );
      })}

      <div className="flex gap-2 pt-1">
        <Button
          className="h-7 text-xs"
          onClick={addLeaf}
          size="xs"
          type="button"
          variant="outline"
        >
          + {isEn ? "Condition" : "Condicion"}
        </Button>
        <Button
          className="h-7 text-xs"
          onClick={addSubgroup}
          size="xs"
          type="button"
          variant="outline"
        >
          + {isEn ? "Sub-group" : "Sub-grupo"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

type ConditionTreeBuilderProps = {
  value: ConditionGroup;
  onChange: (next: ConditionGroup) => void;
  isEn: boolean;
};

export function ConditionTreeBuilder({
  value,
  onChange,
  isEn,
}: ConditionTreeBuilderProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge className="text-[10px]" variant="outline">
          {isEn ? "Conditions" : "Condiciones"}
        </Badge>
      </div>
      <GroupEditor
        depth={0}
        isEn={isEn}
        node={value}
        onChange={onChange}
        onRemove={null}
      />
    </div>
  );
}
