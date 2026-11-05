/** Run the Node reference compiler from an immutable source snapshot, without
 * resolving workspace packages to newer implementations under development. */
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { frozenSourcePackageExports } from "./frozen-source-exports.ts";
import { capturedCompilerRole } from "./captured-compiler-roles.ts";
import { capturedGraphLoader } from "./frozen-graph-loader.ts";
const source = process.argv[2];
assert.ok(source, "usage: prepare-frozen-smoke.ts <source snapshot>");
const snapshot = resolve(source),
  root = resolve(".tint-bootstrap/smoke-project"),
  output = resolve(".tint-bootstrap/smoke-node"),
  temporary = mkdtempSync(join(tmpdir(), "tint-frozen-smoke-"));
try {
  mkdirSync(join(temporary, "node_modules/@tint"), { recursive: true });
  cpSync(join(snapshot, "packages"), join(temporary, "packages"), {
    recursive: true,
  });
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  const packages = frozenSourcePackageExports(snapshot);
  const loader = capturedGraphLoader(packages);
  const project = capturedCompilerRole(packages, "project"),
    catalog = capturedCompilerRole(packages, "catalog"),
    build = capturedCompilerRole(packages, "build"),
    cli = capturedCompilerRole(packages, "cli");
  for (const pkg of packages) {
    const directory = join(temporary, "packages", pkg.id);
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ name: pkg.name, type: "module", exports: pkg.exports }),
    );
    const link = join(temporary, "node_modules", pkg.name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(directory, link);
  }
  const script = join(temporary, "smoke.mjs");
  writeFileSync(
    script,
    `
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {projectFiles,projectMappings} from ${JSON.stringify(catalog.specifier)};
import {projectRoots,projectBuildRequest} from ${JSON.stringify(project.specifier)};
import {loadSourceGraph} from ${JSON.stringify(loader.specifier)};
import {buildMacOSProgram} from ${JSON.stringify(build.specifier)};
const [snapshot,root,output]=process.argv.slice(2);
const entry=${JSON.stringify(cli.source)};
const originals=projectFiles().map(file=>({...file,bytes:new Uint8Array(readFileSync(resolve(snapshot,file.id)))}));
const runtime=loadSourceGraph(originals,projectMappings(),projectRoots().filter(id=>id!==entry));
assert.ok(runtime.ok,JSON.stringify(runtime));
const needed=new Set(runtime.value.map(module=>module.id));
const inputs=originals.map(file=>{
 const bytes=file.id===entry?new TextEncoder().encode("export function main():number{return 42;}\\n"):needed.has(file.id)?file.bytes:new Uint8Array(0);
 const path=resolve(root,file.id);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);
 return {...file,bytes};
});
const graph=loadSourceGraph(inputs,projectMappings(),projectRoots());assert.ok(graph.ok,JSON.stringify(graph));
const built=buildMacOSProgram({...projectBuildRequest(graph.value,stage=>console.log(stage)),debugSymbols:true,debugDirectory:root});
assert.ok(built.ok,JSON.stringify(built));writeFileSync(output,built.value,{mode:0o755});
console.log(JSON.stringify({snapshot,root,output,bytes:built.value.length}));
`,
  );
  const result = spawnSync(process.execPath, [script, snapshot, root, output], {
    cwd: temporary,
    encoding: "utf8",
    timeout: 120000,
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
