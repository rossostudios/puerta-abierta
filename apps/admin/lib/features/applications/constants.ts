import type { BoardLane } from "./types";

export const RESPONSE_SLA_TARGET_MINUTES = 120;

export const BOARD_LANES: BoardLane[] = [
  {
    key: "incoming",
    label: {
      "es-PY": "Ingresos",
      "en-US": "Incoming",
    },
    statuses: ["new", "screening"],
  },
  {
    key: "qualified",
    label: {
      "es-PY": "Calificación",
      "en-US": "Qualified",
    },
    statuses: ["qualified", "visit_scheduled", "offer_sent"],
  },
  {
    key: "converted",
    label: {
      "es-PY": "Convertidos",
      "en-US": "Converted",
    },
    statuses: ["contract_signed"],
  },
  {
    key: "closed",
    label: {
      "es-PY": "Cerrados",
      "en-US": "Closed",
    },
    statuses: ["rejected", "lost"],
  },
];
