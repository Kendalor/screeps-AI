"use strict";

import { readFileSync } from "node:fs";
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
}

// PROFILE=1 npm run push-pserver builds with src/lib/profiler.ts's wrapping compiled in; every other
// build (push-main, push-dev, plain bundle) compiles it out entirely — __PROFILER_ENABLED__ becomes a
// literal `false`, so `if (!__PROFILER_ENABLED__) return;` dead-code-eliminates the wrapping, giving
// zero runtime overhead in normal builds.
const profilerEnabled = process.env.PROFILE === "1";
if (profilerEnabled) console.log("Profiler ENABLED for this build");

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
      values: { __PROFILER_ENABLED__: JSON.stringify(profilerEnabled) }
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
