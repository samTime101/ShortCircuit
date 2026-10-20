import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "engine",
          root: "./packages/engine",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "web",
          root: "./apps/web",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        },
      },
      {
        test: {
          name: "cli",
          root: "./packages/cli",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "cross",
          root: ".",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
  },
});
