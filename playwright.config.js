// Minimal Playwright config for nightly backlog QA runs.
// Runs against a local Next.js dev server wired to the real staging Supabase project
// (see .env.local — NEXT_PUBLIC_SUPABASE_URL/PUBLISHABLE_KEY point at parts-inventory-staging).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './qa-tests',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium',
    },
  },
});
