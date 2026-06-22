import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

// Runtime env vars the deployed tasks need. `trigger deploy` loads .env into the
// CLI process by default (--env-file defaults to .env), so these get forwarded to
// the deployed environment on every deploy. Vars not present locally are skipped
// (so an empty value never clobbers one set in the dashboard).
const RUNTIME_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "GUESTY_CLIENT_ID",
  "GUESTY_CLIENT_SECRET",
  "PUBLIC_LINK_SIGNING_SECRET",
  "SMSAPI_TOKEN",
  "SMSAPI_SENDER_NAME",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DASHBOARD_HOST",
  "PHILLIP_ISLAND_PHONE",
];

export default defineConfig({
  project: "proj_jroitttjzbwjhdzzisjv",
  dirs: ["./backend/trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [
      syncEnvVars(async () =>
        RUNTIME_ENV_VARS.filter((name) => process.env[name]).map((name) => ({
          name,
          value: process.env[name] as string,
        }))
      ),
    ],
  },
});
