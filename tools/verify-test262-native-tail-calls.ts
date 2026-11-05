import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext, type Context } from "node:vm";
import {
  createNativeBatchBuilder,
  prepareNativeScripts,
} from "./test262-native.ts";
import { executionPlan } from "./test262-execution.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
  readWorkspaceSourceSnapshot,
} from "./workspace-sources.ts";

assert.equal(
  process.env.TINT_BUILD_ONLY,
  "1",
  "Build only; execute through the serial LLDB fixture recorder",
);
const sources = [
  {
    name: "ordinary recursion",
    source:
      'var r=(function f(n){"use strict";return n===0?42:f(n-1)})(100000);if(r!==42)throw 1;',
  },
  {
    name: "callee computed by a call",
    source:
      'var r=(function f(n){"use strict";if(n===0)return 42;function getF(){return f}return getF()(n-1)})(100000);if(r!==42)throw 2;',
  },
  {
    name: "member call",
    source:
      'var o={f(n){"use strict";return n===0?42:o.f(n-1)}};if(o.f(100000)!==42)throw 3;',
  },
  {
    name: "optional call",
    source:
      'var r=(function f(n){"use strict";return n===0?42:f?.(n-1)})(100000);if(r!==42)throw 4;',
  },
  {
    name: "tagged template",
    source:
      'function f(strings,n){"use strict";return n===0?42:f`x${n-1}`}if(f`x${100000}`!==42)throw 5;',
  },
  {
    name: "Function call forwarding",
    source:
      'var r=(function f(n){"use strict";return n===0?42:f.call(undefined,n-1)})(100000);if(r!==42)throw 6;',
  },
  {
    name: "Function apply forwarding",
    source:
      'var r=(function f(n){"use strict";return n===0?42:f.apply(undefined,[n-1])})(100000);if(r!==42)throw 7;',
  },
  {
    name: "shadowed global eval",
    source:
      'var eval=function f(n){"use strict";return n===0?42:eval(n-1)};if(eval(100000)!==42)throw 8;',
  },
  {
    name: "dynamically added eval binding",
    source:
      '(function(){function f(n){"use strict";return n===0?42:eval(n-1)}eval("var eval=f");if(f(100000)!==42)throw 9;})();',
  },
  {
    name: "with environment eval binding",
    source:
      'var f;with({eval:undefined}){f=function(n){"use strict";return n===0?42:eval(n-1)};eval=f;if(f(100000)!==42)throw 10;}',
  },
  {
    name: "in-image compilation of a strict tail-recursive function",
    source:
      "if($262.evalScript('function f(n){\"use strict\";return n===0?42:f(n-1)}f(100000);')!==42)throw 11;",
  },
];
interface ReferenceRealm {
  readonly context: Context;
  readonly global: object;
  readonly evalScript: (source: string) => unknown;
  readonly createRealm: () => ReferenceRealm;
}
function referenceRealm(): ReferenceRealm {
  const context = createContext();
  const host = {
    context,
    global: runInContext("globalThis", context) as object,
    evalScript: (source: string): unknown => runInContext(source, context),
    createRealm: referenceRealm,
  };
  Object.assign(context, { $262: host });
  return host;
}
const cases = sources.map(({ source }) => {
  // V8 does not implement proper tail calls; its reference check uses a small
  // depth only. Native output executes the original 100,000-depth fixture text.
  runInContext(source.replaceAll("100000", "10"), referenceRealm().context);
  const prepared = prepareNativeScripts(
    executionPlan(source, "raw", {
      flags: ["raw"],
      features: [],
      includes: [],
    }),
    "raw",
    [],
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  return { scripts: prepared.modules, asynchronous: false };
});
const captured = process.env.TINT_TEST262_SOURCES;
const snapshot =
  captured === undefined
    ? workspaceSources()
    : readWorkspaceSourceSnapshot(captured);
const built = createNativeBatchBuilder(snapshot)(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
const directory = mkdtempSync(join(tmpdir(), "tint-native-tail-calls-")),
  binary = join(directory, "tail-calls"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-lowered-tail-call-fixture",
      conformance: false,
      cases: sources.map((item) => ({
        ...item,
        expected: { kind: "completed" },
      })),
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
writeFileSync(
  binary + ".manifest.json",
  JSON.stringify(
    {
      kind: "tint-hosted-native-build",
      version: 1,
      sourceSnapshot: workspaceSourceIdentity(snapshot),
      imageSha256: createHash("sha256").update(built.bytes).digest("hex"),
      fixture,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(binary);
