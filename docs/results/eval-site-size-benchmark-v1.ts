// Native acceptance benchmark for large runtime-compiled Script entries: the
// staging/sm/class compPropNames.js and methDefn.js direct-eval literals.
//
// build: TINT_BUILD_ONLY=1 node docs/results/eval-site-size-benchmark-v1.ts build
//   Builds one native image (current workspace sources) with a baseline case and
//   the literal cases, printing the image path and manifest.
// once:  node docs/results/eval-site-size-benchmark-v1.ts once <image> <case>
//   Runs one case under the standard LLDB-contained launcher (300 s budget) and
//   prints its outcome and elapsed wall time as JSON.
import { verifyNativeScriptCases } from "../../tools/native-script-fixture.ts";
import { executeNativeFile } from "../../tools/test262-native-process.ts";

function literal(count: number, methods: boolean): string {
  const entry = methods
    ? String.raw`code += "['foo' + " + i + "]() {return 'ok';}, ";`
    : String.raw`code += "['foo' + " + i + "]: 'ok', ";`;
  const tail = methods
    ? String.raw`"['bar']() {return 'all ok'}});"`
    : String.raw`"['bar']: 'ok'});"`;
  const check = methods
    ? String.raw`if (obj["foo" + i]() !== "ok") throw new Error("foo" + i);`
    : String.raw`if (obj["foo" + i] !== "ok") throw new Error("foo" + i);`;
  return [
    `var code = "({"; for (var i = 0; i < ${count}; i++) ${entry}`,
    `code += ${tail}; var obj = eval(code);`,
    `for (i = 0; i < ${count}; i++) ${check}`,
  ].join("\n");
}
export const benchmarkCases = [
  // 0: launch/startup baseline.
  String.raw`var baseline = 0;`,
  // 1: compPropNames.js: 1000 computed data properties.
  literal(1000, false),
  // 2-4: methDefn.js: 250, 500 and 1000 computed methods.
  literal(250, true),
  literal(500, true),
  literal(1000, true),
];

const [mode, ...rest] = process.argv.slice(2);
if (mode === "build") verifyNativeScriptCases(benchmarkCases);
else if (mode === "once") {
  const started = process.hrtime.bigint();
  const outcome = executeNativeFile(rest[0]!, 300_000, Number(rest[1]));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  console.log(JSON.stringify({ case: Number(rest[1]), elapsedMs, outcome }));
} else throw new Error("usage: build | once <image> <case>");
