export type PromptTemplate = {
  label: string;
  prompt: string;
  domain: string;
};

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    label: "Guest check-in",
    prompt:
      "A guest named Maria Gonzalez is arriving today at property Casa Sol. Please prepare a personalized welcome message with check-in instructions and local tips.",
    domain: "guest",
  },
  {
    label: "Maintenance request",
    prompt:
      "The air conditioning unit in Unit 3B at Torre Norte is not cooling properly. Create a maintenance ticket, check vendor availability, and suggest an ETA for the guest.",
    domain: "maintenance",
  },
  {
    label: "Revenue analysis",
    prompt:
      "Show me a revenue summary for the last 30 days across all properties. Highlight any units that are underperforming compared to market rates.",
    domain: "finance",
  },
  {
    label: "Leasing inquiry",
    prompt:
      "I have a prospective tenant interested in a 2-bedroom apartment with a budget of 5,000,000 PYG/month. Find matching available units and prepare a comparison.",
    domain: "leasing",
  },
  {
    label: "Multi-domain review",
    prompt:
      "Give me today's top 5 priorities across all operations: pending check-ins, overdue maintenance tasks, expiring leases, and financial alerts.",
    domain: "multi",
  },
  {
    label: "Guest complaint",
    prompt:
      "A guest at Residencia Park just sent a WhatsApp message saying the hot water is not working and they are unhappy. Draft an empathetic response and escalate to maintenance.",
    domain: "guest",
  },
];
