"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { authedFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { ActionConfigForm } from "../workflow-rules/action-config-forms";
import {
  type ConditionGroup,
  ConditionTreeBuilder,
  deserializeConditions,
  serializeConditions,
} from "./condition-tree-builder";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIGGER_EVENTS = [
  { value: "reservation_confirmed", label: "Reservation confirmed" },
  { value: "checked_in", label: "Checked in" },
  { value: "checked_out", label: "Checked out" },
  { value: "lease_created", label: "Lease created" },
  { value: "lease_activated", label: "Lease activated" },
  { value: "collection_overdue", label: "Collection overdue" },
  { value: "application_received", label: "Application received" },
  { value: "maintenance_submitted", label: "Maintenance submitted" },
  { value: "task_completed", label: "Task completed" },
  { value: "payment_received", label: "Payment received" },
  { value: "lease_expiring", label: "Lease expiring" },
  { value: "anomaly_detected", label: "Anomaly detected" },
  { value: "task_overdue_24h", label: "Task overdue (24h)" },
  { value: "application_stalled_48h", label: "Application stalled (48h)" },
  { value: "lease_expiring_30d", label: "Lease expiring (30d)" },
  { value: "owner_statement_ready", label: "Owner statement ready" },
] as const;

const ACTION_TYPES = [
  { value: "create_task", label: "Create task" },
  { value: "assign_task_round_robin", label: "Assign task (round-robin)" },
  { value: "send_notification", label: "Send notification" },
  { value: "send_whatsapp", label: "Send WhatsApp" },
  { value: "update_status", label: "Update status" },
  { value: "create_expense", label: "Create expense" },
  { value: "run_agent_playbook", label: "Run agent playbook" },
  { value: "request_agent_approval", label: "Request agent approval" },
] as const;

type TriggerNodeData = {
  nodeKind: "trigger";
  triggerEvent: string;
  label: string;
};

type ConditionNodeData = {
  nodeKind: "condition";
  label: string;
  conditionTree: ConditionGroup;
};

type ActionNodeData = {
  nodeKind: "action";
  actionType: string;
  label: string;
  actionConfig: Record<string, unknown>;
  delayMinutes: number;
};

type FlowNodeData = TriggerNodeData | ConditionNodeData | ActionNodeData;

type FlowNode = Node<FlowNodeData>;
type FlowEdge = Edge;

// ---------------------------------------------------------------------------
// Custom node components
// ---------------------------------------------------------------------------

function TriggerNode({ data, selected }: NodeProps<Node<TriggerNodeData>>) {
  return (
    <div
      className={cn(
        "min-w-[180px] rounded-xl border-2 bg-emerald-50 px-4 py-3 text-center shadow-sm transition-shadow dark:bg-emerald-950/40",
        selected
          ? "border-emerald-500 shadow-md"
          : "border-emerald-300 dark:border-emerald-700"
      )}
    >
      <div className="mb-1 font-semibold text-[10px] text-emerald-700 uppercase tracking-wider dark:text-emerald-400">
        Trigger
      </div>
      <div className="font-medium text-sm">{data.label}</div>
      <Handle
        className="!bg-emerald-500 !h-3 !w-3 !border-2 !border-white dark:!border-gray-900"
        position={Position.Bottom}
        type="source"
      />
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps<Node<ConditionNodeData>>) {
  const count = data.conditionTree?.conditions?.length ?? 0;
  return (
    <div
      className={cn(
        "min-w-[180px] rounded-xl border-2 bg-amber-50 px-4 py-3 text-center shadow-sm transition-shadow dark:bg-amber-950/40",
        selected
          ? "border-amber-500 shadow-md"
          : "border-amber-300 dark:border-amber-700"
      )}
    >
      <Handle
        className="!bg-amber-500 !h-3 !w-3 !border-2 !border-white dark:!border-gray-900"
        position={Position.Top}
        type="target"
      />
      <div className="mb-1 font-semibold text-[10px] text-amber-700 uppercase tracking-wider dark:text-amber-400">
        Condition
      </div>
      <div className="font-medium text-sm">{data.label}</div>
      {count > 0 && (
        <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
          {count} rule{count !== 1 ? "s" : ""}
        </div>
      )}
      <Handle
        className="!bg-amber-500 !h-3 !w-3 !border-2 !border-white dark:!border-gray-900"
        position={Position.Bottom}
        type="source"
      />
    </div>
  );
}

function ActionNode({ data, selected }: NodeProps<Node<ActionNodeData>>) {
  return (
    <div
      className={cn(
        "min-w-[180px] rounded-xl border-2 bg-blue-50 px-4 py-3 text-center shadow-sm transition-shadow dark:bg-blue-950/40",
        selected
          ? "border-blue-500 shadow-md"
          : "border-blue-300 dark:border-blue-700"
      )}
    >
      <Handle
        className="!bg-blue-500 !h-3 !w-3 !border-2 !border-white dark:!border-gray-900"
        position={Position.Top}
        type="target"
      />
      <div className="mb-1 font-semibold text-[10px] text-blue-700 uppercase tracking-wider dark:text-blue-400">
        Action
      </div>
      <div className="font-medium text-sm">{data.label}</div>
      {data.delayMinutes > 0 && (
        <div className="mt-1 text-[10px] text-blue-600 dark:text-blue-400">
          delay: {data.delayMinutes}m
        </div>
      )}
      <Handle
        className="!bg-blue-500 !h-3 !w-3 !border-2 !border-white dark:!border-gray-900"
        position={Position.Bottom}
        type="source"
      />
    </div>
  );
}

const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
};

// ---------------------------------------------------------------------------
// Palette (left sidebar)
// ---------------------------------------------------------------------------

type PaletteItem = {
  kind: "trigger" | "condition" | "action";
  value: string;
  label: string;
};

function PaletteSidebar({
  isEn,
  onDragStart,
}: {
  isEn: boolean;
  onDragStart: (item: PaletteItem) => void;
}) {
  const [search, setSearch] = useState("");
  const lowerSearch = search.toLowerCase();

  const triggerItems: PaletteItem[] = TRIGGER_EVENTS.map((t) => ({
    kind: "trigger",
    value: t.value,
    label: t.label,
  }));

  const conditionItems: PaletteItem[] = [
    { kind: "condition", value: "and", label: "AND condition" },
    { kind: "condition", value: "or", label: "OR condition" },
  ];

  const actionItems: PaletteItem[] = ACTION_TYPES.map((a) => ({
    kind: "action",
    value: a.value,
    label: a.label,
  }));

  const filterItems = (items: PaletteItem[]) =>
    lowerSearch
      ? items.filter((i) => i.label.toLowerCase().includes(lowerSearch))
      : items;

  const renderSection = (
    title: string,
    items: PaletteItem[],
    color: string
  ) => {
    const filtered = filterItems(items);
    if (filtered.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <div
          className={cn(
            "font-semibold text-[10px] uppercase tracking-wider",
            color
          )}
        >
          {title}
        </div>
        {filtered.map((item) => (
          <div
            className={cn(
              "cursor-grab rounded-lg border px-2.5 py-1.5 text-xs transition-colors active:cursor-grabbing",
              item.kind === "trigger" &&
                "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60",
              item.kind === "condition" &&
                "border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:hover:bg-amber-950/60",
              item.kind === "action" &&
                "border-blue-200 bg-blue-50 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:hover:bg-blue-950/60"
            )}
            draggable
            key={`${item.kind}-${item.value}`}
            onDragStart={(e) => {
              e.dataTransfer.setData(
                "application/casaora-node",
                JSON.stringify(item)
              );
              e.dataTransfer.effectAllowed = "move";
              onDragStart(item);
            }}
          >
            {item.label}
          </div>
        ))}
      </div>
    );
  };

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r bg-muted/30 p-3">
      <div className="font-semibold text-sm">
        {isEn ? "Node Palette" : "Paleta de Nodos"}
      </div>
      <Input
        className="h-7 text-xs"
        onChange={(e) => setSearch(e.target.value)}
        placeholder={isEn ? "Search nodes..." : "Buscar nodos..."}
        value={search}
      />
      {renderSection(
        isEn ? "Triggers" : "Disparadores",
        triggerItems,
        "text-emerald-600 dark:text-emerald-400"
      )}
      {renderSection(
        isEn ? "Conditions" : "Condiciones",
        conditionItems,
        "text-amber-600 dark:text-amber-400"
      )}
      {renderSection(
        isEn ? "Actions" : "Acciones",
        actionItems,
        "text-blue-600 dark:text-blue-400"
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Node config panel (right sheet)
// ---------------------------------------------------------------------------

function NodeConfigPanel({
  node,
  open,
  onClose,
  onUpdate,
  isEn,
}: {
  node: FlowNode | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<FlowNodeData>) => void;
  isEn: boolean;
}) {
  if (!node) return null;

  const data = node.data;

  return (
    <Sheet
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      open={open}
      title={isEn ? `Configure: ${data.label}` : `Configurar: ${data.label}`}
    >
      <div className="space-y-4">
        {/* Label */}
        <label className="space-y-1 text-sm">
          <span className="font-medium">
            {isEn ? "Node label" : "Etiqueta"}
          </span>
          <Input
            onChange={(e) =>
              onUpdate(node.id, {
                label: e.target.value,
              } as Partial<FlowNodeData>)
            }
            value={data.label}
          />
        </label>

        {/* Trigger config */}
        {data.nodeKind === "trigger" && (
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              {isEn ? "Trigger event" : "Evento disparador"}
            </span>
            <Select
              onChange={(e) =>
                onUpdate(node.id, {
                  triggerEvent: e.target.value,
                  label:
                    TRIGGER_EVENTS.find((t) => t.value === e.target.value)
                      ?.label ?? e.target.value,
                } as Partial<TriggerNodeData>)
              }
              value={data.triggerEvent}
            >
              {TRIGGER_EVENTS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </label>
        )}

        {/* Condition config */}
        {data.nodeKind === "condition" && (
          <ConditionTreeBuilder
            isEn={isEn}
            onChange={(tree) =>
              onUpdate(node.id, {
                conditionTree: tree,
              } as Partial<ConditionNodeData>)
            }
            value={data.conditionTree}
          />
        )}

        {/* Action config */}
        {data.nodeKind === "action" && (
          <>
            <label className="space-y-1 text-sm">
              <span className="font-medium">
                {isEn ? "Action type" : "Tipo de accion"}
              </span>
              <Select
                onChange={(e) =>
                  onUpdate(node.id, {
                    actionType: e.target.value,
                    label:
                      ACTION_TYPES.find((a) => a.value === e.target.value)
                        ?.label ?? e.target.value,
                    actionConfig: {},
                  } as Partial<ActionNodeData>)
                }
                value={data.actionType}
              >
                {ACTION_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="font-medium">
                {isEn ? "Delay (minutes)" : "Retraso (minutos)"}
              </span>
              <Input
                min="0"
                onChange={(e) =>
                  onUpdate(node.id, {
                    delayMinutes: Math.max(0, Number(e.target.value) || 0),
                  } as Partial<ActionNodeData>)
                }
                type="number"
                value={String(data.delayMinutes)}
              />
            </label>

            <div className="space-y-2">
              <span className="font-medium text-sm">
                {isEn ? "Action configuration" : "Configuracion de la accion"}
              </span>
              <ActionConfigForm
                actionType={data.actionType}
                isEn={isEn}
                onChange={(cfg) =>
                  onUpdate(node.id, {
                    actionConfig: cfg,
                  } as Partial<ActionNodeData>)
                }
                value={data.actionConfig}
              />
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Serialization: Visual graph → workflow_rules table format
// ---------------------------------------------------------------------------

type WorkflowRulePayload = {
  id?: string;
  organization_id: string;
  name: string;
  trigger_event: string;
  conditions: Record<string, unknown> | null;
  action_type: string;
  action_config: Record<string, unknown>;
  delay_minutes: number;
  is_active: boolean;
};

function serializeGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  orgId: string,
  ruleName: string,
  ruleId?: string
): WorkflowRulePayload | null {
  // Find the trigger node (first trigger in the graph)
  const triggerNode = nodes.find((n) => n.data.nodeKind === "trigger");
  if (!triggerNode) return null;

  // Follow edges from trigger to find condition(s) and action(s)
  let currentId = triggerNode.id;
  let conditions: Record<string, unknown> | null = null;
  let actionNode: FlowNode | null = null;

  // BFS through the graph from trigger
  const visited = new Set<string>();
  const queue = [currentId];
  visited.add(currentId);

  while (queue.length > 0) {
    currentId = queue.shift()!;
    const outEdges = edges.filter((e) => e.source === currentId);

    for (const edge of outEdges) {
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);

      const targetNode = nodes.find((n) => n.id === edge.target);
      if (!targetNode) continue;

      if (targetNode.data.nodeKind === "condition") {
        const condData = targetNode.data as ConditionNodeData;
        const serialized = serializeConditions(condData.conditionTree);
        if (serialized) {
          // Merge conditions with AND if there are multiple
          if (conditions) {
            conditions = {
              op: "and",
              conditions: [conditions, serialized],
            };
          } else {
            conditions = serialized;
          }
        }
        queue.push(targetNode.id);
      }

      if (targetNode.data.nodeKind === "action") {
        // Take the first action node found
        if (!actionNode) {
          actionNode = targetNode;
        }
        queue.push(targetNode.id);
      }

      if (targetNode.data.nodeKind === "trigger") {
        queue.push(targetNode.id);
      }
    }
  }

  if (!actionNode) return null;
  const actionData = actionNode.data as ActionNodeData;
  const triggerData = triggerNode.data as TriggerNodeData;

  return {
    ...(ruleId ? { id: ruleId } : {}),
    organization_id: orgId,
    name: ruleName || `${triggerData.label} -> ${actionData.label}`,
    trigger_event: triggerData.triggerEvent,
    conditions,
    action_type: actionData.actionType,
    action_config: actionData.actionConfig,
    delay_minutes: actionData.delayMinutes,
    is_active: true,
  };
}

// ---------------------------------------------------------------------------
// Deserialization: workflow_rules record → visual nodes + edges
// ---------------------------------------------------------------------------

function deserializeRule(
  rule: Record<string, unknown>,
  startY: number
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const ruleId = String(rule.id ?? "");
  const triggerEvent = String(rule.trigger_event ?? "reservation_confirmed");
  const actionType = String(rule.action_type ?? "create_task");
  const delayMinutes =
    typeof rule.delay_minutes === "number" ? rule.delay_minutes : 0;
  const actionConfig =
    rule.action_config && typeof rule.action_config === "object"
      ? (rule.action_config as Record<string, unknown>)
      : {};
  const conditionsRaw = rule.conditions ?? null;

  const triggerId = `trigger-${ruleId}`;
  const triggerLabel =
    TRIGGER_EVENTS.find((t) => t.value === triggerEvent)?.label ?? triggerEvent;

  nodes.push({
    id: triggerId,
    type: "trigger",
    position: { x: 300, y: startY },
    data: {
      nodeKind: "trigger",
      triggerEvent,
      label: triggerLabel,
    },
  });

  let lastNodeId = triggerId;
  let yOffset = startY + 120;

  // Add condition node if conditions exist
  const condTree = deserializeConditions(conditionsRaw);
  if (condTree) {
    const condId = `condition-${ruleId}`;
    const condGroup: ConditionGroup =
      "op" in condTree
        ? (condTree as ConditionGroup)
        : { op: "and", conditions: [condTree] };

    nodes.push({
      id: condId,
      type: "condition",
      position: { x: 300, y: yOffset },
      data: {
        nodeKind: "condition",
        label: `${condGroup.op.toUpperCase()} condition`,
        conditionTree: condGroup,
      },
    });

    edges.push({
      id: `edge-${lastNodeId}-${condId}`,
      source: lastNodeId,
      target: condId,
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: true,
    });

    lastNodeId = condId;
    yOffset += 120;
  }

  // Add action node
  const actionId = `action-${ruleId}`;
  const actionLabel =
    ACTION_TYPES.find((a) => a.value === actionType)?.label ?? actionType;

  nodes.push({
    id: actionId,
    type: "action",
    position: { x: 300, y: yOffset },
    data: {
      nodeKind: "action",
      actionType,
      label: actionLabel,
      actionConfig,
      delayMinutes,
    },
  });

  edges.push({
    id: `edge-${lastNodeId}-${actionId}`,
    source: lastNodeId,
    target: actionId,
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: true,
  });

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Main canvas
// ---------------------------------------------------------------------------

let nodeIdCounter = 0;
function nextNodeId(): string {
  nodeIdCounter += 1;
  return `node-${Date.now()}-${nodeIdCounter}`;
}

function VisualBuilderCanvas({
  orgId,
  isEn,
  initialRules,
}: {
  orgId: string;
  isEn: boolean;
  initialRules: Record<string, unknown>[];
}) {
  // Deserialize existing rules into nodes/edges
  const initialState = useMemo(() => {
    const allNodes: FlowNode[] = [];
    const allEdges: FlowEdge[] = [];
    let yOffset = 50;

    for (const rule of initialRules) {
      const { nodes, edges } = deserializeRule(rule, yOffset);
      allNodes.push(...nodes);
      allEdges.push(...edges);
      yOffset += (nodes.length + 1) * 130;
    }

    return { nodes: allNodes, edges: allEdges };
  }, [initialRules]);

  const [nodes, setNodes] = useState<FlowNode[]>(initialState.nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(initialState.edges);
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const dragItemRef = useRef<PaletteItem | null>(null);

  // React Flow callbacks
  const onNodesChange: OnNodesChange<FlowNode> = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange: OnEdgesChange<FlowEdge> = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            markerEnd: { type: MarkerType.ArrowClosed },
            animated: true,
          },
          eds
        )
      ),
    []
  );

  // Click node to open config
  const onNodeClick = useCallback((_: React.MouseEvent, node: FlowNode) => {
    setSelectedNode(node);
    setConfigOpen(true);
  }, []);

  // Update node data from config panel
  const handleUpdateNodeData = useCallback(
    (id: string, partial: Partial<FlowNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, ...partial } as FlowNodeData }
            : n
        )
      );
      // Also update selected node reference
      setSelectedNode((prev) =>
        prev && prev.id === id
          ? { ...prev, data: { ...prev.data, ...partial } as FlowNodeData }
          : prev
      );
    },
    []
  );

  // Drag-and-drop from palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/casaora-node");
      if (!raw) return;

      let item: PaletteItem;
      try {
        item = JSON.parse(raw) as PaletteItem;
      } catch {
        return;
      }

      const position: XYPosition = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const id = nextNodeId();

      let newNode: FlowNode;
      switch (item.kind) {
        case "trigger":
          newNode = {
            id,
            type: "trigger",
            position,
            data: {
              nodeKind: "trigger",
              triggerEvent: item.value,
              label: item.label,
            },
          };
          break;
        case "condition":
          newNode = {
            id,
            type: "condition",
            position,
            data: {
              nodeKind: "condition",
              label: `${item.value.toUpperCase()} condition`,
              conditionTree: {
                op: item.value as "and" | "or",
                conditions: [{ field: "", operator: "equals", value: "" }],
              },
            },
          };
          break;
        case "action":
          newNode = {
            id,
            type: "action",
            position,
            data: {
              nodeKind: "action",
              actionType: item.value,
              label: item.label,
              actionConfig: {},
              delayMinutes: 0,
            },
          };
          break;
        default:
          return;
      }

      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition]
  );

  // Save handler
  const handleSave = useCallback(async () => {
    const payload = serializeGraph(
      nodes,
      edges,
      orgId,
      ruleName,
      editingRuleId ?? undefined
    );

    if (!payload) {
      toast.error(
        isEn
          ? "Cannot save: please connect a trigger to an action."
          : "No se puede guardar: conecta un disparador a una accion."
      );
      return;
    }

    setSaving(true);
    try {
      if (editingRuleId) {
        await authedFetch(`/workflow-rules/${editingRuleId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: payload.name,
            trigger_event: payload.trigger_event,
            conditions: payload.conditions,
            action_type: payload.action_type,
            action_config: payload.action_config,
            delay_minutes: payload.delay_minutes,
          }),
        });
        toast.success(isEn ? "Rule updated" : "Regla actualizada");
      } else {
        await authedFetch("/workflow-rules", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success(isEn ? "Rule created" : "Regla creada");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save rule";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, orgId, ruleName, editingRuleId, isEn]);

  // Clear canvas
  const handleClear = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);
    setConfigOpen(false);
    setRuleName("");
    setEditingRuleId(null);
  }, []);

  // Delete selected nodes
  const handleDeleteSelected = useCallback(() => {
    const selectedIds = new Set(
      nodes.filter((n) => n.selected).map((n) => n.id)
    );
    if (selectedIds.size === 0) return;

    setNodes((nds) => nds.filter((n) => !selectedIds.has(n.id)));
    setEdges((eds) =>
      eds.filter(
        (e) => !(selectedIds.has(e.source) || selectedIds.has(e.target))
      )
    );
    setSelectedNode(null);
    setConfigOpen(false);
  }, [nodes]);

  // Load existing rule for editing
  const handleLoadRule = useCallback((rule: Record<string, unknown>) => {
    const { nodes: ruleNodes, edges: ruleEdges } = deserializeRule(rule, 50);
    setNodes(ruleNodes);
    setEdges(ruleEdges);
    setRuleName(String(rule.name ?? ""));
    setEditingRuleId(String(rule.id ?? ""));
    setSelectedNode(null);
    setConfigOpen(false);
  }, []);

  return (
    <div className="flex h-[600px] flex-col overflow-hidden rounded-xl border">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Input
          className="h-8 w-52 text-xs"
          onChange={(e) => setRuleName(e.target.value)}
          placeholder={isEn ? "Rule name..." : "Nombre de la regla..."}
          value={ruleName}
        />
        <Button disabled={saving} onClick={handleSave} size="sm" type="button">
          {saving
            ? isEn
              ? "Saving..."
              : "Guardando..."
            : editingRuleId
              ? isEn
                ? "Update Rule"
                : "Actualizar Regla"
              : isEn
                ? "Save Rule"
                : "Guardar Regla"}
        </Button>
        <Button
          onClick={handleDeleteSelected}
          size="sm"
          type="button"
          variant="outline"
        >
          {isEn ? "Delete Selected" : "Eliminar Seleccionado"}
        </Button>
        <Button onClick={handleClear} size="sm" type="button" variant="ghost">
          {isEn ? "Clear Canvas" : "Limpiar Canvas"}
        </Button>

        {editingRuleId && (
          <Badge className="text-[10px]" variant="secondary">
            {isEn ? "Editing:" : "Editando:"} {editingRuleId.slice(0, 8)}...
          </Badge>
        )}

        {/* Quick-load existing rules */}
        {initialRules.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            <span className="text-muted-foreground text-xs">
              {isEn ? "Load rule:" : "Cargar regla:"}
            </span>
            <Select
              className="h-8 w-44 text-xs"
              onChange={(e) => {
                const rule = initialRules.find(
                  (r) => String(r.id) === e.target.value
                );
                if (rule) handleLoadRule(rule);
              }}
              value=""
            >
              <option value="">{isEn ? "Select..." : "Seleccionar..."}</option>
              {initialRules.map((r) => (
                <option key={String(r.id)} value={String(r.id)}>
                  {String(r.name ?? r.id)}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {/* Main area: palette + canvas */}
      <div className="flex flex-1 overflow-hidden">
        <PaletteSidebar
          isEn={isEn}
          onDragStart={(item) => {
            dragItemRef.current = item;
          }}
        />

        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlow<FlowNode, FlowEdge>
            edges={edges}
            fitView
            nodes={nodes}
            nodeTypes={nodeTypes}
            onConnect={onConnect}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onNodesChange={onNodesChange}
            proOptions={{ hideAttribution: true }}
            snapGrid={[16, 16]}
            snapToGrid
          />
        </div>
      </div>

      {/* Config panel (right sheet) */}
      <NodeConfigPanel
        isEn={isEn}
        node={selectedNode}
        onClose={() => {
          setConfigOpen(false);
          setSelectedNode(null);
        }}
        onUpdate={handleUpdateNodeData}
        open={configOpen}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported wrapper with provider
// ---------------------------------------------------------------------------

type VisualBuilderProps = {
  orgId: string;
  locale: string;
  initialRules: Record<string, unknown>[];
};

export function VisualBuilder({
  orgId,
  locale,
  initialRules,
}: VisualBuilderProps) {
  const isEn = locale === "en-US";

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {isEn
          ? "Drag trigger, condition, and action nodes from the palette onto the canvas. Connect them with edges, configure each node, then save as a workflow rule."
          : "Arrastra nodos de disparador, condicion y accion desde la paleta al canvas. Conectalos con bordes, configura cada nodo, y guarda como regla de automatizacion."}
      </p>
      <ReactFlowProvider>
        <VisualBuilderCanvas
          initialRules={initialRules}
          isEn={isEn}
          orgId={orgId}
        />
      </ReactFlowProvider>
    </div>
  );
}
