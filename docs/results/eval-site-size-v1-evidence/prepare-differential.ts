// Node-side differential: lower each Test262 source as a runtime-compiled
// Script and prepare it; print one JSON line per file with the outcome.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerScript } from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import { createManagedScriptFixture } from "../../../tools/managed-script-fixture.ts";
const root = "/Users/stephenbelanger/Code/nodejs/tint/.tint-bootstrap/test262/test/";
const dirs = process.argv.slice(3);
const limit = Number(process.argv[2]);
const files: string[] = [];
function walk(d: string) { for (const e of readdirSync(root + d).sort()) { const p = d + "/" + e; if (statSync(root + p).isDirectory()) walk(p); else if (e.endsWith(".js") && !e.includes("_FIXTURE")) files.push(p); } }
for (const d of dirs) walk(d);
const step = Math.max(1, Math.floor(files.length / limit));
const fixture = createManagedScriptFixture();
for (let i = Math.floor(step * Number(process.env.A3_OFFSET ?? 0)); i < files.length; i += step) {
  const p = files[i]!; const src = readFileSync(root + p, "utf8");
  if (/flags:.*(module|raw)/.test(src) || /negative:/.test(src)) continue;
  let outcome = "";
  try {
    const parsed = parseScript(createSourceTextView(src));
    if (!parsed.ok) outcome = "parse";
    else { const l = lowerScript(parsed.value, src, { runtimeCompiled: true }); if (!l.ok) outcome = "lower:" + l.error.code; else { const r = prepareManagedSurfaceEntry({ ...fixture, module: l.value, entry: "execute" }); outcome = r.ok ? "ok" : "prepare:" + r.error.stage + ":" + r.error.message.slice(0, 120); } }
  } catch (e) { outcome = "throw:" + String(e).slice(0, 120); }
  console.log(JSON.stringify({ p, outcome }));
}
