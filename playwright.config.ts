import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 30_000,
  // unit runs the agents against an in-memory store; e2e opens the command center in a browser.
  projects: [
    { name: "unit", testDir: "tests/unit" },
    { name: "e2e", testDir: "tests/e2e" },
  ],
  use: {
    baseURL: "http://localhost:3200",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  // No Supabase keys in tests: the app must never reach a real database from here.
  webServer: { command: "npx next start -p 3200", env: { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" }, url: "http://localhost:3200", reuseExistingServer: !process.env.CI },
});
