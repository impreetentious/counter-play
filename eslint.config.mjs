/**
 * Keep lint portable without the framework preset. TypeScript correctness is
 * enforced by `npm run typecheck`.
 */
export default [
  {
    ignores: [".next/**", "out/**", "coverage/**", "node_modules/**", "test-results/**", "playwright-report/**"],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
