/**
 * In-process runner for scripts/cdss-verify.ts.
 *
 * The WebContainer terminal cannot spawn child node processes (tsx/esbuild
 * hang), so this runner uses the TypeScript compiler API IN-PROCESS to
 * transpile the CDSS modules + harness to CommonJS, writes them to a temp
 * build dir, and executes the harness — all inside one node process.
 *
 * Usage:  node scripts/transpile-clinical.mjs
 */

import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname; // project root
const BUILD = "/tmp/cdss-build";

const CLINICAL_FILES = [
  "src/lib/clinical/clinicalTypes.ts",
  "src/lib/clinical/clinicalRules.ts",
  "src/lib/clinical/referenceRanges.ts",
  "src/lib/clinical/riskEngine.ts",
  "src/lib/clinical/combinedFindings.ts",
  "src/lib/clinical/clinicalEngine.ts",
  "src/lib/clinical/index.ts",
];

mkdirSync(BUILD, { recursive: true });

function transpile(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      verbatimModuleSyntax: false,
    },
    fileName: file,
  });
  return out.outputText;
}

for (const file of CLINICAL_FILES) {
  const js = transpile(file);
  const base = file.split("/").pop().replace(/\.ts$/, ".cjs");
  writeFileSync(join(BUILD, base), js);
  console.log(`transpiled ${file} -> ${base}`);
}

// Harness: transpile + rewrite the one absolute-ish import to the flat build.
let harness = readFileSync(join(ROOT, "scripts/cdss-verify.ts"), "utf8");
harness = harness.replace(
  /from "\.\.\/src\/lib\/clinical\/index"/g,
  'from "./index"',
);
const harnessJs = ts.transpileModule(harness, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    verbatimModuleSyntax: false,
  },
  fileName: "scripts/cdss-verify.ts",
}).outputText;
writeFileSync(join(BUILD, "harness.cjs"), harnessJs);
console.log("transpiled scripts/cdss-verify.ts -> harness.cjs");

console.log("executing harness in-process...\n");
const require = createRequire(import.meta.url);
try {
  require(join(BUILD, "harness.cjs"));
  console.log("done");
} catch (err) {
  console.error("HARNESS ERROR:", err);
  process.exit(1);
}
