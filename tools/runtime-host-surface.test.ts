import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import ts from "typescript";

test("compiler file adapter contract excludes broader Node modules and globals", () => {
  const contract = fileURLToPath(
    new URL("../types/runtime-fs.d.ts", import.meta.url),
  );
  const probe = fileURLToPath(
    new URL("./__host_surface_probe.ts", import.meta.url),
  );
  const source = `import {readFileSync} from "node:fs";import {randomUUID} from "node:crypto";process.pid;`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: [],
    noEmit: true,
  };
  const host = ts.createCompilerHost(options),
    getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, fresh) =>
    name === probe
      ? ts.createSourceFile(name, source, ts.ScriptTarget.ES2022, true)
      : getSourceFile(name, version, onError, fresh);
  const program = ts.createProgram([contract, probe], options, host);
  const messages = ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  assert.ok(
    messages.some((m) => m.includes("readFileSync")),
    JSON.stringify(messages),
  );
  assert.ok(
    messages.some((m) => m.includes("node:crypto")),
    JSON.stringify(messages),
  );
  assert.ok(
    messages.some((m) => m.includes("process")),
    JSON.stringify(messages),
  );
});
