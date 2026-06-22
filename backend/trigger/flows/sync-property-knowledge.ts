import { task, logger } from "@trigger.dev/sdk";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseClient } from "../helpers/supabase.js";
import { getListingDetails } from "../helpers/guesty.js";
import type { ImportedPropertyRow } from "./import-properties.js";

export interface SyncPropertyKnowledgeInput {
  properties: ImportedPropertyRow[];
}

export interface SyncPropertyKnowledgeResult {
  status: "ok" | "error";
  properties_processed: number;
  qa_pairs_added: number;
  errors: string[];
}

interface QaPair {
  title: string;
  content: string;
  category: string;
}

async function generateQaPairsFromListing(
  propertyName: string,
  raw: unknown,
): Promise<QaPair[]> {
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: `You are converting raw vacation-rental property data into guest-facing Q&A knowledge base entries.

# Goal
Produce a small set (3-15) of common, useful Q&A entries a guest might ask about the property. Examples: "What time is check-in?", "Is parking available?", "What's the WiFi password?", "Are pets allowed?", "What amenities are in the kitchen?".

# Rules
- ONLY use information explicitly present in the raw data. Do NOT invent or assume.
- Skip any topic where the data is missing.
- Write the answers in warm, conversational language a host would use, not as raw spec dumps.
- Use simple categories: "checkin", "checkout", "amenities", "rules", "location", "wifi", "parking", "policies", "general".
- The "title" field should be a question phrased as the guest would ask it.
- If WiFi password is in the data, treat it as one entry.
- Do not include phone numbers, emails, or personal contact details.

# Output
Return a JSON array of objects with shape: {"title": "...", "content": "...", "category": "..."}.
Nothing else. No prose, no markdown fences, no commentary. Just the JSON array.`,
    messages: [
      {
        role: "user",
        content: `Property: ${propertyName}\n\nRaw data:\n${JSON.stringify(raw, null, 2)}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && "text" in textBlock ? textBlock.text.trim() : "";

  // Strip any accidental markdown fence
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((p): p is QaPair =>
      typeof p === "object" && p !== null &&
      typeof (p as any).title === "string" &&
      typeof (p as any).content === "string" &&
      typeof (p as any).category === "string"
    )
    .slice(0, 30);  // hard cap
}

export const syncPropertyKnowledge = task({
  id: "sync-property-knowledge",
  retry: { maxAttempts: 1 },
  run: async (payload: SyncPropertyKnowledgeInput): Promise<SyncPropertyKnowledgeResult> => {
    const supabase = getSupabaseClient();
    const errors: string[] = [];
    let qaPairsAdded = 0;
    let processed = 0;

    for (const prop of payload.properties) {
      try {
        const details = await getListingDetails(prop.guesty_listing_id);
        if (!details) {
          logger.warn("Guesty listing details not found", { guesty_listing_id: prop.guesty_listing_id });
          continue;
        }

        const qa = await generateQaPairsFromListing(prop.name, details);
        if (qa.length === 0) {
          processed++;
          continue;
        }

        // Skip Q&A pairs whose title already exists for this property (avoid duplicates on re-sync)
        const { data: existingTitles } = await supabase
          .from("knowledge_bases")
          .select("title")
          .eq("property_id", prop.id);

        const existingSet = new Set(
          (existingTitles ?? []).map((r) => (r.title as string).toLowerCase().trim())
        );
        const fresh = qa.filter((p) => !existingSet.has(p.title.toLowerCase().trim()));

        if (fresh.length === 0) {
          processed++;
          continue;
        }

        const rows = fresh.map((p) => ({
          property_id: prop.id,
          title: p.title,
          content: p.content,
          category: p.category,
        }));

        const { error: insErr } = await supabase.from("knowledge_bases").insert(rows);
        if (insErr) {
          errors.push(`KB insert for ${prop.name}: ${insErr.message}`);
        } else {
          qaPairsAdded += rows.length;
        }
        processed++;
      } catch (e) {
        errors.push(`${prop.name}: ${String(e)}`);
      }
    }

    logger.info("Knowledge sync complete", { processed, qaPairsAdded, errors: errors.length });
    return {
      status: "ok",
      properties_processed: processed,
      qa_pairs_added: qaPairsAdded,
      errors,
    };
  },
});
