import { task, logger } from "@trigger.dev/sdk";
import { importProperties } from "./flows/import-properties.js";

export const propertySyncWorkflow = task({
  id: "property-sync-workflow",
  retry: { maxAttempts: 1 },
  run: async () => {
    // Import listings from Guesty ONLY. Knowledge bases are curated manually in
    // the dashboard — auto-generating Q&A for 100+ properties via Claude times
    // out, and after the initial setup the client manages KB themselves.
    logger.info("Orchestrator: import-properties (Guesty listings only)");
    const importResult = await importProperties.triggerAndWait().unwrap();

    return {
      status: "ok",
      guesty_listings_found: importResult.guesty_listings_found,
      properties_added: importResult.added,
      properties_updated: importResult.updated,
      errors: importResult.errors,
    };
  },
});
