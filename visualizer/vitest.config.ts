import { defineConfig } from "vitest/config";

// Unit tests only: no React or Tailwind plugins needed.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node",
  },
});
