"use strict";

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import "dotenv/config";
import clear from "rollup-plugin-clear";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import screeps from "rollup-plugin-screeps";
import copy from "rollup-plugin-copy";

const local = process.env.LOCAL;
let cfg;
const dest = process.env.DEST;
if (!dest) {
  console.log("No destination specified - code will be compiled but not uploaded");
} else if ((cfg = JSON.parse(readFileSync("./screeps.json", "utf8"))[dest]) == null) {
  throw new Error("Invalid upload destination");
} else if (cfg.token) {
  // screeps.json may reference an env var as "${VAR_NAME}" to avoid committing secrets
  cfg.token = cfg.token.replace(/^\$\{(\w+)\}$/, (match, name) => {
    if (!process.env[name]) throw new Error(`screeps.json token references ${match} but ${name} is not set`);
    return process.env[name];
  });
}

// PROFILE=1 npm run push-pserver builds with src/lib/profiler.ts's wrapping compiled in; every other
// build (push-main, push-dev, plain bundle) compiles it out entirely — __PROFILER_ENABLED__ becomes a
// literal `false`, so `if (!__PROFILER_ENABLED__) return;` dead-code-eliminates the wrapping, giving
// zero runtime overhead in normal builds.
const profilerEnabled = process.env.PROFILE === "1";
if (profilerEnabled) console.log("Profiler ENABLED for this build");

// Baked into every build (not just PROFILE=1) so Memory.stats.commit can identify which deployed
// version produced a given tick's data — dirty worktree still resolves to the last real commit; a
// missing git binary/detached-history edge case falls back to "unknown" rather than failing the build.
let gitCommit = "unknown";
try {
  gitCommit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch (e) {
  console.warn("Could not resolve git commit hash for build:", e.message);
}
console.log(`Building commit ${gitCommit}`);

export default {
  input: "src/main.ts",
  output: {
    file: "dist/main.js",
    format: "cjs",
    sourcemap: true
  },

  plugins: [
    clear({ targets: ["dist"] }),
    resolve(),
    commonjs(),
    json(),
    replace({
      preventAssignment: true,
      values: {
        __PROFILER_ENABLED__: JSON.stringify(profilerEnabled),
        __GIT_COMMIT__: JSON.stringify(gitCommit)
      }
    }),
    typescript({ tsconfig: "./tsconfig.json" }),
    screeps({ config: cfg, dryRun: cfg == null }),
    ...(local
      ? [
          copy({
            verbose: true,
            targets: [
              {
                src: "dist\\main.js",
                dest: "C:\\Users\\Kenda\\AppData\\Local\\Screeps\\scripts\\kewlar_de___21025\\default"
              }
            ]
          })
        ]
      : [])
  ]
};
