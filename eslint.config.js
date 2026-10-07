import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  ignores: [
    "dist/**",
    "dist-server/**",
    "node_modules/**",
    "coverage/**",
    "playwright-report/**",
  ],
});
