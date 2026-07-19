import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "reference/**", "legacy/**", "*.js", "*.mjs"]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        Game: "readonly",
        Memory: "writable",
        RawMemory: "readonly",
        InterShardMemory: "readonly",
        PathFinder: "readonly",
        Creep: "readonly",
        Room: "readonly",
        RoomPosition: "readonly",
        RoomVisual: "readonly",
        Structure: "readonly",
        StructureSpawn: "readonly",
        Source: "readonly",
        Flag: "readonly",
        _: "readonly",
        global: "writable"
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off"
    }
  }
);
