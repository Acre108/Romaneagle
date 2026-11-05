import { defineConfig } from "@playwright/test";

const PORT = 5199;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  outputDir: "./test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    viewport: { width: 1440, height: 900 },
    // Software WebGL, so the test needs only installed Chrome and no graphics card.
    channel: "chrome",
    launchOptions: { args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
  },
});
