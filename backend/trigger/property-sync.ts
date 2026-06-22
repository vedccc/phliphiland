import { task, logger } from "@trigger.dev/sdk";
import { importProperties } from "./flows/import-properties.js";
import { syncPropertyKnowledge } from "./flows/sync-property-knowledge.js";

export const propertySyncWorkflow = task({
  id: "property-sync-workflow",
  retry: { maxAttempts: 1 },
  run: async () => {
    // Flow 1: Import listings from Guesty
    logger.info("Orchestrator step 1: import-properties");
    const importResult = await importProperties.triggerAndWait().unwrap();

    // Flow 2: Sync each property's knowledge into knowledge_bases via Claude
    logger.info("Orchestrator step 2: sync-property-knowledge", {
      properties: importResult.imported.length,
    });
    let kbResult: { qa_pairs_added: number; properties_processed: number; errors: string[] } = {
      qa_pairs_added: 0,
      properties_processed: 0,
      errors: [],
    };
    if (importResult.imported.length > 0) {
      const r = await syncPropertyKnowledge
        .triggerAndWait({ properties: importResult.imported })
        .unwrap();
      kbResult = r;
    }

    return {
      status: "ok",
      guesty_listings_found: importResult.guesty_listings_found,
      properties_added: importResult.added,
      properties_updated: importResult.updated,
      kb_properties_processed: kbResult.properties_processed,
      kb_qa_pairs_added: kbResult.qa_pairs_added,
      errors: [...importResult.errors, ...kbResult.errors],
    };
  },
});
