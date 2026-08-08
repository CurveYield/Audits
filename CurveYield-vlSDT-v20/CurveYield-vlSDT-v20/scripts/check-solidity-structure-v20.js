"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => {
    const p=path.join(dir,e.name);
    return e.isDirectory()?walk(p):[p];
  });
}
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}
function balanced(src, open, close, file) {
  let n=0;
  for (const c of src) {
    if (c===open) n++;
    if (c===close) n--;
    if (n<0) throw new Error(`${file}: unexpected ${close}`);
  }
  if (n!==0) throw new Error(`${file}: unbalanced ${open}${close}: ${n}`);
}
const files=walk(path.join(root,"contracts")).filter(f=>f.endsWith(".sol"));
for (const file of files) {
  const raw=fs.readFileSync(file,"utf8");
  const src=strip(raw);
  balanced(src,"{","}",file); balanced(src,"(",")",file); balanced(src,"[","]",file);
  if (!/pragma\s+solidity\s+0\.8\.28\s*;/.test(raw)) throw new Error(`${file}: pragma is not pinned to 0.8.28`);
  const imports=[...raw.matchAll(/import\s+(?:\{[^}]+\}\s+from\s+)?["']([^"']+)["'];/g)].map(m=>m[1]);
  for (const imp of imports) {
    if (imp.startsWith(".")) {
      const target=path.resolve(path.dirname(file),imp);
      if (!fs.existsSync(target)) throw new Error(`${file}: missing local import ${imp}`);
    }
  }
}
console.log(`Solidity structural scan passed for ${files.length} active files (not compilation).`);
