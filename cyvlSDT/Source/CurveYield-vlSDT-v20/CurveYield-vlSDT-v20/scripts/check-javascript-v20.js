#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const files = [path.join(root, "hardhat.config.js")];
for (const dir of ["scripts", "deployment-v20", path.join("test", "v20")]) {
  const absolute = path.join(root, dir);
  for (const name of fs.readdirSync(absolute)) {
    if (name.endsWith(".js")) files.push(path.join(absolute, name));
  }
}
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}
console.log(`JavaScript syntax passed for ${files.length} active files.`);
