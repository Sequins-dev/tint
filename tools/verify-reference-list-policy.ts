import { buildAArch64Executable } from "./aarch64-executable.ts";
import { emitDarwinModule } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { verify, type ModuleIR } from "@tint/ir/scalar";

import {
  writeInstruction,
  patchBranch,
  type Instruction,
} from "@tint/codegen/aarch64/isa";

import { lowerReferenceLists } from "@tint/ir/optimization/reference-lists";
const original = readFileSync(
  new URL(
    "../packages/foundation/src/collections/sparse-list.ts",
    import.meta.url,
  ),
  "utf8",
);
const prefix =
  "interface Value {value:number;next:Value|undefined;}\n" +
  original.replaceAll("<T>", "").replace(/\bT\b/g, "Value|undefined");
const suite = `
function badIndex(list:SparseList,index:number):boolean {try {writeList(list,index,undefined);}catch(e){return e==="INVALID_INDEX";}return false;}
function badLength(list:SparseList,length:number):boolean {try {resizeList(list,length);}catch(e){return e==="INVALID_LENGTH";}return false;}
function run():number {
 const list=createList(0),a:Value={value:7,next:undefined},b:Value={value:9,next:undefined};a.next=a;
 writeList(list,0,a);writeList(list,2,undefined);
 if(!hasList(list,0)||hasList(list,1)||!hasList(list,2)||readList(list,2)!==undefined||list.length!==3)return 1;
 if(!deleteList(list,2)||deleteList(list,2)||list.length!==3)return 2;
 if(readList(list,-1)!==undefined||readList(list,0/0)!==undefined||readList(list,1/0)!==undefined||hasList(list,0.5)||deleteList(list,-1))return 13;
 writeList(list,33,a);writeList(list,0,b);
 if(readList(list,0)!==b||readList(list,33)!==a||list.length!==34)return 3;
 resizeList(list,2);resizeList(list,40);
 if(hasList(list,33)||readList(list,33)!==undefined||list.length!==40)return 4;
 writeList(list,39,undefined);if(!hasList(list,39))return 5;
 resizeList(list,0);writeList(list,1,a);
 if(list.length!==2||hasList(list,0)||readList(list,1)!==a)return 6;
 writeList(list,0,b);writeList(list,1000000,a);
 if(list.length!==1000001||readList(list,0)!==b||readList(list,1)!==a||readList(list,1000000)!==a)return 7;
 if(!deleteList(list,1)||hasList(list,1))return 8;
 resizeList(list,3);writeList(list,2000000000,b);
 if(list.length!==2000000001||hasList(list,1000000)||readList(list,2000000000)!==b||readList(list,0)!==b)return 9;
 if(!badIndex(list,-1)||!badIndex(list,0.5)||!badIndex(list,0/0)||!badIndex(list,1/0)||!badIndex(list,4294967295))return 10;
 if(!badLength(list,-1)||!badLength(list,0.5)||!badLength(list,1/0)||!badLength(list,4294967296))return 11;
 if(readList(list,-1)!==undefined||readList(list,0/0)!==undefined||hasList(list,0.5)||deleteList(list,-1))return 12;
 return 42;
}`;
const decoded = createSourceText(
  new TextEncoder().encode(prefix + suite),
  1000000,
);
assert.ok(decoded.ok);
const parsed = parseModule(decoded.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
const checked = checkClosureModule(parsed.value);
assert.ok(checked.ok, JSON.stringify(checked));
const parsedModule = parsed.value,
  checkedModule = checked.value;
const entries = checked.value.bindings.functions
  .filter((f) => f.parent === undefined)
  .map((f) => f.id);
const lowered = lowerModuleEntries(
  checked.value,
  entries,
  {
    pointerSize: 8,
    wordSize: 8,
    allocationAlignment: 16,
    frameAlignment: 16,
    maxAlignment: 16,
  },
  4096,
);
assert.ok(lowered.ok, JSON.stringify(lowered));
function id(name: string): number {
  const declaration = parsedModule.statements.find(
      (s) => s.kind === "function" && s.name === name,
    ),
    fn = checkedModule.bindings.functions.find((f) => f.node === declaration);
  assert.ok(fn, name);
  return entries.indexOf(fn.id);
}
const create = id("createList"),
  read = id("readList"),
  write = id("writeList"),
  has = id("hasList"),
  remove = id("deleteList"),
  resize = id("resizeList"),
  entry = id("run");
let module: ModuleIR = lowered.value.module;
const binding = {
  create,
  read,
  write,
  has,
  delete: remove,
  resize,
  push: id("pushList"),
  length: id("lengthList"),
};
const transformed = lowerReferenceLists(module, [binding], [entry]);
assert.ok(transformed, "reference-list rewrite declined");
// Unrelated module layouts must not consume the alias proof budget.
const aliasId = module.functions.length;
const padded: ModuleIR = {
  ...module,
  records: [
    ...(module.records ?? []),
    ...Array.from({ length: 100000 }, () => ({ byteLength: 16, fields: [] })),
  ],
  functions: [
    ...module.functions,
    { ...module.functions[read]!, id: aliasId, name: "readAlias" },
  ],
};
const sparseProof = lowerReferenceLists(
  padded,
  [binding],
  [entry],
  transformed.work + 10000,
  [{ function: aliasId, canonical: read }],
);
assert.ok(sparseProof, "unused layouts exhausted the alias proof budget");
assert.ok(
  sparseProof.rewritten > transformed.rewritten,
  "equivalent alias was not rewritten",
);
module = transformed.module;
assert.deepEqual(verify(module), { ok: true });
const emitted = emitDarwinModule(module, {
  maxByteLength: 16777216,
  debugSpans: false,
  linearAllocation: true,
  generationalBarriers: false,
});
assert.ok(emitted.ok, JSON.stringify(emitted));
const wrapper: Instruction[] = [],
  emit = (op: Instruction) => wrapper.push(op);
const imm = (rd: number, immediate: number) =>
  emit({ op: "movz", width: 64, rd, immediate, shift: 0 });
const address = (rd: number, immediate: number) =>
  emit({
    op: "add-imm",
    width: 64,
    rd,
    rn: "sp",
    immediate,
    shift: 0,
    setFlags: false,
  });
const pointer = (offset: number, target: number) => {
  address(9, target);
  emit({ op: "str", width: 64, rt: 9, rn: "sp", offset });
};
emit({
  op: "stp",
  width: 64,
  rt: 29,
  rt2: 30,
  rn: "sp",
  offset: -16,
  mode: "pre",
});
emit({
  op: "sub-imm",
  width: 64,
  rd: "sp",
  rn: "sp",
  immediate: 16,
  shift: 12,
  setFlags: false,
});
// A 64 KiB frame: the result area at 0, the 96-byte native context at 32
// (heap base at +8, allocation region pointer at +56; the stack limit at +72
// and the engine-throw word at +80 stay zero), the allocation region at 160
// with its mark bitmap at 512, and a 32 KiB heap at 1024.
for (let offset = 0; offset < 1024; offset += 8)
  emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
pointer(40, 1024);
pointer(88, 160);
pointer(176, 512);
imm(9, 32768);
emit({ op: "str", width: 32, rt: 9, rn: "sp", offset: 164 });
address(0, 32);
imm(1, 0);
imm(2, 0);
address(3, 0);
const call = wrapper.length * 4;
emit({ op: "bl", displacement: 0 });
// Status 1 is a normal return with the number in the result area; any
// other status (a throw) exits 70 plus the status.
emit({
  op: "sub-imm",
  width: 64,
  rd: "zr",
  rn: 0,
  immediate: 1,
  shift: 0,
  setFlags: true,
});
emit({ op: "b.cond", condition: "ne", displacement: 16 });
emit({ op: "ldr-d", rt: 0, rn: "sp", offset: 16 });
emit({ op: "fcvtzs-x-d", rd: 0, rn: 0 });
emit({ op: "b", displacement: 8 });
emit({
  op: "add-imm",
  width: 64,
  rd: 0,
  rn: 0,
  immediate: 70,
  shift: 0,
  setFlags: false,
});
emit({
  op: "add-imm",
  width: 64,
  rd: "sp",
  rn: "sp",
  immediate: 16,
  shift: 12,
  setFlags: false,
});
emit({
  op: "ldp",
  width: 64,
  rt: 29,
  rt2: 30,
  rn: "sp",
  offset: 16,
  mode: "post",
});
emit({ op: "ret", rn: 30 });
const base = wrapper.length * 4,
  code = new Uint8Array(base + emitted.value.code.length);
wrapper.forEach((op, i) =>
  assert.ok(writeInstruction(code, i * 4, op).ok, JSON.stringify(op)),
);
code.set(emitted.value.code, base);
assert.ok(
  patchBranch(code, {
    offset: call,
    targetOffset: base + emitted.value.functions[entry]!.offset,
    branch: { op: "bl" },
  }).ok,
);
const image = buildAArch64Executable({
  code,
  entryOffset: 0,
  identifier: "tint.reference-list-policy",
  minimumOS: { major: 26, minor: 6, patch: 2 },
  sdk: { major: 26, minor: 6, patch: 0 },
  maxByteLength: 16777216,
});
assert.ok(image.ok, JSON.stringify(image));
const directory = mkdtempSync(join(tmpdir(), "tint-reference-list-policy-")),
  path = join(directory, "policy");
try {
  const nodeFixture = join(directory, "reference.ts");
  writeFileSync(
    nodeFixture,
    prefix +
      suite +
      "\nif(run()!==42)throw Error('reference list behavior mismatch');\n",
  );
  const referenceRun = spawnSync(process.execPath, [nodeFixture], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(referenceRun.error, undefined);
  assert.equal(
    referenceRun.status,
    0,
    referenceRun.stdout + referenceRun.stderr,
  );
  writeFileSync(path, image.value.bytes, { mode: 0o755 });
  for (let i = 0; i < 2; i++) {
    const result = spawnSync("/usr/bin/lldb", ["--batch", "-o", "run", path], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /exited with status = 42 /, result.stdout);
  }
  console.log(
    "Verified generated reference-list growth, overwrite, holes, undefined, deletion, shrink/regrow, sparse migration, identity and invalid indices twice under LLDB.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
