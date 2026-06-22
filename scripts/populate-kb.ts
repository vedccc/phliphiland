import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { listListings, getListingDetails } from "../backend/trigger/helpers/guesty.js";

// ─── Config ──────────────────────────────────────────────────────────
// Standalone bulk KB seeder. Pulls listings from Guesty, asks Claude to turn
// each listing's data into guest-facing Q&A, and inserts into knowledge_bases.
// (The property-sync Trigger.dev workflow does the same thing on demand; this
// script is a one-off convenience for backfilling.)

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── Claude Q&A generation ───────────────────────────────────────────

interface QAPair {
  title: string;
  content: string;
  category: string;
}

async function generateQAPairs(propertyName: string, raw: string): Promise<QAPair[]> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are given raw property data for a vacation rental called "${propertyName}". Generate a JSON array of Q&A pairs that a guest might ask.

Each pair must have:
- "title": A natural guest question (e.g. "What's the WiFi password?")
- "content": The answer, written in a friendly host voice. Include all relevant details.
- "category": One of: "general", "check-in", "amenity", "house-rules", "local-tips", "parking"

Guidelines:
- Only use information present in the data — do not invent answers
- Each distinct topic should be its own Q&A pair
- If the data contains specific codes, passwords, or instructions, include them exactly
- Aim for 5-25 Q&A pairs depending on how much information is available
- Write answers as if you are the host speaking to a guest

Respond with ONLY a valid JSON array, no other text.

--- RAW PROPERTY DATA ---
${raw}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Failed to parse Q&A JSON for ${propertyName}`);
  return JSON.parse(jsonMatch[0]);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching listings from Guesty...");
  const listings = await listListings();
  console.log(`Found ${listings.length} listings in Guesty`);

  // Map Guesty listing _id → our Supabase property row
  const { data: supaProperties, error: spError } = await supabase
    .from("properties")
    .select("id, name, guesty_listing_id");
  if (spError) throw new Error(`Supabase query failed: ${spError.message}`);

  const supaMap = new Map((supaProperties ?? []).map((p) => [p.guesty_listing_id, p]));

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const summary of listings) {
    const sp = supaMap.get(summary._id);
    if (!sp) {
      console.log(`  SKIP: "${summary.nickname || summary.title || summary._id}" — not synced to Supabase`);
      totalSkipped++;
      continue;
    }

    // Skip if KB already populated for this property
    const { count } = await supabase
      .from("knowledge_bases")
      .select("id", { count: "exact", head: true })
      .eq("property_id", sp.id);
    if (count && count > 0) {
      console.log(`  SKIP: "${sp.name}" — already has ${count} KB entries`);
      totalSkipped++;
      continue;
    }

    console.log(`  Processing "${sp.name}"...`);
    const details = (await getListingDetails(summary._id)) ?? summary;
    const raw = JSON.stringify(details, null, 2);

    const qaPairs = await generateQAPairs(sp.name, raw);
    console.log(`    Generated ${qaPairs.length} Q&A pairs`);

    const rows = qaPairs.map((qa) => ({
      property_id: sp.id,
      title: qa.title,
      content: qa.content,
      category: qa.category,
    }));

    const { error: insertError } = await supabase.from("knowledge_bases").insert(rows);
    if (insertError) {
      console.error(`    ERROR inserting KB for "${sp.name}":`, insertError.message);
    } else {
      console.log(`    Inserted ${rows.length} KB entries for "${sp.name}"`);
      totalCreated += rows.length;
    }
  }

  console.log(`\nDone! Created ${totalCreated} KB entries, skipped ${totalSkipped} listings.`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
