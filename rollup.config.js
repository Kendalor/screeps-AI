"use strict";

import clear from "rollup-plugin-clear";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "rollup-plugin-typescript2";
import screeps from "rollup-plugin-screeps";
import cleanup from "rollup-plugin-cleanup";
import copy from "rollup-plugin-copy";

let local= process.env.LOCAL;
let cfg;
const dest = process.env.DEST;
if (!dest) {
  console.log("No destination specified - code will be compiled but not uploaded");
} else if ((cfg = require("./screeps.json")[dest]) == null) {
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
    typescript({tsconfig: "./tsconfig.json"}),
    cleanup({commens: "all"}),
    screeps({config: cfg, dryRun: cfg == null}),
    copy({
      config: local, dryRun: local == null, verbose: true,
      targets:[
        {src: 'dist\\main.js', dest: 'C:\\Users\\Kenda\\AppData\\Local\\Screeps\\scripts\\kewlar_de___21025\\default\\main.js'}
      ]
    })
  ]
}
