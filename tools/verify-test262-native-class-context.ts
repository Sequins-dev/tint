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
    name: "foreign base class direct call uses defining TypeError",
    source: `const h=$262.createRealm(),o=h.global,C=h.evalScript('(class {})');let ok=false;try{C();}catch(e){ok=e instanceof o.TypeError&&!(e instanceof TypeError);}if(!ok)throw 60;`,
  },
  {
    name: "foreign derived class direct call uses defining TypeError",
    source: `const h=$262.createRealm(),o=h.global,C=h.evalScript('(class extends Object {})');let ok=false;try{C();}catch(e){ok=e instanceof o.TypeError&&!(e instanceof TypeError);}if(!ok)throw 61;`,
  },
  {
    name: "foreign derived primitive return uses caller TypeError",
    source: `const h=$262.createRealm(),o=h.global,C=h.evalScript('(class extends Object {constructor(){return 0;}})');let ok=false;try{new C();}catch(e){ok=e instanceof TypeError&&!(e instanceof o.TypeError);}if(!ok)throw 62;`,
  },
  {
    name: "foreign derived missing super uses caller ReferenceError",
    source: `const h=$262.createRealm(),o=h.global,C=h.evalScript('(class extends Object {constructor(){}})');let ok=false;try{new C();}catch(e){ok=e instanceof ReferenceError&&!(e instanceof o.ReferenceError);}if(!ok)throw 63;`,
  },
  {
    name: "explicit body throw retains defining realm",
    source: `const h=$262.createRealm(),o=h.global,C=h.evalScript('(class extends Object {constructor(){throw new TypeError("body");}})');let ok=false;try{new C();}catch(e){ok=e instanceof o.TypeError&&!(e instanceof TypeError)&&e.message==='body';}if(!ok)throw 64;`,
  },
  {
    name: "this before super retains body error realm",
    source: `const h=$262.createRealm(),o=h.global,C=h.evalScript('(class extends Object {constructor(){this.x=1;}})');let ok=false;try{new C();}catch(e){ok=e instanceof o.ReferenceError&&!(e instanceof ReferenceError);}if(!ok)throw 65;`,
  },
  {
    name: "nested construction restores each immediate caller",
    source: `const h=$262.createRealm(),o=h.global,C=h.evalScript('(class C extends Object {constructor(n){if(n){let caught=false;try{new C(0);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 99;}return 0;}})');let ok=false;try{new C(1);}catch(e){ok=e instanceof TypeError&&!(e instanceof o.TypeError);}if(!ok)throw 66;`,
  },
  {
    name: "Reflect construct uses the active builtin caller realm",
    source: `const o=$262.createRealm().global;class C extends Object{constructor(){return 0;}}let ok=false;try{o.Reflect.construct(C,[]);}catch(e){ok=e instanceof o.TypeError&&!(e instanceof TypeError);}if(!ok)throw 67;`,
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
  // V8 creates the missing-super ReferenceError in the callee realm. ECMA-262
  // 10.2.2 steps 9 and 15 restore the caller before GetThisBinding throws.
  if (source.includes("throw 63")) {
    assert.throws(
      () => runInContext(source, referenceRealm().context),
      (e) => e === 63,
    );
  } else {
    runInContext(source, referenceRealm().context);
  }
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
const directory = mkdtempSync(join(tmpdir(), "tint-native-class-context-")),
  binary = join(directory, "class-context"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-class-constructor-context-fixture",
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
