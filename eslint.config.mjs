import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party binaries/bundles copied on postinstall.
    "public/vendor/**",
    // Git worktrees of Claude Code agent sessions (each has its own node_modules and build output).
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
