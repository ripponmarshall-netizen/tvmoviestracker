/* check.js — CI's safety net for a no-build app. Babel compiles the JSX in
   the browser, so a typo would otherwise only show up as a stuck splash on
   the phone. Checks that every .jsx file index.html loads exists, compiles
   and is precached by sw.js, and that the JSON and service worker parse.
   Run: npm install --no-save @babel/standalone@7.29.0 && node check.js */
"use strict";
const fs = require("fs");
const Babel = require("@babel/standalone");

let failed = false;
const fail = (msg) => {
  console.error("✗ " + msg);
  failed = true;
};
const ok = (msg) => console.log("✓ " + msg);

const html = fs.readFileSync("index.html", "utf8");
const sw = fs.readFileSync("sw.js", "utf8");

try {
  JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  ok("manifest.json parses");
} catch (e) {
  fail("manifest.json: " + e.message);
}

try {
  new Function(sw);
  ok("sw.js parses");
} catch (e) {
  fail("sw.js: " + e.message);
}

const scripts = [...html.matchAll(/<script type="text\/babel" src="([^"]+)"/g)].map((m) => m[1]);
if (!scripts.length) fail("index.html loads no .jsx files");
for (const file of scripts) {
  if (!fs.existsSync(file)) {
    fail(`${file} is in index.html but doesn't exist`);
    continue;
  }
  try {
    Babel.transform(fs.readFileSync(file, "utf8"), { presets: ["react"], filename: file });
    ok(`${file} compiles`);
  } catch (e) {
    fail(`${file}: ${e.message}`);
  }
  if (!sw.includes(`"./${file}"`)) fail(`${file} is missing from ASSETS in sw.js (needed offline)`);
}

for (const file of fs.readdirSync(".").filter((f) => f.endsWith(".jsx"))) {
  if (!scripts.includes(file)) fail(`${file} exists but index.html doesn't load it`);
}

if (failed) process.exit(1);
console.log("All checks passed");
