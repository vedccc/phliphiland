// Routing for "AI couldn't answer" texts (Sub-Workflow D). Each escalated
// question is classified General / Cleaning / Maintenance, and texted to the
// recipients ticked for that category plus those ticked for All.
import type { WeeklySchedule } from "./schedule.js";

export type KbCategory = "general" | "cleaning" | "maintenance";

export const KB_CATEGORY_LABEL: Record<KbCategory, string> = {
  general: "General",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
};

export interface KbGapRecipient {
  id: string;
  name: string;
  phone: string;
  receives_kb_gaps: boolean; // "All"
  receives_kb_general: boolean;
  receives_kb_cleaning: boolean;
  receives_kb_maintenance: boolean;
  schedule?: WeeklySchedule | null; // null = any time (see onDuty)
}

// The classifier answers with one word; anything else is treated as general.
export function parseKbCategory(text: string): KbCategory {
  const word = (text ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return word === "cleaning" || word === "maintenance" ? word : "general";
}

const FLAG: Record<KbCategory, keyof KbGapRecipient> = {
  general: "receives_kb_general",
  cleaning: "receives_kb_cleaning",
  maintenance: "receives_kb_maintenance",
};

// All + the category's recipients. If nobody is ticked for a non-general
// category, the General recipients get it instead, so no escalation is silent.
export function selectKbGapRecipients<T extends KbGapRecipient>(recipients: T[], category: KbCategory): T[] {
  const forCategory = recipients.filter((r) => r[FLAG[category]]);
  const fallback = category !== "general" && forCategory.length === 0
    ? recipients.filter((r) => r.receives_kb_general)
    : [];
  const chosen = [...recipients.filter((r) => r.receives_kb_gaps), ...forCategory, ...fallback];
  return chosen.filter((r, i) => chosen.findIndex((x) => x.id === r.id) === i);
}

export function kbGapSmsBody(propertyName: string, guestQuestion: string, category: KbCategory): string {
  return `⚠️ AI couldn't answer (${KB_CATEGORY_LABEL[category]}) at ${propertyName}: "${guestQuestion}". 8hr cooldown active. Please respond manually.`;
}
