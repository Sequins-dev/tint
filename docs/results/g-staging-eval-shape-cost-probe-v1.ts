import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerDirectEvalScript } from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import { createManagedScriptFixture } from "../../tools/managed-script-fixture.ts";
const fixture = createManagedScriptFixture();
const shapes: Record<string, (i: number) => string> = {
  plainKey: (i) => `a${i}: 'ok', `,
  computedConst: (i) => `['a${i}']: 'ok', `,
  computedConcat: (i) => `['foo' + ${i}]: 'ok', `,
};
const size = (code: string) => { const p = parseScript(createSourceTextView(code)); if (!p.ok) throw Error("parse " + code.slice(0, 80)); const l = lowerDirectEvalScript(p.value, code, 0, { privateEnvironment: false, fieldInitializer: false }); if (!l.ok) throw Error("lower"); const r = prepareManagedSurfaceEntry({ ...fixture, module: l.value, entry: "execute" }); if (!r.ok) throw Error(JSON.stringify(r.error)); return r.value.native.code.length; };
for (const [name, f] of Object.entries(shapes)) {
  const s = (n: number) => { let c = "({"; for (let i = 0; i < n; i++) c += f(i); return size(c + "z: 1});"); };
  const a = s(10), b = s(60); console.log(name, "bytes/entry", ((b - a) / 50).toFixed(0));
}
const stmt = (n: number, f: (i: number) => string) => { let c = "var x, y = 'foo';"; for (let i = 0; i < n; i++) c += f(i); return size(c); };
for (const [name, f] of Object.entries({ assign: (i: number) => `x = ${i};`, concat: (i: number) => `x = y + ${i};`, call: (i: number) => `String(${i});` })) {
  const a = stmt(10, f), b = stmt(60, f); console.log(name, "bytes/stmt", ((b - a) / 50).toFixed(0));
}
