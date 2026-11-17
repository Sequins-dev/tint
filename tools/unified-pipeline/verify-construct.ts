// Builds one form of a corpus construct through the hosted pipeline (with the
// general fallback available) and runs it natively under LLDB, expecting 42:
//   node tools/unified-pipeline/verify-construct.ts <construct> typed|untyped
// A general fallback is reported on stderr ("general fallback for ...").
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "../hosted-fixture.ts";
import { constructs } from "./corpus.ts";

const [name, form] = process.argv.slice(2);
const construct = constructs.find((item) => item.name === name);
if (construct === undefined) throw Error("unknown construct " + name);
if (form !== "typed" && form !== "untyped")
  throw Error("form must be typed or untyped");
const dependencies: [string, string][] = [],
  helpers: SourceModule[] = [];
for (const [file, text] of Object.entries(construct.helpers ?? {})) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const id = "construct-helper:" + file;
  dependencies.push(["./" + file, id]);
  helpers.push({ id, module: parsed.value, dependencies: new Map() });
}
verifyHostedFixture(
  construct[form],
  "construct-" + construct.name + "-" + form,
  dependencies,
  helpers,
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
