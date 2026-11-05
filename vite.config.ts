import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { localMapStoragePlugin } from "./src/mapEditor/localMapServer";

export default defineConfig({
  plugins: [
    localMapStoragePlugin(fileURLToPath(new URL("./public/maps", import.meta.url))),
  ],
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
  },
});
