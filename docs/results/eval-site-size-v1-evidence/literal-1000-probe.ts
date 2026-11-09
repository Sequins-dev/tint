import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerDirectEvalScript } from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import { abstractScriptLiterals } from "@tint/js-engine/native/script-compile";
import { createManagedScriptFixture } from "../../../tools/managed-script-fixture.ts";
const fixture = createManagedScriptFixture();
const shapes: Record<string, [(i: number) => string, string]> = {
  prop: [(i) => "['foo' + " + i + "]: 'ok', ", "['bar']: 'ok'});"],
  meth: [(i) => "['foo' + " + i + "]() {return 'ok';}, ", "['bar']() {return 'all ok'}});"],
};
const ns = (process.argv[3] ?? "10,100,1000").split(",").map(Number);
for (const name of (process.argv[2] ?? "prop,meth").split(",")) {
  const [f, tail] = shapes[name]!;
  for (const n of ns) {
    let code = "({"; for (let i = 0; i < n; i++) code += f(i); code += tail;
    const t0 = performance.now();
    const p = parseScript(createSourceTextView(code)); if (!p.ok) throw Error("parse");
    const l = lowerDirectEvalScript(p.value, code, 0, { privateEnvironment: false, fieldInitializer: false }); if (!l.ok) throw Error("lower");
    const t1 = performance.now();
    const abstracted = process.env.A3_ABSTRACT === "0" ? undefined : abstractScriptLiterals(l.value);
    const r = prepareManagedSurfaceEntry({ ...fixture, module: abstracted?.module ?? l.value, entry: "execute" });
    const t2 = performance.now();
    if (!r.ok) { console.log(JSON.stringify({ name, n, error: r.error, lowerMs: t1 - t0, prepareMs: t2 - t1 })); continue; }
    const fns = r.value.native.functions.filter((x) => x.import !== true).sort((a, b) => b.byteLength - a.byteLength);
    console.log(JSON.stringify({ name, n, bytes: r.value.native.code.length, perEntry: Math.round(r.value.native.code.length / n), largest: fns[0]?.byteLength, frame: fns[0]?.frameBytes, functions: fns.length, abstracted: abstracted !== undefined, lowerMs: Math.round(t1 - t0), prepareMs: Math.round(t2 - t1) }));
  }
}
