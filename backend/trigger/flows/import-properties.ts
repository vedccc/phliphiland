import { task, logger } from "@trigger.dev/sdk";
import { getSupabaseClient } from "../helpers/supabase.js";
import { listListings, type GuestyListing } from "../helpers/guesty.js";

export interface ImportedPropertyRow {
  id: string;                  // Supabase property uuid
  guesty_listing_id: string;   // Guesty listing _id
  name: string;
}

export interface ImportPropertiesResult {
  status: "ok" | "error";
  guesty_listings_found: number;
  added: number;
  updated: number;
  imported: ImportedPropertyRow[];
  errors: string[];
}

export const importProperties = task({
  id: "import-properties",
  retry: { maxAttempts: 2 },
  run: async (): Promise<ImportPropertiesResult> => {
    const supabase = getSupabaseClient();
    const errors: string[] = [];
    let added = 0;
    let updated = 0;

    logger.info("Fetching listings from Guesty...");
    const all = await listListings();
    logger.info(`Fetched ${all.length} listings from Guesty`);

    const imported: ImportedPropertyRow[] = [];

    for (const hp of all) {
      const name = hp.nickname || hp.title || `Property ${hp._id}`;
      const timezone = hp.timezone || "Australia/Melbourne";

      const { data: existing, error: lookupErr } = await supabase
        .from("properties")
        .select("id")
        .eq("guesty_listing_id", hp._id)
        .maybeSingle();
      if (lookupErr) {
        errors.push(`Lookup failed for ${hp._id}: ${lookupErr.message}`);
        continue;
      }

      if (existing) {
        const { error: updErr } = await supabase
          .from("properties")
          .update({ name, timezone })
          .eq("id", existing.id);
        if (updErr) {
          errors.push(`Update failed for ${hp._id}: ${updErr.message}`);
          continue;
        }
        updated++;
        imported.push({ id: existing.id, guesty_listing_id: hp._id, name });
      } else {
        const { data: created, error: insErr } = await supabase
          .from("properties")
          .insert({ name, guesty_listing_id: hp._id, timezone, is_active: true })
          .select("id")
          .single();
        if (insErr || !created) {
          errors.push(`Insert failed for ${hp._id}: ${insErr?.message}`);
          continue;
        }
        added++;
        imported.push({ id: created.id, guesty_listing_id: hp._id, name });
      }
    }

    logger.info("Import complete", { found: all.length, added, updated, errors: errors.length });
    return {
      status: "ok",
      guesty_listings_found: all.length,
      added,
      updated,
      imported,
      errors,
    };
  },
});

export type ImportedListing = GuestyListing;
