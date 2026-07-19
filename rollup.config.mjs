"use strict";

import { readFileSync } from "node:fs";
import clear from "rollup-plugin-clear";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
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
