import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerScript, lowerDirectEvalScript } from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import { createManagedScriptFixture } from "../../tools/managed-script-fixture.ts";
const fixture = createManagedScriptFixture();
for (const n of (process.argv[2] ?? "25,50,100,200,400").split(",").map(Number)) {
  let code = "({"; for (let i = 0; i < n; i++) code += "['foo' + " + i + "]: 'ok', "; code += "['bar']: 'ok'});";
  const t0 = performance.now();
  const parsed = parseScript(createSourceTextView(code)); if (!parsed.ok) throw Error("parse");
  const lowered = process.env.G_MODE === "direct" ? lowerDirectEvalScript(parsed.value, code, 0, { privateEnvironment: false, fieldInitializer: false }) : lowerScript(parsed.value, code); if (!lowered.ok) throw Error("lower " + JSON.stringify(lowered.error));
  const t1 = performance.now();
  const prepared = prepareManagedSurfaceEntry({ ...fixture, module: lowered.value, entry: "execute" });
  const t2 = performance.now();
  if (!prepared.ok) { console.log(JSON.stringify({ n, error: prepared.error })); continue; }
  console.log(JSON.stringify({ n, lowerMs: +(t1 - t0).toFixed(1), prepareMs: +(t2 - t1).toFixed(1), codeBytes: prepared.value.native.code.length, statements: JSON.stringify(lowered.value).length }));
}
