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
    // 非本專案維護的程式碼：
    ".claude/**", // 已安裝的 Claude Code skill 自帶腳本
    ".agents/**", // 已安裝的 skill 自帶腳本（design-system/brand 等）
    "src/generated/**", // Prisma 產生碼
  ]),
]);

export default eslintConfig;
