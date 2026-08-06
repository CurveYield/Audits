#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const files = [
  ["package-v18.json", "package.json"],
  ["package-lock-v18.json", "package-lock.json"],
  ["hardhat.config-v18.js", "hardhat.config.js"]
];

for (const [source, destination] of files) {
  fs.copyFileSync(path.join(root, source), path.join(root, destination));
  console.log(`Prepared ${destination} from ${source}`);
}
