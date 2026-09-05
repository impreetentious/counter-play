import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

// Flat config. Generated and build output are ignored here rather than in .eslintignore,
// which flat config no longer reads.
export default [
  {
    ignores: [
      ".next/**",
      "out/**",
      "coverage/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: root,
      },
    },
    plugins: {
      "@next/next": nextPlugin,
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
