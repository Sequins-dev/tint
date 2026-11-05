/** Differential native coverage for typed-array set, including shared backing stores. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  projectFiles,
  projectMappings,
  projectRoots,
  projectBuildRequest,
} from "@tint/compiler/cli";
import { loadSourceGraph } from "@tint/typescript/modules";
import { buildMacOSProgram } from "@tint/compiler/build";
const types = ["Uint8Array", "Uint16Array", "Uint32Array", "Float64Array"];
const suite =
  types
    .map(
      (type, index) => `
function copy${index}():boolean {
 const a=new ${type}(6);for(let i=0;i<6;i++)a[i]=i+1;
 a.set(a.subarray(0,5),1);
 if(a[0]!==1||a[1]!==1||a[5]!==5)return false;
 a.set(a.subarray(1),0);a.set(a);a.set(a.subarray(0,0),6);
 const b=new ${type}(2);b[0]=9;b[1]=8;a.set(b,2.9);
 if(a[0]!==1||a[1]!==2||a[2]!==9||a[3]!==8||a[4]!==5)return false;
 a.set(b,0/0);return a[0]===9&&a[1]===8;
}`,
    )
    .join("\n") +
  `
export function main():number {
 if(!(${types.map((_, i) => `copy${i}()`).join("&&")}))return 1;
 const a=new Uint8Array(2), b=new Float64Array(2);b[0]=257.5;b[1]=-1;a.set(b);
 if(a[0]!==1||a[1]!==255)return 2;
 const f=new Float64Array(2);f[0]=-0;f[1]=0/0;
 const g=new Float64Array(2);g.set(f);
 if(1/(g[0]??1)!==-1/0||(g[1]??0)===(g[1]??0))return 3;
 return 42;
}`;
const directory = mkdtempSync(join(tmpdir(), "tint-array-copy-"));
try {
  const reference = join(directory, "reference.ts");
  writeFileSync(
    reference,
    suite + "\nif(main()!==42)throw Error('array copy mismatch');\n",
  );
  const node = spawnSync(process.execPath, [reference], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(node.status, 0, node.stdout + node.stderr);
  const inputs = projectFiles().map((file) => ({
    ...file,
    bytes:
      file.id === "packages/compiler/src/cli.ts"
        ? new TextEncoder().encode(suite)
        : new Uint8Array(readFileSync(resolve(file.id))),
  }));
  const graph = loadSourceGraph(inputs, projectMappings(), projectRoots());
  assert.ok(graph.ok, JSON.stringify(graph));
  const built = buildMacOSProgram(projectBuildRequest(graph.value, () => {}));
  assert.ok(built.ok, JSON.stringify(built));
  const path = join(directory, "copy");
  writeFileSync(path, built.value, { mode: 0o755 });
  for (let i = 0; i < 2; i++) {
    const result = spawnSync("/usr/bin/lldb", ["--batch", "-o", "run", path], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /exited with status = 42 /, result.stdout);
  }
  // The current strict-profile range failure is a trap, not a catchable JS error.
  for (const offset of ["-1", "1/0", "5"]) {
    const invalid = `export function main():number{const a=new Uint8Array(6),b=new Uint8Array(2);a.set(b,${offset});return 42;}`;
    const badInputs = inputs.map((file) =>
      file.id === "packages/compiler/src/cli.ts"
        ? { ...file, bytes: new TextEncoder().encode(invalid) }
        : file,
    );
    const badGraph = loadSourceGraph(
      badInputs,
      projectMappings(),
      projectRoots(),
    );
    assert.ok(badGraph.ok, JSON.stringify(badGraph));
    const badBuild = buildMacOSProgram(
      projectBuildRequest(badGraph.value, () => {}),
    );
    assert.ok(badBuild.ok, JSON.stringify(badBuild));
    writeFileSync(path, badBuild.value, { mode: 0o755 });
    const result = spawnSync("/usr/bin/lldb", ["--batch", "-o", "run", path], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.match(result.stdout, /stop reason = EXC_BREAKPOINT/, result.stdout);
  }
  console.log(
    "Verified all typed-array widths, overlapping views, self/empty copy, conversion, offset normalization, negative zero and NaN against Node and twice natively.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
