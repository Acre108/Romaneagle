import { defineConfig } from "vite";

export default defineConfig({
  plugins: [{
    name: "sites-static-worker",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "server/index.js",
        source: `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    const url = new URL(request.url);
    url.pathname = "/";
    return env.ASSETS.fetch(new Request(url, request));
  }
};`,
      });
    },
  }],
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
  },
});
