// Standalone rollup build for traveler-corridor-main.ts, mirroring rollup.config.mjs's pipeline
// but pointed at a test-only entry so it can live outside src/ (tsconfig.json's rootDir/exclude
// keep test/* out of the production build) without touching the shared build config.
import { rollup } from "rollup";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

export async function buildCorridorFixture() {
  const bundle = await rollup({
    input: path.join(__dirname, "traveler-corridor-main.ts"),
    plugins: [
      resolve(),
      commonjs(),
      json(),
      typescript({
        tsconfig: false,
        compilerOptions: {
          module: "esnext",
          target: "es2019",
          moduleResolution: "bundler",
          types: ["screeps", "lodash", "node"],
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          resolveJsonModule: true,
          allowUmdGlobalAccess: true,
          rootDir: repoRoot
        }
      })
    ]
  });
  const { output } = await bundle.generate({ format: "cjs" });
  await bundle.close();
  return output[0].code;
}
