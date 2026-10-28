import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Written by scripts/build-data.mjs (prebuild/predev). Its hash goes into the summary URL, so a
// deploy never serves a cached summary.json from the previous one.
const summaryPath = fileURLToPath(new URL("./public/data/generated/summary.json", import.meta.url));
const dataVersion = existsSync(summaryPath)
  ? createHash("sha1").update(readFileSync(summaryPath)).digest("hex").slice(0, 10)
  : "dev";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves the site from /typewhisper-benchmark/; every view is a query on index.html.
  base: "/typewhisper-benchmark/",
  define: {
    __DATA_VERSION__: JSON.stringify(dataVersion),
  },
});
