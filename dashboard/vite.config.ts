import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Single-tenant: hard-pin the Phillip Island Host Supabase project so a
// misconfigured host (Render) env var can't point the app at the wrong
// project. These `define` entries replace `import.meta.env.VITE_SUPABASE_*`
// at build time everywhere, overriding any host environment variable.
// The anon key is a public client key (RLS-gated), safe to ship in the bundle.
const SUPABASE_URL = "https://ictumlksmzjenevtaqvp.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljdHVtbGtzbXpqZW5ldnRhcXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5ODIwMzUsImV4cCI6MjA5NjU1ODAzNX0.EIcFMXSc5ZZPP4yS5LSA-O4wxOWFFj-jKnRh6Y_asIo";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(SUPABASE_URL),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(SUPABASE_ANON_KEY),
  },
});
