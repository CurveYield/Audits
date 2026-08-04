#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const dirs = ["scripts", "deployment-v17"];
const files = dirs.flatMap(d => fs.readdirSync(path.join(root,d)).filter(f=>f.endsWith(".js")).map(f=>path.join(root,d,f)));
for (const file of files) {
  const r=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
  if (r.status!==0) { process.stderr.write(r.stderr||r.stdout); process.exit(r.status||1); }
}
console.log(`JavaScript syntax passed for ${files.length} V17 files.`);
