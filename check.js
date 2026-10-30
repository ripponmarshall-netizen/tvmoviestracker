/* check.js — CI's safety net for a no-build app. Babel compiles the JSX in
   the browser, so a typo would otherwise only show up as a stuck splash on
   the phone. Checks that every .jsx file index.html loads exists, compiles
   and is precached by sw.js, that no two files declare the same top-level
   name (they share one global scope: a repeated const stops the app
   loading, a repeated function silently replaces the other), and that the
   JSON and service worker parse.
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

// The names a declaration binds, including destructured ones
// (const { useState: useStateC } = React binds useStateC).
const boundNames = (node) => {
  if (!node) return [];
  if (node.type === "Identifier") return [node.name];
  if (node.type === "ObjectPattern") return node.properties.flatMap((p) => boundNames(p.type === "RestElement" ? p.argument : p.value));
  if (node.type === "ArrayPattern") return node.elements.flatMap((e) => boundNames(e));
  if (node.type === "AssignmentPattern") return boundNames(node.left);
  if (node.type === "RestElement") return boundNames(node.argument);
  return [];
};
const declaredIn = new Map(); // top-level name -> first file to declare it

const scripts = [...html.matchAll(/<script type="text\/babel" src="([^"]+)"/g)].map((m) => m[1]);
if (!scripts.length) fail("index.html loads no .jsx files");
for (const file of scripts) {
  if (!fs.existsSync(file)) {
    fail(`${file} is in index.html but doesn't exist`);
    continue;
  }
  try {
    const { ast } = Babel.transform(fs.readFileSync(file, "utf8"), { presets: ["react"], filename: file, ast: true, code: false });
    ok(`${file} compiles`);
    for (const node of ast.program.body) {
      const names = node.type === "VariableDeclaration" ? node.declarations.flatMap((d) => boundNames(d.id))
        : (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id ? [node.id.name] : [];
      for (const name of names) {
        if (declaredIn.has(name)) fail(`${file} declares ${name}, already declared in ${declaredIn.get(name)} (the files share one scope)`);
        else declaredIn.set(name, file);
      }
    }
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
