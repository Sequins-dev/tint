import { emitDarwinModule } from "./aarch64-executable.ts";
import { buildAArch64Executable } from "./aarch64-executable.ts";
import {
  testWorkspaceModules,
  collectionFixtureLocations,
  numericFixtureLocations,
} from "./test-workspace-modules.ts";
import { bindingIdentifiers } from "@tint/typescript/syntax";
import { classDefinitionFixture } from "./class-definition-fixture.ts";
import { classConstructionBodyFixture } from "./class-construction-body-fixture.ts";
import { classNewFixture } from "./class-new-fixture.ts";
import { classConstructorFixture } from "./class-constructor-fixture.ts";
import { functionEnvironmentFixture } from "./function-environment-fixture.ts";
import { functionCallFixtures } from "./function-call-fixtures.ts";
import { receiverSourceFixtures } from "./receiver-source-fixtures.ts";
import { receiverIRFixture } from "./receiver-ir-fixture.ts";
import { classRecordFixture } from "./class-record-fixture.ts";
import {
  prototypeRecordFixture,
  prototypeMutationFixture,
} from "./prototype-record-fixture.ts";
import {
  compileArm64Program,
  type CompileRequest,
} from "@tint/compiler/native";
import {
  largeFrameFixture,
  largeImageFixture,
  largeBranchFixture,
} from "./large-frame-fixture.ts";
import {
  generalValueFixture,
  generalExceptionFixture,
} from "./general-value-fixture.ts";
import { prepareCollectionRuntimes } from "@tint/ts-native/runtime";
import { primitiveUnionFixture } from "./primitive-union-fixture.ts";
import {
  handleNativeTestTraps,
  nativeTrapStatus,
} from "./native-test-traps.ts";
import {
  ownedClosureFixture,
  ownedClosureSiblingsFixture,
  ownedClosureReferenceFixture,
} from "./owned-closure-fixture.ts";
import { functionValueFixture } from "./function-value-fixtures.ts";
import { bindModule } from "@tint/typescript/binding";
import { signCode } from "@tint/image/darwin/signature";
import {
  prepareNumericModule,
  prepareModuleInstance,
  type ModuleInstanceExport,
  specializeModule,
  specializeCheckedRoots,
} from "@tint/ts-native/modules";
import { createHash } from "node:crypto";
// Compile the unchanged TS allocator, then allocate native records through its private ABI.
import assert from "node:assert/strict";
import { optimizeModule } from "@tint/ir/optimization";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  writeInstruction,
  patchBranch,
  patchAddress,
  type Instruction,
} from "@tint/codegen/aarch64/isa";
import type { Instruction as IRInstruction } from "@tint/ir/scalar";
import { type NativeRootFrame } from "@tint/codegen/aarch64/scalar";
import { createSourceText } from "@tint/source/text";
import {
  parseModule,
  rewriteModule,
  type Module,
} from "@tint/typescript/syntax";
import {
  linkModules,
  locateSource,
  prepareNativeGlobals,
} from "@tint/ts-native/modules";
import type { SourceModule } from "@tint/typescript/modules/model";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  planScalarClosures,
  lowerClosureFactory,
  lowerModuleEntries,
} from "@tint/ts-native/closure/lowering";
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const target = {
    pointerSize: 8,
    wordSize: 8,
    allocationAlignment: 16,
    frameAlignment: 16,
    maxAlignment: 16,
  } as const,
  s = { start: 0, end: 0 };
const bytes = new TextEncoder().encode(
    readFileSync(
      new URL(
        "../packages/native-runtime/src/allocators/region/index.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
  source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok);
const checked = checkClosureModule(parsed.value);
assert.ok(checked.ok);
const layouts = planScalarClosures(checked.value, target, 4096);
assert.ok(layouts.ok);
const environment = layouts.value.environments[0]!;
assert.ok(environment.layout.size <= 256);
const lowered = lowerClosureFactory(checked.value, 0, environment);
assert.ok(lowered.ok, JSON.stringify(lowered));
const allocator = emitDarwinModule(lowered.value.module);
assert.ok(allocator.ok);
const allocate = lowered.value.exports.find(
    (e) => e.name === "allocate",
  )!.function,
  used = lowered.value.exports.find((e) => e.name === "usedBytes")!.function;
const native = emitDarwinModule({
  records: [
    {
      byteLength: 32,
      fields: [
        { offset: 16, type: "number", mutable: false },
        { offset: 24, type: "reference", mutable: false },
      ],
    },
  ],
  functions: [
    {
      id: 0,
      name: "make",
      exported: true,
      parameters: [0, 1],
      slots: ["number", "reference"],
      returnType: "reference",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...s },
            { kind: "load", id: 1, slot: 1, ...s },
            { kind: "record-new", id: 2, record: 0, arguments: [0, 1], ...s },
          ],
          terminator: { kind: "return", value: 2, ...s },
        },
      ],
    },
  ],
});
assert.ok(native.ok, JSON.stringify(native));
const objectProgram = `
const OFFSET=10;
const TEXT="A\\u0000\\ud800";
interface Pair { lo:number; hi:number }
interface Wide { extra:number; hi:number; lo:number }
interface Box { readonly value:Pair; cache:number|undefined }
function pair(a:number,b:number):Wide {
  let x=a;
  return {hi:x=x+b,lo:x=x+2,extra:7};
}
function box(a:number,b:number):Box { return {value:pair(a,b),cache:1}; }
function total(b:Box):number { return b.value.lo+b.value.hi; }
function optional(p:{readonly lo:number|undefined}):number|undefined {return p.lo;}
function switchWork(n:number):number {
 let marks=0,result=0;
 switch(n=n+1){
  case (marks=marks+1):result=10;break;
  default:result=20;
  case (marks=marks+1):result=result+30;break;
 }
 return result*10+marks+n*1000;
}
function loopWork():number {
 let n=3,total=0;
 while(n>0){switch(n){case 1:n=0;continue;default:total=total+n;break;}n=n-1;}
 return total;
}
function textWork(text:string,n:number):number {return text.length*100000+text.charCodeAt(n);}
function run(n:number):number {
  if(textWork(TEXT,2)!==355296||!!""||"ab"==="ac")return -25;
  if(textWork(TEXT,99)===textWork(TEXT,99))return -26;
  if(TEXT.charCodeAt(undefined)!==65||TEXT.charCodeAt()!==65)return -27;
  if(switchWork(0)!==1101||switchWork(1)!==2302||switchWork(2)!==3502||loopWork()!==5)return -24;
  const b=box(n,OFFSET);
  const alias=b.value;
  alias.lo=alias.lo+2;
  b.cache=2; if(b.cache!==2)return -21;
  b.cache=undefined;if(b.cache!==undefined)return -22;
  if(optional(alias)!==n+14)return -23;
  return total(b);
}`;
function compileSource(
  text: string,
  numericLists = false,
  setElements: readonly string[] = [],
  mapKeys: readonly {
    key: string;
    value: string;
  }[] = [],
  stringLists = false,
  optimization: "none" | "basic" = "none",
) {
  const objectBytes = new TextEncoder().encode(text);
  const objectSource = createSourceText(objectBytes, objectBytes.length);
  assert.ok(objectSource.ok);
  const objectParsed = parseModule(objectSource.value);
  assert.ok(objectParsed.ok);
  return compileModule(
    objectParsed.value,
    undefined,
    numericLists,
    new Map(),
    setElements,
    mapKeys,
    stringLists,
    undefined,
    [],
    optimization,
  );
}
function compileModule(
  module: Module,
  entry?: number,
  numericLists = false,
  names: ReadonlyMap<string, string> = new Map(),
  setElements: readonly string[] = [],
  mapKeys: readonly {
    key: string;
    value: string;
  }[] = [],
  stringLists = false,
  entryName?: string,
  objectListTypes: readonly string[] = [],
  optimization: "none" | "basic" = "none",
) {
  const originalEntry =
    entry === undefined
      ? module.statements
          .filter((s) => s.kind === "function")
          .filter((s) => !s.typeParameters?.length)
          .at(-1)
      : undefined;
  const originalEntryName = entryName ?? originalEntry?.name;
  let hasGenerics = false;
  rewriteModule(module, {
    statement: (mapped, original) => {
      if (original.kind === "function" && original.typeParameters?.length)
        hasGenerics = true;
      return mapped;
    },
  });
  if (hasGenerics) {
    const bound = bindModule(module, [
      "undefined",
      "Set",
      "Map",
      "Number",
      "Math",
      "NaN",
      "Infinity",
      "Uint8Array",
      "Uint16Array",
      "Uint32Array",
      "Float64Array",
    ]);
    assert.ok(bound.ok, JSON.stringify(bound));
    const helperNames = [
      ...setElements.flatMap((element) =>
        [
          "createSet",
          "hasSet",
          "addSet",
          "deleteSet",
          "clearSet",
          "sizeSet",
          "createSetCursor",
          "advanceSetCursor",
          "readSetCursor",
        ].map((name) => ({ name, key: element, arguments: [element] })),
      ),
      ...[...(stringLists ? ["string"] : []), ...objectListTypes].flatMap(
        (element) =>
          [
            "createList",
            "readList",
            "writeList",
            "pushList",
            "lengthList",
            "hasList",
            "deleteList",
            "resizeList",
            ...(names.has("sortList") ? ["sortList"] : []),
          ].map((name) => ({ name, key: element, arguments: [element] })),
      ),
      ...mapKeys.flatMap(({ key, value }) =>
        [
          "createMap",
          "getMap",
          "hasMap",
          "setMap",
          "deleteMap",
          "clearMap",
          "sizeMap",
        ].map((name) => ({ name, key, arguments: [key, value] })),
      ),
    ];
    const roots = helperNames.map((request) => {
      const node = module.statements.find(
        (s) =>
          s.kind === "function" &&
          s.name === (names.get(request.name) ?? request.name),
      );
      const fn = bound.value.functions.find((f) => f.node === node);
      assert.ok(fn, request.name);
      return {
        function: fn.id,
        arguments: request.arguments.map((name) => {
          const type = { kind: "named" as const, name, start: 0, end: 0 };
          return [
            "createList",
            "readList",
            "writeList",
            "pushList",
            "lengthList",
            "hasList",
            "deleteList",
            "resizeList",
          ].includes(request.name)
            ? {
                kind: "union" as const,
                members: [
                  type,
                  {
                    kind: "named" as const,
                    name: "undefined",
                    start: 0,
                    end: 0,
                  },
                ],
                start: 0,
                end: 0,
              }
            : type;
        }),
      };
    });
    const prepared = specializeModule(module, bound.value, { roots });
    assert.ok(prepared.ok, JSON.stringify(prepared));
    module = prepared.value.module;
    const aliases = new Map(names);
    helperNames.forEach(({ name, arguments: args }, index) => {
      const generated = prepared.value.roots[index];
      assert.ok(generated);
      aliases.set(name + ":" + args.join(":"), generated);
    });
    names = aliases;
  }
  if (entry === undefined && originalEntryName !== undefined) {
    entry = module.statements
      .filter((s) => s.kind === "function")
      .findIndex((s) => s.name === originalEntryName);
    assert.ok(entry >= 0, "missing fixture entrypoint: " + originalEntryName);
  }
  const objectChecked = checkClosureModule(module);
  assert.ok(objectChecked.ok, JSON.stringify(objectChecked));
  const checkedModule = objectChecked.value;
  function helper(name: string): number {
    const declaration = module.statements.find(
        (s) => s.kind === "function" && s.name === (names.get(name) ?? name),
      ),
      fn = checkedModule.bindings.functions.find((f) => f.node === declaration);
    assert.ok(fn, name);
    return fn.id;
  }
  function helperElement(
    name: string,
    id: number,
    index: number,
  ): "number" | "string" | number {
    if (name === "number" || name === "string") return name;
    const parameter = checkedModule.bodies.get(id)?.parameters[index];
    const binding = checkedModule.bindings.bindings.find(
      (b) => b.node === parameter,
    );
    const type =
      binding === undefined
        ? undefined
        : checkedModule.bindingTypes[binding.id];
    assert.notEqual(type, undefined);
    return type!;
  }
  const runtime = numericLists
    ? {
        create: helper("createNumberList"),
        read: helper("readNumberList"),
        write: helper("writeNumberList"),
        push: helper("pushNumberList"),
        length: helper("lengthNumberList"),
        has: helper("hasNumberList"),
        delete: helper("deleteNumberList"),
        resize: helper("resizeNumberList"),
        ...(names.has("sortNumberList")
          ? { sort: helper("sortNumberList") }
          : {}),
      }
    : undefined;
  const objectLowered = lowerModuleEntries(
    objectChecked.value,
    objectChecked.value.bindings.functions
      .filter((f) => f.parent === undefined)
      .map((f) => f.id),
    target,
    4096,
    {
      ...(module.statements.some(
        (s) => s.kind === "function" && s.name === "numberToString",
      )
        ? { numberToString: helper("numberToString") }
        : {}),
      ...(module.statements.some(
        (s) => s.kind === "function" && s.name === "stringToNumber",
      )
        ? { numberFromString: helper("stringToNumber") }
        : {}),
      lists: [
        ...(runtime === undefined
          ? []
          : [{ element: "number" as const, runtime }]),
        ...[...(stringLists ? ["string"] : []), ...objectListTypes].map(
          (name) => {
            const write = helper("writeList:" + name);
            const parameter = checkedModule.bodies.get(write)?.parameters[2];
            const binding = checkedModule.bindings.bindings.find(
              (b) => b.node === parameter,
            );
            const type =
              binding === undefined
                ? undefined
                : checkedModule.bindingTypes[binding.id];
            assert.notEqual(type, undefined);
            const parameterType = checkedModule.types[type!];
            assert.ok(parameterType?.kind === "union");
            const present = parameterType.members.filter(
              (m) => checkedModule.types[m]?.kind !== "undefined",
            );
            const elementType =
              present.length === 1
                ? present[0]
                : checkedModule.types.findIndex(
                    (t) =>
                      t.kind === "union" &&
                      t.members.length === present.length &&
                      present.every((m) => t.members.includes(m)),
                  );
            assert.ok(elementType !== undefined && elementType >= 0);
            return {
              element: name === "string" ? ("string" as const) : elementType,
              runtime: {
                create: helper("createList:" + name),
                read: helper("readList:" + name),
                write,
                push: helper("pushList:" + name),
                length: helper("lengthList:" + name),
                has: helper("hasList:" + name),
                delete: helper("deleteList:" + name),
                resize: helper("resizeList:" + name),
                ...(names.has("sortList")
                  ? { sort: helper("sortList:" + name) }
                  : {}),
              },
            };
          },
        ),
      ],
      maps: mapKeys.map(({ key, value }) => ({
        key: helperElement(key, helper("setMap:" + key + ":" + value), 1),
        value: helperElement(value, helper("setMap:" + key + ":" + value), 2),
        runtime: {
          create: helper("createMap:" + key + ":" + value),
          get: helper("getMap:" + key + ":" + value),
          has: helper("hasMap:" + key + ":" + value),
          set: helper("setMap:" + key + ":" + value),
          delete: helper("deleteMap:" + key + ":" + value),
          clear: helper("clearMap:" + key + ":" + value),
          size: helper("sizeMap:" + key + ":" + value),
        },
      })),
      sets: setElements.map((element) => ({
        element: helperElement(element, helper("addSet:" + element), 1),
        runtime: {
          create: helper("createSet:" + element),
          has: helper("hasSet:" + element),
          add: helper("addSet:" + element),
          delete: helper("deleteSet:" + element),
          clear: helper("clearSet:" + element),
          size: helper("sizeSet:" + element),
          iterator: {
            create: helper("createSetCursor:" + element),
            advance: helper("advanceSetCursor:" + element),
            read: helper("readSetCursor:" + element),
          },
        },
      })),
    },
  );
  assert.ok(objectLowered.ok, JSON.stringify(objectLowered));
  const objectNative = emitDarwinModule(
    optimization === "basic"
      ? optimizeModule(objectLowered.value.module).module
      : objectLowered.value.module,
  );
  assert.ok(objectNative.ok, JSON.stringify(objectNative));
  return {
    native: objectNative.value,
    entry: entry ?? objectLowered.value.module.functions.length - 1,
  };
}
const objects = compileSource(objectProgram);
const concatenated = compileSource(`
interface TextBox {readonly text:string}
interface Counter {value:number}
function mark(c:Counter,s:string):string {c.value=c.value+1;if((s==="L"&&c.value!==1)||(s==="R"&&c.value!==2))return "bad";return s;}
function join(a:string,b:string):string{return a+b;}
function run(n:number):number {
 const empty=join("", ""); if(empty!==""||empty.length!==0)return -1;
 const a=join("A\\u0000", "\\ud800");
 const b=join(a,"😀");
 const c=join("",b);
 const d=join(c,"");
 if(a!=="A\\u0000\\ud800"||b!=="A\\u0000\\ud800😀")return -2;
 if(c!==b||d!==c||d.charCodeAt(2)!==55296)return -3;
 const box:TextBox={text:d};
 const e=join(box.text,"abcdefghijklmnopqrstuvwxyz");
 if(e!=="A\\u0000\\ud800😀abcdefghijklmnopqrstuvwxyz")return -4;
 if(a.length!==3||b.length!==5||box.text.length!==5)return -5;
 if(!e.startsWith(a)||!e.startsWith("😀",3)||e.startsWith("z",5)||!e.startsWith("",1/0)||!e.startsWith(a,undefined))return -7;
 const order:Counter={value:0};
 if(mark(order,"L")+mark(order,"R")!=="LR"||order.value!==2)return -6;
 return e.length;
}`);

const sliceText = "A\u0000\ud800😀";
const sliceCases: readonly [string, number | undefined, number | undefined][] =
  [
    [sliceText, undefined, undefined],
    [sliceText, -2, undefined],
    [sliceText, 1, 4],
    [sliceText, 4, 1],
    [sliceText, NaN, undefined],
    [sliceText, -Infinity, Infinity],
    [sliceText, Infinity, undefined],
    [sliceText, 0, NaN],
    [sliceText, 1.9, 4.9],
    [sliceText, -2.9, -0.5],
    [sliceText, undefined, -1],
    [sliceText, -0.5, Infinity],
    ["", -1, Infinity],
  ];
function numericSource(n: number | undefined): string {
  return n === undefined
    ? "undefined"
    : Number.isNaN(n)
      ? "(0/0)"
      : n === Infinity
        ? "(1/0)"
        : n === -Infinity
          ? "(-1/0)"
          : String(n);
}
const sliceExpected = sliceCases
  .map(([s, b, e]) => s.slice(b, e))
  .concat([sliceText.slice(), sliceText.slice(-2)]);
const sliceBytes = sliceExpected.reduce(
  (n, s) => n + Math.ceil((24 + 2 * s.length) / 16) * 16,
  0,
);
assert.equal(sliceBytes, 560);
const sliced = compileSource(`
function cut(s:string,b:number|undefined,e:number|undefined):string{return s.slice(b,e);}
${sliceCases.map(([s, b, e], i) => `function sliceCase${i}():boolean{return cut(${JSON.stringify(s)},${numericSource(b)},${numericSource(e)})===${JSON.stringify(sliceExpected[i])};}`).join("\n")}
function run(n:number):number {
${sliceCases.map((_, i) => `if(!sliceCase${i}())return -${i + 1};`).join("\n")}
 if(${JSON.stringify(sliceText)}.slice()!==${JSON.stringify(sliceText.slice())})return -20;
 if(${JSON.stringify(sliceText)}.slice(-2)!==${JSON.stringify(sliceText.slice(-2))})return -21;
 return 1;
}`);

const sourceArrays = compileSource(`
interface Owned {readonly bytes:Uint8Array;words:Uint32Array}
function wrap(bytes:Uint8Array,words:Uint32Array):Owned{return {bytes,words};}
function bytes(n:number|undefined):Uint8Array{return new Uint8Array(n);}
function half(n:number):Uint16Array{return new Uint16Array(n);}
function run(n:number):number {
 const a=bytes(3.9),b=half(3),c=new Uint32Array(3);
 const d=new Uint8Array(),e=new Uint16Array(undefined),f=bytes(0/0),g=bytes(-0.5);
 let calls=0;const h=new Uint32Array(calls+=3);
 if(calls!==3||h.length!==3)return -1;
 if(d.length!==0||e.length!==0||f.length!==0||g.length!==0)return -2;
 let zero=0;for(const value of a){zero+=value;}for(const value of b){zero+=value;}for(const value of c){zero+=value;}for(const value of h){zero+=value;}
 if(zero!==0)return -3;
 a[1]=257.9;b.fill(65537.75);c[1]=4294967297.9;
 const out=wrap(a,c);if(out.bytes!==a||out.words!==c)return -4;
 out.bytes[0]=8;if(a[0]!==8)return -5;a[0]=0;
 out.words=h;out.words[0]=9;if(h[0]!==9)return -6;
 let total=0;for(const value of a){total+=value;}for(const value of b){total+=value;}for(const value of c){total+=value;}
 return total;
}`);
const viewBounds: readonly (readonly (number | undefined)[])[] = [
  [],
  [undefined, undefined],
  [-2],
  [1.9, 4.9],
  [NaN, NaN],
  [-Infinity, Infinity],
  [Infinity],
  [4, 1],
  [-0.5, 2],
];
const viewModules = [1, 2, 4].map((width) => {
  const type =
    width === 1 ? "Uint8Array" : width === 2 ? "Uint16Array" : "Uint32Array";
  const original =
    width === 1
      ? new Uint8Array([10, 20, 30, 40, 50, 60])
      : width === 2
        ? new Uint16Array([10, 20, 30, 40, 50, 60])
        : new Uint32Array([10, 20, 30, 40, 50, 60]);
  const ownerBytes = Math.ceil((32 + 6 * width) / 16) * 16;
  const metadata = viewBounds.map((args) => {
    const v = original.subarray(args[0], args[1]);
    return {
      start: v.byteOffset / width,
      length: v.length,
      owner: 0,
      score: v.length * 1000 + [...v].reduce((n, x) => n + x, 0),
    };
  });
  const source = compileSource(`
function score(a:${type}):number{let n=a.length*1000;for(const x of a){n+=x;}return n;}
function bounded(a:${type},b:number|undefined,e:number|undefined):${type}{return a.subarray(b,e);}
${viewBounds.map((args, i) => `function case${i}(a:${type}):number{return score(${args.length === 0 ? "a.subarray()" : `bounded(a,${numericSource(args[0])},${numericSource(args[1])})`});}`).join("\n")}
function run(n:number):number{
 const a=new ${type}(6);for(let i=0;i<6;i++){a[i]=(i+1)*10;}
 ${metadata.map((m, i) => `if(case${i}(a)!==${m.score})return -${i + 1};`).join("\n")}
 const tail=a.subarray(-2),nested=tail.subarray(1);
 nested[0]=99;if(a[5]!==99||tail[1]!==99)return -20;
 a[4]=77;if(tail[0]!==77)return -21;
 return score(a);
}`);
  return {
    ...source,
    width,
    ownerBytes,
    bytes: ownerBytes + 11 * 48,
    metadata: [
      ...metadata,
      { start: 4, length: 2, owner: 0, score: 0 },
      { start: 5, length: 1, owner: ownerBytes + 9 * 48, score: 0 },
    ],
  };
});
const setModules = new Map<
  string,
  {
    native: ReturnType<typeof compileSource>["native"];
    entry: number;
    bytes: number;
    expected: number;
    capacity: number;
    thrown?: string;
    regionBytes?: number;
  }
>();
for (const [name, indirect, supplied] of [
  ["direct", false, true],
  ["indirect", true, true],
  ["direct-undefined", false, false],
  ["indirect-undefined", true, false],
] as const) {
  const emitted = emitDarwinModule(receiverIRFixture(indirect, supplied));
  assert.ok(emitted.ok, JSON.stringify(emitted));
  setModules.set("receiver-abi-" + name, {
    native: emitted.value,
    entry: 0,
    bytes: 48,
    capacity: Math.floor(512 / 48),
    expected: 42,
  });
}
/** Numeric fixtures use the real complete provider graph, not index text alone. */
function compileNumberText(text: string) {
  const names = [
    "number-text",
    "primitive-value",
    ...collectionFixtureLocations.keys(),
  ];
  const modules = testWorkspaceModules(
    names,
    undefined,
    new Map([...collectionFixtureLocations, ...numericFixtureLocations]),
  );
  modules.push(
    moduleSource(
      "main",
      "import {numberToString} from 'number-text';" +
        text.replace("function run(", "export function run("),
      [["number-text", "number-text"]],
    ),
  );
  const compiled = compileArm64Program({
    modules,
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: names.map((namespace) => ({ module: namespace, namespace })),
  });
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.notEqual(compiled.value.entry, undefined);
  return { native: compiled.value.native, entry: compiled.value.entry! };
}

for (const [name, text, bytes] of [
  ["decimal", "0.1", 6096],
  ["tie", "9007199254740993", 6144],
  ["subnormal", "5e-324", 22384],
  ["normal-boundary", "2.2250738585072014e-308", 22400],
  ["maximum", "1.7976931348623157e308", 20640],
  ["hex", "0x20000000000001", 4944],
] as const) {
  setModules.set("number-text-" + name, {
    ...compileNumberText(
      `function run(n:number):number{return Number(${JSON.stringify(text)})===${Number(text)}?1:-1;}`,
    ),
    bytes,
    regionBytes: bytes,
    capacity: 1,
    expected: 1,
  });
}
for (const [name, value, text, bytes] of [
  ["integer", 1, "1", 64],
  ["safe-integer", 9007199254740991, "9007199254740991", 1280],
  ["fraction", 0.5, "0.5", 816],
  ["negative", -0.5, "-0.5", 848],
  ["shortest", 0.1, "0.1", 13552],
] as const) {
  setModules.set("number-format-" + name, {
    ...compileNumberText(
      `function run(n:number):number{return numberToString(${value})===${JSON.stringify(text)}?1:-1;}`,
    ),
    bytes,
    regionBytes: bytes,
    capacity: 1,
    expected: 1,
  });
}
setModules.set("source-string-number", {
  ...compileNumberText(`interface Counter{value:number}
 function read(c:Counter):number{c.value=c.value+1;return c.value;}
 function run(n:number):number{const c:Counter={value:0};return String(read(c))==="1"&&c.value===1&&String(-0)==="0"&&String(0/0)==="NaN"&&String(1/0)==="Infinity"?1:-1;}`),
  bytes: 96,
  regionBytes: 96,
  capacity: 1,
  expected: 1,
});
setModules.set("source-string-primitives", {
  ...compileSource(`interface Counter{value:number}
 function absent(c:Counter):undefined{c.value=c.value+1;return undefined;}
 function run(n:number):number{const c:Counter={value:0};return String()===""&&String("hi")==="hi"&&String(true)==="true"&&String(false)==="false"&&String(absent(c))==="undefined"&&c.value===1?1:-1;}`),
  bytes: 32,
  capacity: 16,
  expected: 1,
});
setModules.set("number-format-concat", {
  ...compileNumberText(`
    interface Box {value:number}
    function left(b:Box):number{b.value=1;return b.value;}
    function right(b:Box):string{b.value=2;return ":";}
    function run(n:number):number{
      const box:Box={value:0};const text=left(box)+right(box)+true;
      return text==="1:true"&&box.value===2?1:-1;
    }`),
  bytes: 176,
  regionBytes: 176,
  capacity: 1,
  expected: 1,
});
setModules.set("number-format-zero-concat", {
  ...compileNumberText(`function run(n:number):number{
    if(numberToString(0/0)!=="NaN"||numberToString(1/0)!=="Infinity")return -2;
    return false+":"+(-0)==="false:0"?1:-1;
  }`),
  bytes: 96,
  capacity: 5,
  expected: 1,
});
for (const type of [
  "number",
  "string",
  "reference",
  "optional-number",
] as const) {
  const count = type === "number" ? 10 : 6;
  const emitted = emitDarwinModule(functionValueFixture(type, count));
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const bytes = 48 + (type === "reference" ? count * 32 : 0);
  setModules.set("function-values-" + type, {
    native: emitted.value,
    entry: 3,
    bytes,
    capacity: Math.floor(512 / bytes),
    expected: 1,
  });
}
{
  const base = functionValueFixture("string", 6);
  const emitted = emitDarwinModule({
    ...base,
    functions: base.functions.map((f) =>
      f.id === 0
        ? {
            ...f,
            blocks: [
              {
                id: 0,
                instructions: [],
                terminator: { kind: "throw-literal", value: "boom", ...s },
              },
            ],
          }
        : f,
    ),
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  setModules.set("function-values-throw", {
    native: emitted.value,
    entry: 3,
    bytes: 48,
    capacity: 10,
    expected: 0,
    thrown: "boom",
  });
}
{
  const emitted = emitDarwinModule(ownedClosureFixture());
  assert.ok(emitted.ok, JSON.stringify(emitted));
  setModules.set("owned-closure-counter", {
    native: emitted.value,
    entry: 2,
    bytes: 224,
    capacity: 2,
    expected: 139,
  });
}
{
  const emitted = emitDarwinModule(ownedClosureSiblingsFixture());
  assert.ok(emitted.ok, JSON.stringify(emitted));
  setModules.set("owned-closure-siblings", {
    native: emitted.value,
    entry: 3,
    bytes: 384,
    capacity: 1,
    expected: 139,
  });
}
for (const type of ["string", "reference"] as const) {
  const emitted = emitDarwinModule(ownedClosureReferenceFixture(type));
  assert.ok(emitted.ok, JSON.stringify(emitted));
  setModules.set("owned-closure-" + type, {
    native: emitted.value,
    entry: 2,
    bytes: type === "string" ? 176 : 240,
    capacity: 2,
    expected: 1,
  });
}
{
  const base = ownedClosureFixture();
  const emitted = emitDarwinModule({
    ...base,
    functions: base.functions.map((fn) =>
      fn.id !== 1
        ? fn
        : {
            ...fn,
            slots: ["number", "reference"],
            blocks: [
              {
                id: 0,
                instructions: [
                  {
                    kind: "record-new",
                    id: 0,
                    record: 0,
                    arguments: [undefined],
                    ...s,
                  },
                  {
                    kind: "record-new",
                    id: 1,
                    record: 1,
                    arguments: [0],
                    ...s,
                  },
                  {
                    kind: "function-new",
                    id: 2,
                    target: 0,
                    environment: 1,
                    ...s,
                  },
                  { kind: "store", slot: 1, value: 2, ...s },
                ],
                terminator: {
                  kind: "record-cell",
                  object: 0,
                  record: 0,
                  field: 0,
                  operation: "initialize",
                  slot: 0,
                  consequent: 1,
                  alternate: 2,
                  ...s,
                },
              },
              {
                id: 1,
                instructions: [{ kind: "load", id: 3, slot: 1, ...s }],
                terminator: { kind: "return", value: 3, ...s },
              },
              { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
            ],
          },
    ),
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  setModules.set("owned-closure-late-initialize", {
    native: emitted.value,
    entry: 2,
    bytes: 224,
    capacity: 2,
    expected: 139,
  });
}
const arrayTypes = ["Uint8Array", "Uint16Array", "Uint32Array"] as const;
function modelArray(type: string, length: number) {
  return type === "Uint8Array"
    ? new Uint8Array(length)
    : type === "Uint16Array"
      ? new Uint16Array(length)
      : new Uint32Array(length);
}
for (const destinationType of arrayTypes)
  for (const sourceType of arrayTypes) {
    const destination = modelArray(destinationType, 5),
      source = modelArray(sourceType, 3);
    source[0] = 257;
    source[1] = 65537;
    source[2] = 4294967295;
    destination.fill(9);
    destination.set(source, 1.9);
    destination.set(source);
    const expected = [...destination].reduce((a, b) => a + b, 0);
    const compiled = compileSource(`
function copy(a:${destinationType},b:${sourceType},n:number|undefined):void{return a.set(b,n);}
function run(n:number):number{
 const a=new ${destinationType}(5),b=new ${sourceType}(3);b[0]=257;b[1]=65537;b[2]=4294967295;a.fill(9);
 copy(a,b,1.9);a.set(new ${sourceType}(),5);copy(a,b,undefined);
 if(b[0]!==${source[0]}||b[1]!==${source[1]}||b[2]!==${source[2]})return -1;
 let total=0;for(const value of a){total+=value;}return total;
}`);
    setModules.set("set-" + destinationType + "-" + sourceType, {
      ...compiled,
      bytes: (destinationType === "Uint32Array" ? 64 : 48) + 176,
      expected,
      capacity: 2,
    });
  }
for (const destinationType of arrayTypes)
  for (const sourceType of arrayTypes) {
    const source = modelArray(sourceType, 5);
    source[0] = 1;
    source[1] = 257;
    source[2] = 65537;
    source[3] = 4294967295;
    source[4] = 5;
    const expectedArray = modelArray(destinationType, 3);
    expectedArray.set(source.subarray(1, 4));
    const expected = [...expectedArray].reduce((a, b) => a + b, 0);
    const compiled = compileSource(`
function input(a:${sourceType}):${sourceType}{a[0]=(a[0]??0)+1;return a.subarray(1,4);}
function run(n:number):number{
 const a=new ${sourceType}(5);a[0]=1;a[1]=257;a[2]=65537;a[3]=4294967295;a[4]=5;
 const b=new ${destinationType}(input(a));
 if(a[0]!==2||b.length!==3)return -1;
 let total=0;for(const value of b){total+=value;}
 b[0]=42;if(a[1]!==${source[1]})return -2;
 a[2]=7;if(b[1]!==${expectedArray[1]})return -3;
 const empty=new ${destinationType}(new ${sourceType}());
 if(empty.length!==0)return -4;
 return total;
}`);
    setModules.set("copy-" + destinationType + "-" + sourceType, {
      ...compiled,
      bytes: sourceType === "Uint32Array" ? 224 : 208,
      expected,
      capacity: 2,
    });
  }
for (const type of arrayTypes) {
  const compiled = compileSource(`
function receiver(a:${type}):${type}{a[0]=(a[0]??0)+10;return a;}
function source(a:${type}):${type}{a[1]=(a[1]??0)+20;return a.subarray(0,2);}
function offset(a:${type}):number{a[2]=(a[2]??0)+30;return 2;}
function run(n:number):number{
 const a=new ${type}(6);for(let i=0;i<6;i++){a[i]=i+1;}
 a.set(a.subarray(0,4),2);if(a[2]!==1||a[3]!==2||a[4]!==3||a[5]!==4)return -1;
 a.set(a.subarray(2),0);if(a[0]!==1||a[1]!==2||a[2]!==3||a[3]!==4)return -2;
 a.set(a);a.set(a.subarray(6),6);
 receiver(a).set(source(a),offset(a));
 let total=0;for(const value of a){total+=value;}return total;
}`);
  setModules.set("set-overlap-" + type, {
    ...compiled,
    bytes: type === "Uint32Array" ? 464 : 432,
    expected: 73,
    capacity: 1,
  });
}
setModules.set("float64-storage", {
  ...compileSource(`
function run(n:number):number{
 const a=new Float64Array(6);
 a[0]=-0;a[1]=0.1;a[2]=0/0;a[3]=1/0;a[4]=-1/0;a[5]=5e-324;
 if(1/(a[0]??1)!==-1/0||a[1]!==0.1||a[3]!==1/0||a[4]!==-1/0||a[5]!==5e-324)return -1;
 if((a[6]??77)!==77)return -2;
 a[6]=99;a[-1]=99;if(a.length!==6)return -3;
 const view=a.subarray(1,3),copy=new Float64Array(view);
 let nan=copy[1]??1;if(copy[0]!==0.1||nan===nan)return -4;
 view[0]=0.25;if(a[1]!==0.25)return -5;a[1]=0.1;
 a.set(a.subarray(0,3),1);
 nan=a[3]??1;if(1/(a[1]??1)!==-1/0||a[2]!==0.1||nan===nan)return -6;
 copy.fill(-0);if(1/(copy[0]??1)!==-1/0)return -7;
 const b=new Uint32Array(2);b.set(copy);if(b[0]!==0||b[1]!==0)return -8;
 copy.set(b);if(1/(copy[0]??1)!==1/0)return -9;
 return 1;
}`),
  bytes: 432,
  expected: 1,
  capacity: 1,
});
for (const type of arrayTypes) {
  const source = new Float64Array([
    -1.9,
    65537.5,
    4294967297.9,
    NaN,
    Infinity,
    -0,
  ]);
  const expected = modelArray(type, 6);
  expected.set(source);
  setModules.set("float64-conversion-" + type, {
    ...compileSource(`function run(n:number):number{
 const a=new Float64Array(6);a[0]=-1.9;a[1]=65537.5;a[2]=4294967297.9;a[3]=0/0;a[4]=1/0;a[5]=-0;
 const b=new ${type}(a),c=new Float64Array(b);
 ${[...expected].map((v, i) => `if(b[${i}]!==${v}||c[${i}]!==${v})return -${i + 1};`).join("\n")}
 return 1;
}`),
    bytes: type === "Uint32Array" ? 224 : 208,
    expected: 1,
    capacity: 2,
  });
}
setModules.set("number-list", {
  ...compileSource(
    readFileSync(
      new URL(
        "../packages/foundation/src/collections/number-list.ts",
        import.meta.url,
      ),
      "utf8",
    ) +
      `
function run(n:number):number{
 const list=createNumberList(8);resizeNumberList(list,-0);if(1/list.length!==1/0)return -8;
 writeNumberList(list,1,undefined);if(readNumberList(list,1)!==undefined||list.present[1]!==2)return -9;
 writeNumberList(list,0,-0);writeNumberList(list,3,0/0);writeNumberList(list,7,5e-324);
 if(!hasNumberList(list,1)||hasNumberList(list,2))return -10;
 if(pushNumberList(list,0.1)!==9||list.values.length!==16||list.present[1]!==2)return -1;
 let nan=readNumberList(list,3)??1;if(nan===nan)return -2;
 if(1/(readNumberList(list,0)??1)!==-1/0||readNumberList(list,7)!==5e-324)return -3;
 if(popNumberList(list)!==0.1)return -4;
 resizeNumberList(list,2);resizeNumberList(list,8);
 if(readNumberList(list,3)!==undefined||readNumberList(list,7)!==undefined)return -5;
 if(!deleteNumberList(list,1)||deleteNumberList(list,1)||list.length!==8)return -11;
 writeNumberList(list,1,1/0);pushNumberList(list,-1/0);
 if(popNumberList(list)!==-1/0||readNumberList(list,1)!==1/0)return -6;
 return pushNumberList(list,0.5)===9?1:-7;
}`,
  ),
  bytes: 400,
  expected: 1,
  capacity: 1,
});
const listRuntimeSource = readFileSync(
  new URL(
    "../packages/foundation/src/collections/number-list.ts",
    import.meta.url,
  ),
  "utf8",
);
setModules.set("source-every-short-circuit", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values=[1,0,3];
    const result=values.every((value,index,array):number=>{array[0]=index;return value;});
    return !result&&values[0]===1?1:-1;
  }`,
    true,
  ),
  bytes: 208,
  capacity: 2,
  expected: 1,
});
setModules.set("source-every-sparse", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values:(number|undefined)[]=[0,undefined];values[4]=7;
    const result=values.every((value,index,array):boolean=>{
      if(index===0){array.pop();array[5]=9;}
      array[0]=(array[0]??0)+1;
      return index===0||index===1&&value===undefined;
    });
    return result&&values[0]===2&&values.length===6?1:-1;
  }`,
    true,
  ),
  bytes: 336,
  capacity: 1,
  expected: 1,
});
setModules.set("source-every-empty", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values:number[]=[];return values.every(():boolean=>{throw "unexpected callback";})?1:-1;
  }`,
    true,
  ),
  bytes: 160,
  capacity: 3,
  expected: 1,
});
setModules.set("source-find-index-before-mutation", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values=[1,2,3];
    const found=values.findIndex((value,index,array):boolean=>{array[0]=9;return true;});
    return found===0&&values[0]===9?1:-1;
  }`,
    true,
  ),
  bytes: 208,
  capacity: 2,
  expected: 1,
});
setModules.set("source-find-index-holes", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values=[0,1,2];
    const found=values.findIndex((value,index,array):boolean=>{
      if(index===0){array.pop();array[4]=7;}
      array[0]=(array[0]??0)+1;
      return index===2&&value===undefined;
    });
    return found===2&&values[0]===3&&values.length===5?1:-1;
  }`,
    true,
  ),
  bytes: 352,
  capacity: 1,
  expected: 1,
});
setModules.set("source-find-index-no-match", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values=[0,0/0,-0];return values.findIndex(value=>value)===-1?1:-1;
  }`,
    true,
  ),
  bytes: 208,
  capacity: 2,
  expected: 1,
});
setModules.set("source-find-index-empty", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values:number[]=[];
    return values.findIndex(():boolean=>{throw "unexpected callback";})===-1?1:-1;
  }`,
    true,
  ),
  bytes: 160,
  capacity: 3,
  expected: 1,
});
setModules.set("source-find-before-mutation", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values=[1,2,3];
    const found=values.find((value,index,array):boolean=>{array[0]=9;return true;});
    return found===1&&values[0]===9?1:-1;
  }`,
    true,
  ),
  bytes: 208,
  capacity: 2,
  expected: 1,
});
setModules.set("source-find-holes", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values=[0,1,2];
    const found=values.find((value,index,array):boolean=>{
      if(index===0){array.pop();array[4]=7;}
      array[0]=(array[0]??0)+1;
      return index===2&&value===undefined;
    });
    return found===undefined&&values[0]===3&&values.length===5?1:-1;
  }`,
    true,
  ),
  bytes: 352,
  capacity: 1,
  expected: 1,
});
setModules.set("source-find-no-match", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values=[0,0/0,-0];return values.find(value=>value)===undefined?1:-1;
  }`,
    true,
  ),
  bytes: 208,
  capacity: 2,
  expected: 1,
});
setModules.set("source-find-empty", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values:number[]=[];
    return values.find(():boolean=>{throw "unexpected callback";})===undefined?1:-1;
  }`,
    true,
  ),
  bytes: 160,
  capacity: 3,
  expected: 1,
});
setModules.set("source-some-short-circuit", {
  ...compileSource(
    listRuntimeSource +
      `
    function run(n:number):number{
      const source=[0,2,3];
      const found=source.some((value,index,array):number=>{array[0]=index;array[2]=9;return value;});
      return found&&source[0]===1&&source[2]===9?1:-1;
    }
  `,
    true,
  ),
  bytes: 208,
  capacity: 2,
  expected: 1,
});
setModules.set("source-some-sparse", {
  ...compileSource(
    listRuntimeSource +
      `
    function run(n:number):number{
      const source:(number|undefined)[]=[0,undefined];source[4]=3;
      const found=source.some((value,index,array):number=>{
        if(index===0){array.pop();array.push(9);}
        if(index===1)array.push(10);
        array[0]=(array[0]??0)+1;return 0;
      });
      return !found&&source[0]===3&&source.length===6&&source[4]===9?1:-1;
    }
  `,
    true,
  ),
  bytes: 336,
  capacity: 1,
  expected: 1,
});
setModules.set("source-some-truthiness", {
  ...compileSource(
    listRuntimeSource +
      `
    function run(n:number):number{
      const source:(number|undefined)[]=[0/0,-0,undefined];
      if(source.some(value=>value))return -1;
      source[2]=2;return source.some(value=>value)?1:-2;
    }
  `,
    true,
  ),
  bytes: 256,
  capacity: 2,
  expected: 1,
});
setModules.set("source-some-empty", {
  ...compileSource(
    listRuntimeSource +
      `
    function run(n:number):number{
      const source:number[]=[];
      return source.some(():number=>{throw "unexpected callback";})?-1:1;
    }
  `,
    true,
  ),
  bytes: 160,
  capacity: 3,
  expected: 1,
});
setModules.set("indexed-sort-record", {
  ...compileSource(
    readFileSync(
      new URL(
        "../packages/foundation/src/collections/indexed-sort.ts",
        import.meta.url,
      ),
      "utf8",
    ) +
      `
 interface Values {a:number;b:number;c:number}
 function run(n:number):number {
 const values:Values={a:3,b:1,c:2};
 const access:IndexedAccess<number>={
 length:()=>3,has:i=>i<3,
 read:i=>i===0?values.a:i===1?values.b:values.c,
 write:(i,v)=>{if(v===undefined)throw "unexpected undefined";if(i===0)values.a=v;else if(i===1)values.b=v;else values.c=v;},
 remove:i=>{throw "unexpected hole";}
 };
 sortIndexed<number>(access,(a,b)=>a-b);
 return values.a===1&&values.b===2&&values.c===3?1:-1;
 }`,
  ),
  bytes: 592,
  regionBytes: 592,
  capacity: 1,
  expected: 1,
});
setModules.set("source-array-default-dependent", {
  ...compileSource(
    listRuntimeSource +
      `function pair(a:number[]=[1],b:readonly number[]=a):number{a[0]=7;return b[0]??-1;}
 function run(n:number):number{return pair()===7&&pair([2])===7&&pair(undefined,[3])===3?1:-1;}`,
    true,
  ),
  bytes: 576,
  regionBytes: 576,
  capacity: 1,
  expected: 1,
});
setModules.set("source-array-default-number", {
  ...compileSource(
    listRuntimeSource +
      `function append(a:number[]=[]):number[]{a.push(1);return a;}
 function run(n:number):number{const first=append(),second=append(undefined),supplied=[7];const third=append(supplied);first[0]=9;return second[0]===1&&supplied.length===2&&third[0]===7?1:-1;}`,
    true,
  ),
  bytes: 704,
  regionBytes: 704,
  capacity: 1,
  expected: 1,
});
setModules.set("source-filter-mutation", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values=[1,0,3];
    const result=values.filter((value,index,array):number=>{if(index===0)array.pop();array[index]=9;return value;});
    return result.length===1&&result[0]===1&&values.length===2&&values[0]===9?1:-1;
  }`,
    true,
  ),
  bytes: 432,
  capacity: 1,
  expected: 1,
});
setModules.set("source-filter-empty", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values:number[]=[];const result=values.filter(():boolean=>{throw "unexpected callback";});return result.length===0?1:-1;
  }`,
    true,
  ),
  bytes: 272,
  capacity: 1,
  expected: 1,
});
setModules.set("source-filter-none", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values=[0,0/0,-0];const result=values.filter(value=>value);return result.length===0?1:-1;
  }`,
    true,
  ),
  bytes: 320,
  capacity: 1,
  expected: 1,
});
setModules.set("source-filter-undefined", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{
    const values:(number|undefined)[]=[undefined,0];const result=values.filter(value=>value===undefined);return result.length===1&&result[0]===undefined?1:-1;
  }`,
    true,
  ),
  bytes: 416,
  capacity: 1,
  expected: 1,
});
setModules.set("source-map-sparse", {
  ...compileSource(
    listRuntimeSource +
      `
    function run(n:number):number{
      const source:(number|undefined)[]=[1,undefined];source[4]=3;
      const mapped=source.map((value,index,array):number=>{
        if(index===0){array.pop();array.push(9);}
        if(index===1)array.push(10);
        return value??77;
      });
      if(mapped.length!==5||source.length!==6)return -1;
      if(mapped[0]!==1||mapped[1]!==77||mapped[2]!==undefined||mapped[3]!==undefined||mapped[4]!==9)return -2;
      return 1;
    }
  `,
    true,
  ),
  bytes: 512,
  capacity: 1,
  expected: 1,
});
setModules.set("source-map-number", {
  ...compileSource(
    listRuntimeSource +
      `
    function run(n:number):number{
      const source=[1,2,3];
      const mapped=source.map((value:number|undefined,index,array)=>(value??0)+index+array.length);
      if(mapped.length!==3||mapped[0]!==4||mapped[1]!==6||mapped[2]!==8)return -1;
      if(source[0]!==1||source.length!==3)return -2;
      return 1;
    }
  `,
    true,
  ),
  bytes: 368,
  capacity: 1,
  expected: 1,
});
setModules.set("source-list-slice-number", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{const a=[1,2,3];const b=a.slice(-2,undefined);b[0]=7;return a[1]===2&&b.length===2&&b[0]===7&&b[1]===3?1:-1;}`,
    true,
  ),
  bytes: 304,
  capacity: 1,
  expected: 1,
});
for (const [name, bounds, expected] of [
  ["all", "", [1, 2, 3]],
  ["fraction", "1.9,2.9", [2]],
  ["nan", "0/0", [1, 2, 3]],
  ["negative", "-2,-1", [2]],
  ["infinite", "-1/0,1/0", [1, 2, 3]],
  ["reversed", "2,1", []],
  ["past", "1/0", []],
  ["negative-end", "0,-1/0", []],
  ["undefined", "undefined,undefined", [1, 2, 3]],
] as const) {
  setModules.set("source-list-slice-" + name, {
    ...compileSource(
      listRuntimeSource +
        `function run(n:number):number{const a=[1,2,3];const b=a.slice(${bounds});return b.length===${expected.length}${expected.map((v, i) => `&&b[${i}]===${v}`).join("")}?1:-1;}`,
      true,
    ),
    bytes:
      160 + (expected.length === 0 ? 112 : expected.length <= 2 ? 144 : 160),
    capacity: 1,
    expected: 1,
  });
}
setModules.set("source-list-slice-holes", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{const a:(number|undefined)[]=[undefined];a[2]=3;const b=a.slice();return b.length===3&&b.indexOf(undefined)===0&&b.indexOf(undefined,1)===-1&&b.includes(undefined,1)?1:-1;}`,
    true,
  ),
  bytes: 416,
  capacity: 1,
  expected: 1,
});
setModules.set("source-list-slice-effects", {
  ...compileSource(
    listRuntimeSource +
      `interface Counter{value:number}
    function receiver(a:number[],c:Counter):number[]{c.value=c.value*10+1;return a;}
    function begin(a:number[],c:Counter):number{c.value=c.value*10+2;a.push(2);return 0;}
    function end(c:Counter):number|undefined{c.value=c.value*10+3;return undefined;}
    function run(n:number):number{const a=[1],c:Counter={value:0};const b=receiver(a,c).slice(begin(a,c),end(c));return c.value===123&&b.length===2&&b[1]===2?1:-1;}`,
    true,
  ),
  bytes: 432,
  capacity: 1,
  expected: 1,
});
setModules.set("source-list-index-of-number", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{const a:(number|undefined)[]=[0/0,-0,7];a[4]=undefined;
 if(a.indexOf(0/0)!==-1||a.indexOf(0)!==1||a.indexOf(undefined)!==4||a.indexOf(undefined,3)!==4)return -1;
 if(a.indexOf(7,1/0)!==-1||a.indexOf(7,-1/0)!==2||a.indexOf(7,-3)!==2||a.indexOf(0,1.9)!==1||a.indexOf(7,0/0)!==2)return -2;return 1;}`,
    true,
  ),
  bytes: 304,
  capacity: 1,
  expected: 1,
});
setModules.set("source-list-index-of-evaluation", {
  ...compileSource(
    listRuntimeSource +
      `interface Counter{calls:number}
 function receiver(a:number[],c:Counter):number[]{c.calls=c.calls*10+1;return a;}
 function search(a:number[],c:Counter):number{c.calls=c.calls*10+2;a.push(2);return 2;}
 function from(c:Counter):number{c.calls=c.calls*10+3;return 0;}
 function run(n:number):number{const a=[1],c:Counter={calls:0};const found=receiver(a,c).indexOf(search(a,c),from(c));return found===1&&c.calls===123?1:-1;}`,
    true,
  ),
  bytes: 288,
  capacity: 1,
  expected: 1,
});
setModules.set("source-list-index-of-empty", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{const a:number[]=[];return a.indexOf(undefined)===-1?1:-1;}`,
    true,
  ),
  bytes: 112,
  capacity: 4,
  expected: 1,
});
setModules.set("source-list-includes-number", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{const a:(number|undefined)[]=[0/0,-0,7];a[4]=undefined;
 if(!a.includes(0/0)||a.includes(0/0,1)||!a.includes(0)||!a.includes(undefined,3)||a.includes(0/0,3))return -1;
 if(a.includes(7,1/0)||!a.includes(7,-1/0)||!a.includes(7,-3)||a.includes(0/0,1.9))return -2;
 const nan=[0/0];if(nan.includes(undefined)||!nan.includes(0/0))return -3;return 1;}`,
    true,
  ),
  bytes: 448,
  capacity: 1,
  expected: 1,
});
setModules.set("source-pop-number", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number{const a=[-0,0/0];const nan=a.pop();
 if(nan===undefined||nan===nan||1/(a.pop()??1)!==-1/0||a.pop()!==undefined||a.length!==0)return -1;return 1;}`,
    true,
  ),
  bytes: 144,
  capacity: 3,
  expected: 1,
});
setModules.set("source-splice-number", {
  ...compileSource(
    listRuntimeSource +
      `function run(n:number):number {
  const a=[1,2,3];const b=a.splice(-2,1,7,8);
  if(a.length!==4||a[0]!==1||a[1]!==7||a[2]!==8||a[3]!==3||b.length!==1||b[0]!==2)return -1;
  return 1;
 }`,
    true,
  ),
  // Original list 160, removed list 224, growth to capacity four 112.
  bytes: 496,
  capacity: 1,
  expected: 1,
});
for (const [name, body, bytes, expected, capacity] of [
  [
    "source-list-hole-spread",
    `function run(n:number):number{
       const source=[1];source[2]=3;
       const copied=[...source];copied.push(undefined);source[0]=9;
       let sum=0,missing=0;
       for(const value of copied){if(value===undefined)missing++;else sum+=value;}
       return copied.length*100+missing*10+sum;
     }`,
    512,
    424,
    1,
  ],
  [
    "source-list-typed-spread",
    `function source(a:Uint8Array):Uint8Array{a[0]=(a[0]??0)+1;return a;}
     function tail(a:Uint8Array):number{a[0]=9;return 5;}
     function run(n:number):number{
       const input=new Uint8Array(2);input[0]=2;input[1]=4;
       const empty=new Float64Array(0);
       const copied=[0,...source(input),...empty,tail(input)];
       if(copied.length!==4||input[0]!==9)return -1;
       return (copied[0]??0)+(copied[1]??0)+(copied[2]??0)+(copied[3]??0);
     }`,
    240,
    12,
    2,
  ],
  [
    "source-list-holes",
    `function run(n:number):number{const a=[1,2];a.push(3,4);a[6]=0/0;if(a.push()!==7)return -1;a.push(-0);if(1/(a[7]??1)!==-1/0)return -2;let sum=0;for(const x of a){if(x===undefined)sum+=10;else if(x!==x)sum+=50;else sum+=x;}return sum;}`,
    400,
    80,
    1,
  ],
  [
    "source-list-growth",
    `function source(a:number[]):number[]{a[0]=(a[0]??0)+1;return a;}function run(n:number):number{const a=[0];let count=0,sum=0;for(const x of source(a)){sum+=x??0;if(count===0)a.push(2);count++;}return sum===3&&count===2&&(a[0]??0)===1?1:-1;}`,
    256,
    1,
    2,
  ],
  [
    "source-list-alias",
    `function run(n:number):number{let a=[1];const b=a;a[0]=(a=[9]).length+41;return (a[0]??0)+(b[0]??0);}`,
    288,
    51,
    1,
  ],
  [
    "source-list-push-order",
    `function run(n:number):number{const a=[1,2];const length=a.push(a.length,a.push(9));let total=length;for(const value of a){total+=value??0;}return total;}`,
    400,
    22,
    1,
  ],
] as const)
  setModules.set(name, {
    ...compileSource(listRuntimeSource + body, true),
    bytes,
    expected,
    capacity,
  });
function initializedSource(
  source: string,
  driver: (initializer: string) => string,
) {
  const input = new TextEncoder().encode(listRuntimeSource + source),
    text = createSourceText(input, input.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const prepared = prepareNumericModule(parsed.value, checked.value.bindings);
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.ok(prepared.value.initializer);
  const driverBytes = new TextEncoder().encode(
      driver(prepared.value.initializer.name),
    ),
    driverSource = createSourceText(driverBytes, driverBytes.length);
  assert.ok(driverSource.ok);
  const driverParsed = parseModule(driverSource.value);
  assert.ok(driverParsed.ok, JSON.stringify(driverParsed));
  return compileModule(
    {
      ...prepared.value.module,
      statements: [
        ...prepared.value.module.statements,
        ...driverParsed.value.statements,
      ],
    },
    undefined,
    true,
  );
}
setModules.set("module-state", {
  ...initializedSource(
    `const K=[1,2];function update():number{K[0]=(K[0]??0)+1;return K[0]??0;}function work():number{return update();}`,
    (init) =>
      `function run(n:number):number{const first=${init}(),second=${init}();const a=work(first),b=work(first),c=work(second);return a*100+b*10+c;}`,
  ),
  bytes: 352,
  expected: 232,
  capacity: 1,
});
for (const length of [0, 3, 55, 56, 64, 65, 1000]) {
  const input = Uint8Array.from({ length }, (_, i) => (i * 17 + 3) % 256);
  const digest = createHash("sha256").update(input).digest();
  const allocationBytes = 1152 + Math.ceil((32 + length) / 16) * 16;
  setModules.set("sha256-" + length, {
    ...compileLinkedInstance([
      [
        "main",
        `import {sha256} from "sha256";export function run():number {const input=new Uint8Array(${length});for(let i=0;i<input.length;i++)input[i]=(i*17+3)%256;const digest=sha256(input);${[...digest].map((v, i) => `if(digest[${i}]!==${v})return -${i + 1};`).join("")}return 1;}`,
      ],
      [
        "sha256",
        readFileSync("packages/foundation/src/binary/sha256.ts", "utf8"),
      ],
      [
        "./sha256-compression.ts",
        readFileSync(
          "packages/foundation/src/binary/sha256-compression.ts",
          "utf8",
        ),
      ],
    ]),
    bytes: allocationBytes,
    regionBytes: allocationBytes,
    expected: 1,
    capacity: 1,
  });
}
function initializedModules(
  inputs: readonly SourceModule[],
  entry: string,
  driver: (initializer: string) => string,
) {
  const linked = linkModules(inputs, entry, [
    "Number",
    "Math",
    "NaN",
    "Infinity",
    "undefined",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ]);
  assert.ok(linked.ok, JSON.stringify(linked));
  const checked = bindModule(linked.value.module, [
    "Number",
    "Math",
    "NaN",
    "Infinity",
    "undefined",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ]);
  assert.ok(checked.ok, JSON.stringify(checked));
  const prepared = prepareNumericModule(linked.value.module, checked.value);
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.ok(prepared.value.initializer);
  const names = new Map(
    linked.value.exports
      .filter(
        (e) =>
          e.namespace === "value" &&
          (e.module === entry || e.module === "number-list"),
      )
      .map((e) => [e.name, e.linkedName]),
  );
  const parsedDriver = moduleSource(
    "driver",
    driver(prepared.value.initializer.name),
    [],
  ).module;
  const mappedDriver = rewriteModule(parsedDriver, {
    expression: (mapped) =>
      mapped.kind === "identifier" && names.has(mapped.name)
        ? { ...mapped, name: names.get(mapped.name)! }
        : mapped,
  });
  const diagnosticCheck = checkClosureModule(prepared.value.module);
  assert.ok(
    diagnosticCheck.ok,
    JSON.stringify(
      diagnosticCheck.ok
        ? {}
        : {
            error: diagnosticCheck.error,
            origin: locateSource(linked.value, diagnosticCheck.error),
          },
    ),
  );
  return compileModule(
    {
      ...prepared.value.module,
      statements: [
        ...prepared.value.module.statements,
        ...mappedDriver.statements,
      ],
    },
    undefined,
    true,
    names,
  );
}
setModules.set("linked-module-state", {
  ...initializedModules(
    [
      moduleSource(
        "main",
        `import "number-list";import {K as first} from "data";import {K as second} from "data";export function work():number {first[0]=(first[0]??0)+1;return second[0]??0;}`,
        [
          ["number-list", "number-list"],
          ["data", "data"],
        ],
      ),
      moduleSource("data", "export const K=[1,2];", []),
      moduleSource("number-list", listRuntimeSource, []),
    ],
    "main",
    (init) =>
      `function run(n:number):number{const first=${init}(),second=${init}();const a=work(first),b=work(first),c=work(second);return a*100+b*10+c;}`,
  ),
  bytes: 352,
  expected: 232,
  capacity: 1,
});
for (const length of [0, 3, 4096, 4097]) {
  const input = Uint8Array.from({ length }, (_, i) => (i * 17 + 3) % 256);
  const expected = signCode(input, {
    identifier: "tint",
    executableOffset: 0,
    executableLength: length,
    mainExecutable: true,
  });
  assert.ok(expected.ok);
  // Include module-instance/reference-list initialization in the exact budget.
  // Independent native allocation probes distinguish exhaustion from byte checks;
  // the hosted signer fixture separately covers omitted optional fields.
  const allocationBytes =
    length === 0 ? 5440 : length === 3 ? 5952 : length === 4096 ? 10032 : 10544;
  setModules.set("signature-" + length, {
    ...compileLinkedInstance(
      [
        [
          "main",
          `import {signCode} from "@tint/image/darwin/signature";export function run():number {const input=new Uint8Array(${length});for(let i=0;i<input.length;i++)input[i]=(i*17+3)%256;const result=signCode(input,{identifier:"tint",executableOffset:0,executableLength:input.length,mainExecutable:true,specialBlobs:undefined});if(!result.ok)return -1;const bytes=result.value;if(bytes.length!==${expected.value.length})return -2;${[...expected.value].map((v, i) => `if(bytes[${i}]!==${v})return -${i + 3};`).join("")}return 1;}`,
        ],
        ...[
          [
            "@tint/image/darwin/signature",
            "packages/image/src/darwin/signature.ts",
          ],
          [
            "@tint/foundation/binary/bytes",
            "packages/foundation/src/binary/bytes.ts",
          ],
          ["./word64.ts", "packages/foundation/src/binary/word64.ts"],
          [
            "@tint/foundation/binary/sha256",
            "packages/foundation/src/binary/sha256.ts",
          ],
        ].map(([id, path]): [string, string] => {
          assert.ok(id !== undefined && path !== undefined);
          return [id, readFileSync(path, "utf8")];
        }),
        [
          "./sha256-compression.ts",
          readFileSync(
            "packages/foundation/src/binary/sha256-compression.ts",
            "utf8",
          ),
        ],
      ],
      "main",
      [{ module: "@tint/image/darwin/signature", name: "SignatureBlob" }],
    ),
    bytes: allocationBytes,
    regionBytes: allocationBytes,
    expected: 1,
    capacity: 1,
  });
}
setModules.set("typeof", {
  ...compileSource(`
    interface Box {readonly n:number}
    function label(n:number|undefined):string{return typeof n;}
    function touch(a:Uint8Array):number{a[0]=(a[0]??0)+1;return 7;}
    function finish(a:Uint8Array):void{a[0]=(a[0]??0)+1;}
    function run(n:number):number{
      const a=new Uint8Array(1),box:Box={n:1};
      if(typeof touch(a)!=="number"||a[0]!==1)return -1;
      if(typeof finish(a)!=="undefined"||a[0]!==2)return -2;
      if(label(undefined)!=="undefined"||label(0)!=="number"||label(0/0)!=="number")return -3;
      if(typeof true!=="boolean"||typeof "x"!=="string"||typeof a!=="object"||typeof box!=="object")return -4;
      return 1;
    }
  `),
  bytes: 80,
  expected: 1,
  capacity: 6,
});
setModules.set("source-guarded-optional-fields", {
  ...compileSource(`
    interface NumberBox {readonly value?:number}
    interface StringBox {readonly value?:string}
    interface Item {value:number}
    interface ObjectBox {readonly value?:Item}
    function number(box:NumberBox):number{if(box.value===undefined)return 0;return box.value;}
    function text(box:StringBox):number{if(box.value!==undefined)return box.value.length;return 0;}
    function object(box:ObjectBox):number{if(box.value===undefined)return 0;return box.value.value;}
    function absentText(box:StringBox):undefined{if(box.value===undefined)return box.value;return undefined;}
    function absentObject(box:ObjectBox):undefined{if(box.value===undefined)return box.value;return undefined;}
    function run(n:number):number{
      const a:NumberBox={value:4},b:NumberBox={};
      const c:StringBox={value:"abc"},d:StringBox={};
      const item:Item={value:5};const e:ObjectBox={value:item},f:ObjectBox={};
      if(absentText(d)!==undefined||absentObject(f)!==undefined)return -1;
      return number(a)+number(b)+text(c)+text(d)+object(e)+object(f);
    }
  `),
  bytes: 256,
  capacity: 2,
  expected: 12,
});
setModules.set("optional-presence", {
  ...compileSource(`
    interface R {value?:number|undefined}
    interface View {readonly value?:number|undefined}
    function read(r:View):number{return r.value??7;}
    function write(r:R,n:number|undefined):void{r.value=n;}
    function run(n:number):number {
      const absent:R={},explicit:R={value:undefined},written:R={};
      if(absent.value!==undefined||explicit.value!==undefined||read(written)!==7)return -1;
      write(written,-0);const zero=written.value;if(zero===undefined||1/zero!==-1/0)return -2;
      write(written,0/0);const nan=written.value;if(nan===undefined||nan===nan)return -3;
      write(written,undefined);if(written.value!==undefined)return -4;
      return 1;
    }
  `),
  bytes: 144,
  expected: 1,
  capacity: 3,
});
setModules.set("optional-presence-projection", {
  ...compileSource(`
    interface Required {readonly value:number}
    interface Optional {readonly value?:number}
    function read(r:Optional):number{return r.value??7;}
    function run(n:number):number {
      const required:Required={value:3},provided:Optional={value:-0},omitted:Optional={};
      if(read(required)!==3||1/read(provided)!==-1/0||read(omitted)!==7)return -1;
      return 1;
    }
  `),
  bytes: 128,
  expected: 1,
  capacity: 4,
});
setModules.set("source-optional-reference", {
  ...compileSource(`
    interface Node {readonly value:number;next?:Node|undefined}
    function empty():Node|undefined{return undefined;}
    function identity(a:Node|undefined,b:Node|undefined,c:Node|undefined,d:Node|undefined,e:Node|undefined,f:Node|undefined):Node|undefined{return f;}
    function choose(flag:boolean,node:Node):Node|undefined{return flag?node:undefined;}
    function read(node:Node|undefined):number{if(node===undefined)return 0;const next=node.next;return node.value+(next===undefined?0:next.value);}
    function fallback(node:Node|undefined,other:Node):Node{return node??other;}
    function run(n:number):number {
      const root:Node={value:2},tail:Node={value:3,next:undefined};
      if(root.next!==undefined||tail.next!==undefined)return -1;
      root.next=tail;if(read(root)!==5)return -2;
      const selected=identity(undefined,root,undefined,tail,root,tail);
      if(selected!==tail||typeof selected!=="object"||typeof empty()!=="undefined")return -3;
      if(choose(false,root)!==undefined||choose(true,root)!==root)return -4;
      if(fallback(empty(),root)!==root||fallback(tail,root)!==tail)return -5;
      const missing:undefined=undefined;const other:Node|undefined=missing;
      const recovered=other??root;if(recovered===undefined||recovered.value!==2)return -6;
      tail.next=root;root.next=undefined;if(read(tail)!==5||read(root)!==2)return -7;
      return 1;
    }
  `),
  bytes: 96,
  expected: 1,
  capacity: 5,
});
setModules.set("undefined-reference-effects", {
  ...compileSource(`
    interface Node {value:number}
    function missing(node:Node):undefined{node.value=node.value+1;return undefined;}
    function present(node:Node):Node|undefined{return node;}
    function boom():Node{throw "unexpected fallback";}
    function run(n:number):number {
      const node:Node={value:0};
      const absent:Node|undefined=missing(node);
      if(absent!==undefined||node.value!==1)return -1;
      const recovered=missing(node)??node;
      if(recovered!==node||node.value!==2)return -2;
      const chosen=present(node)??boom();
      if(chosen!==node)return -3;
      return 1;
    }
  `),
  bytes: 32,
  expected: 1,
  capacity: 16,
});
const stringSetSource = readFileSync(
  new URL(
    "../packages/foundation/src/collections/linked-set.ts",
    import.meta.url,
  ),
  "utf8",
);
setModules.set("set-cursor-live", {
  ...compileSource(
    stringSetSource +
      `function run(n:number):number{
    const set=createSet<number>();addSet<number>(set,1);addSet<number>(set,2);addSet<number>(set,3);
    const cursor=createSetCursor<number>(set);
    if(!advanceSetCursor<number>(cursor)||readSetCursor<number>(cursor)!==1)return -1;
    deleteSet<number>(set,2);addSet<number>(set,2);
    if(!advanceSetCursor<number>(cursor)||readSetCursor<number>(cursor)!==3)return -2;
    if(!advanceSetCursor<number>(cursor)||readSetCursor<number>(cursor)!==2)return -3;
    clearSet<number>(set);addSet<number>(set,4);
    if(!advanceSetCursor<number>(cursor)||readSetCursor<number>(cursor)!==4)return -4;
    if(advanceSetCursor<number>(cursor))return -5;
    addSet<number>(set,5);return advanceSetCursor<number>(cursor)?-6:1;
  }`,
  ),
  bytes: 400,
  capacity: 1,
  expected: 1,
});
setModules.set("source-set-for-of-live", {
  ...compileSource(
    stringSetSource +
      `function run(n:number):number{
    const set=new Set<number>();set.add(1).add(2).add(3);
    let result=0;
    for(const value of set){
      result=result*10+value;
      if(value===1){set.delete(2);set.add(2);}
      if(value===2){set.clear();set.add(4);}
    }
    return result;
  }`,
    false,
    ["number"],
  ),
  bytes: 352,
  capacity: 1,
  expected: 1324,
});
setModules.set("source-set-for-of-control", {
  ...compileSource(
    stringSetSource +
      `function run(n:number):number{
    const set=new Set<string>();set.add("a").add("b").add("c");
    let result="";
    for(const value of set){if(value==="b")continue;result+=value;if(value==="c")break;}
    return result==="ac"?1:-1;
  }`,
    false,
    ["string"],
  ),
  bytes: 320,
  capacity: 1,
  expected: 1,
});
setModules.set("source-set-for-of-captures", {
  ...compileSource(
    stringSetSource +
      `function run(n:number):number{
    const set=new Set<number>();set.add(2).add(7);
    let first=():number=>0,last=():number=>0;
    for(const value of set){const read=():number=>value;if(value===2)first=read;last=read;}
    return first()*10+last();
  }`,
    false,
    ["number"],
  ),
  bytes: 560,
  regionBytes: 560,
  capacity: 1,
  expected: 27,
});
setModules.set("source-set-for-of-constructor-zero", {
  ...compileSource(
    stringSetSource +
      `function run(n:number):number{
    const values=new Float64Array(1);values[0]=-0;
    const set=new Set<number>(values);for(const value of set)return 1/value===1/0?1:-1;return -2;
  }`,
    false,
    ["number"],
  ),
  bytes: 208,
  capacity: 2,
  expected: 1,
});
setModules.set("source-set-for-of-empty", {
  ...compileSource(
    stringSetSource +
      `
    interface Counter {calls:number}
    function receiver(set:ReadonlySet<number>,counter:Counter):ReadonlySet<number>{counter.calls=counter.calls+1;return set;}
    function run(n:number):number{
      const set=new Set<number>(),counter:Counter={calls:0};
      for(const value of receiver(set,counter)){throw "unexpected iteration";}
      return counter.calls;
    }`,
    false,
    ["number"],
  ),
  bytes: 144,
  capacity: 3,
  expected: 1,
});
setModules.set("source-set-for-of-zero", {
  ...compileSource(
    stringSetSource +
      `function run(n:number):number{
    const set=new Set<number>();set.add(-0);for(const value of set)return 1/value===1/0?1:-1;return -2;
  }`,
    false,
    ["number"],
  ),
  bytes: 160,
  capacity: 3,
  expected: 1,
});
const nativeStringSet = compileSource(
  stringSetSource +
    `
  function run(n:number):number {
    const set=createSet<string>();
    if(!addSet<string>(set,"a")||!addSet<string>(set,"b")||!addSet<string>(set,"c"))return -1;
    if(!addSet<string>(set,"a\\u0000b")||!addSet<string>(set,"\\ud800")||!addSet<string>(set,""))return -2;
    const equalText="a"+"\\u0000b";
    if(addSet<string>(set,"b")||addSet<string>(set,equalText)||sizeSet<string>(set)!==6)return -3;
    if(!hasSet<string>(set,"a\\u0000b")||!hasSet<string>(set,"\\ud800")||hasSet<string>(set,"a\\u0000c"))return -4;
    if(!deleteSet<string>(set,"")||!deleteSet<string>(set,"b")||!deleteSet<string>(set,"a"))return -5;
    if(deleteSet<string>(set,"missing")||sizeSet<string>(set)!==3)return -6;
    if(!addSet<string>(set,"b")||sizeSet<string>(set)!==4)return -7;
    clearSet<string>(set);if(sizeSet<string>(set)!==0||hasSet<string>(set,"b"))return -8;
    if(!addSet<string>(set,"final")||sizeSet<string>(set)!==1||!hasSet<string>(set,"final"))return -9;
    return 1;
  }
`,
);
assert.ok(
  nativeStringSet.native.records.some(
    (r) =>
      r.referenceOffsets.length === 2 &&
      r.referenceOffsets[0] === 16 &&
      r.referenceOffsets[1] === 32,
  ),
);
setModules.set("string-set", {
  ...nativeStringSet,
  bytes: 464,
  capacity: 1,
  expected: 1,
});
setModules.set("source-string-set", {
  ...compileSource(
    stringSetSource +
      `
    interface Box {readonly values:ReadonlySet<string>; calls:number}
    function receiver(s:Set<string>, b:Box):Set<string>{b.calls=b.calls+1;return s;}
    function argument(b:Box):string{b.calls=b.calls+10;return "b";}
    function run(n:number):number {
      const s=new Set<string>();const box:Box={values:s,calls:0};
      if(s.add("a")!==s)return -1;
      if(receiver(s,box).add(argument(box)).add("c")!==s)return -2;
      if(box.calls!==11||s.size!==3||!box.values.has("b"))return -3;
      s.add("a");if(s.size!==3||!s.delete("b")||s.delete("missing"))return -4;
      if(s.size!==2||box.values.has("b"))return -5;
      s.clear();if(s.size!==0||box.values.has("a"))return -6;
      s.add("final");return s.size;
    }
  `,
    false,
    ["string"],
  ),
  bytes: 272,
  capacity: 1,
  expected: 1,
});

setModules.set("source-set-typed-input", {
  ...compileSource(
    stringSetSource +
      `
    interface Calls {count:number}
    function input(values:Float64Array,calls:Calls):Float64Array {
      calls.count=calls.count+1;return values;
    }
    function run(n:number):number {
      const values=new Float64Array(5);
      values[0]=0/0;values[1]=0/0;values[2]=-0;values[3]=0;values[4]=7;
      const calls:Calls={count:0};
      const set=new Set(input(values,calls));
      values[4]=9;
      if(calls.count!==1||set.size!==3||!set.has(0/0)||!set.has(0)||!set.has(7)||set.has(9))return -1;
      const empty=new Set<number>(new Uint8Array(0));
      if(empty.size!==0)return -2;
      return set.size+calls.count*10;
    }
    `,
    false,
    ["number"],
  ),
  // 80-byte Float64Array, 32-byte counter, two 48-byte sets,
  // three 48-byte entries and a 32-byte empty Uint8Array.
  bytes: 384,
  capacity: 1,
  expected: 13,
});

setModules.set("source-string-from-char-code", {
  ...compileSource(`
    interface Calls {count:number}
    function next(c:Calls,n:number):number{c.count=c.count*10+n;return n+64;}
    function run(n:number):number {
      const s=String.fromCharCode(0,-1,65536,65537,65.9,-1.9,0/0,1/0,-1/0,4294967361,55296,56320);
      if(s.length!==12||s.charCodeAt(0)!==0||s.charCodeAt(1)!==65535||s.charCodeAt(2)!==0||s.charCodeAt(3)!==1)return -1;
      if(s.charCodeAt(4)!==65||s.charCodeAt(5)!==65535||s.charCodeAt(6)!==0||s.charCodeAt(7)!==0||s.charCodeAt(8)!==0)return -2;
      if(s.charCodeAt(9)!==65||s.charCodeAt(10)!==55296||s.charCodeAt(11)!==56320)return -3;
      const c:Calls={count:0};const ordered=String.fromCharCode(next(c,1),next(c,2));
      if(ordered!=="AB"||c.count!==12||String.fromCharCode()!=="")return -4;
      return 1;
    }
  `),
  // 48-byte 12-unit string, counter record, two-unit string and empty string.
  bytes: 144,
  capacity: 3,
  expected: 1,
});

const mixedSets = compileSource(
  stringSetSource +
    `
  function read(s:ReadonlySet<number>):number{return s.size;}
  function run(n:number):number {
    const numbers=new Set<number>();const strings=new Set<string>();
    if(numbers.add(0/0).add(-0).add(7)!==numbers)return -1;
    numbers.add(0/0).add(0);strings.add("a").add("b").add("a");
    if(read(numbers)!==3||strings.size!==2)return -2;
    if(!numbers.has(0/0)||!numbers.has(0)||numbers.has(8))return -3;
    if(!numbers.delete(0/0)||!numbers.delete(-0)||numbers.size!==1)return -4;
    numbers.clear();numbers.add(9);if(read(numbers)!==1||numbers.has(7))return -5;
    if(!strings.delete("a")||strings.has("a")||!strings.has("b"))return -6;
    strings.clear();strings.add("final");if(strings.size!==1)return -7;
    return 1;
  }
`,
  false,
  ["number", "string"],
);
assert.ok(
  mixedSets.native.records.some(
    (r) => r.referenceOffsets.length === 1 && r.referenceOffsets[0] === 32,
  ),
);
assert.ok(
  mixedSets.native.records.some(
    (r) =>
      r.referenceOffsets.length === 2 &&
      r.referenceOffsets[0] === 16 &&
      r.referenceOffsets[1] === 32,
  ),
);
setModules.set("source-mixed-sets", {
  ...mixedSets,
  bytes: 432,
  capacity: 1,
  expected: 1,
});
setModules.set("generic-object-set", {
  ...compileSource(
    stringSetSource +
      `
   interface Key {readonly value:number}
   function run(n:number):number {
     const a:Key={value:1};const b:Key={value:1};const c:Key={value:1};
     const set=createSet<Key>();
     if(!addSet<Key>(set,a)||!addSet<Key>(set,b)||addSet<Key>(set,a))return -1;
     if(sizeSet<Key>(set)!==2||hasSet<Key>(set,c))return -2;
     if(!deleteSet<Key>(set,b)||hasSet<Key>(set,b)||!hasSet<Key>(set,a))return -3;
     clearSet<Key>(set);if(hasSet<Key>(set,a)||sizeSet<Key>(set)!==0)return -4;
     if(!addSet<Key>(set,c)||!hasSet<Key>(set,c)||sizeSet<Key>(set)!==1)return -5;
     return 1;
   }
 `,
  ),
  bytes: 288,
  capacity: 1,
  expected: 1,
});
const genericSource =
  stringSetSource +
  `
  function identity<T>(value:T):T{return value;}
  function run(n:number):number {
    const numbers=createSet<number>();const strings=createSet<string>();
    addSet<number>(numbers,identity<number>(7));addSet<number>(numbers,0/0);addSet<number>(numbers,-0);
    addSet<number>(numbers,0/0);addSet<number>(numbers,0);
    addSet<string>(strings,identity<string>("a"));addSet<string>(strings,"b");addSet<string>(strings,"a");
    if(numbers.size!==3||strings.size!==2)return -1;
    if(!hasSet<number>(numbers,7)||!hasSet<number>(numbers,0/0)||hasSet<number>(numbers,8))return -2;
    if(!hasSet<string>(strings,"a")||hasSet<string>(strings,"c"))return -3;
    return 1;
  }
`;
const genericBytes = new TextEncoder().encode(genericSource),
  genericText = createSourceText(genericBytes, genericBytes.length);
assert.ok(genericText.ok);
const genericParsed = parseModule(genericText.value);
assert.ok(genericParsed.ok, JSON.stringify(genericParsed));
const genericBound = bindModule(genericParsed.value, ["undefined"]);
assert.ok(genericBound.ok, JSON.stringify(genericBound));
const specialized = specializeModule(genericParsed.value, genericBound.value);
assert.ok(specialized.ok, JSON.stringify(specialized));
// create/add/append/has/identity each specialize for number and string.
assert.equal(specialized.value.specializations.length, 10);
const genericEntry = specialized.value.module.statements
  .filter((s) => s.kind === "function")
  .findIndex((s) => s.name === "run");
setModules.set("generic-collections", {
  ...compileModule(specialized.value.module, genericEntry),
  bytes: 336,
  capacity: 1,
  expected: 1,
});
const linkedMapSource = readFileSync(
  new URL(
    "../packages/foundation/src/collections/linked-map.ts",
    import.meta.url,
  ),
  "utf8",
);
// Map runtime semantics are exercised by verify-hosted-maps.ts.
const sparseListSource = readFileSync(
  new URL(
    "../packages/foundation/src/collections/sparse-list.ts",
    import.meta.url,
  ),
  "utf8",
);
function compileSparseList(
  body: string,
  sourceSyntax = true,
  elementDeclaration?: string,
  objectElementNames: readonly string[] = ["Item"],
  includeStringLists = false,
  includeNumericLists = false,
  setElements: readonly string[] = [],
  sorting = false,
) {
  const linked = linkModules(
    [
      ...(includeNumericLists || sorting
        ? [moduleSource("numbers", listRuntimeSource, [])]
        : []),
      ...(setElements.length
        ? [moduleSource("sets", stringSetSource, [])]
        : []),
      ...(sorting
        ? [
            moduleSource(
              "sort-core",
              readFileSync(
                new URL(
                  "../packages/foundation/src/collections/indexed-sort.ts",
                  import.meta.url,
                ),
                "utf8",
              ),
              [],
            ),
            moduleSource(
              "sort-adapters",
              readFileSync(
                new URL(
                  includeNumericLists
                    ? "../packages/foundation/src/collections/list-sort/numeric.ts"
                    : "../packages/foundation/src/collections/list-sort/sparse.ts",
                  import.meta.url,
                ),
                "utf8",
              ),
              [
                ["../indexed-sort.ts", "sort-core"],
                ["../number-list.ts", "numbers"],
                ["../sparse-list.ts", "list"],
              ],
            ),
          ]
        : []),
      moduleSource("list", sparseListSource, []),
      moduleSource(
        "main",
        (sorting ? 'import "sort-adapters";' : "") +
          (setElements.length ? 'import "sets";' : "") +
          (includeNumericLists ? 'import "numbers";' : "") +
          'import {createList,readList,writeList,pushList,popList,lengthList,hasList,deleteList,resizeList} from "list";' +
          (elementDeclaration ?? "") +
          body,
        [
          ["list", "list"],
          ...(sorting
            ? [["sort-adapters", "sort-adapters"] as [string, string]]
            : []),
          ...(setElements.length ? [["sets", "sets"] as [string, string]] : []),
          ...(includeNumericLists
            ? [["numbers", "numbers"] as [string, string]]
            : []),
        ],
      ),
    ],
    "main",
    [
      "undefined",
      "Number",
      "Math",
      "NaN",
      "Infinity",
      "Uint8Array",
      "Float64Array",
      "Set",
    ],
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const names = new Map(
    linked.value.exports
      .filter(
        (e) =>
          (e.module === "list" ||
            e.module === "numbers" ||
            e.module === "sets" ||
            e.module === "sort-adapters") &&
          e.namespace === "value",
      )
      .map((e) => [e.name, e.linkedName]),
  );
  const entry = linked.value.exports.find(
    (e) => e.module === "main" && e.name === "run" && e.namespace === "value",
  );
  assert.ok(entry);
  const elementNames =
    elementDeclaration === undefined
      ? []
      : objectElementNames.map((name) => {
          const exported = linked.value.exports.find(
            (e) =>
              e.module === "main" && e.name === name && e.namespace === "type",
          );
          assert.ok(exported, name);
          return exported.linkedName;
        });
  return compileModule(
    linked.value.module,
    undefined,
    includeNumericLists,
    names,
    setElements,
    [],
    sourceSyntax && (elementDeclaration === undefined || includeStringLists),
    entry.linkedName,
    sourceSyntax ? elementNames : [],
  );
}
setModules.set("scalar-replaced-record", {
  ...compileSource(
    `interface Pair {a:number;b:number}
function make(n:number):Pair{return {a:n,b:1};}
function run(n:number):number{
 const p:Pair={a:n,b:0};
 if(n>0)p.a=p.a+2;
 for(let i=0;i<3;i++)p.b=p.b+1;
 const escaped=make(n);
 return p.a===n+2&&p.b===3&&escaped.a===n&&escaped.b===1?1:-1;
}`,
    false,
    [],
    [],
    false,
    "basic",
  ),
  bytes: 32,
  capacity: 16,
  expected: 1,
});
setModules.set("scalar-replaced-loop-record", {
  ...compileSource(
    `interface Pair {a:number;b:number}
function make(n:number):Pair{return {a:n,b:1};}
function run(n:number):number{
 let sum=0;
 for(let i=0;i<4;i++){
  const p:Pair={a:n+i,b:i};
  p.a=p.a+2;
  sum=sum+p.a+p.b;
 }
 const escaped=make(n);
 return sum===4*n+20&&escaped.a===n&&escaped.b===1?1:-1;
}`,
    false,
    [],
    [],
    false,
    "basic",
  ),
  // Only the returned record may allocate. Four loop records would exhaust this.
  bytes: 32,
  capacity: 16,
  expected: 1,
});
setModules.set("literal-string-membership", {
  ...compileSparseList(`interface Counter {value:number}
function search(c:Counter,text:string):string{c.value=c.value+1;return text;}
export function run(n:number):number{
 const c:Counter={value:0};
 if(!["a","b","a","😀"].includes(search(c,"😀")))return -1;
 if(["a","b","a","😀"].includes(search(c,"B")))return -2;
 if(c.value!==2)return -3;
 return 1;
}`),
  bytes: 32,
  capacity: 16,
  expected: 1,
});
for (const [name, call, expected, removed, bytes] of [
  ["grow", '-2,1,"x","y"', ["a", "x", "y", "c"], ["b"], 384],
  ["shrink", "1,2", ["a"], ["b", "c"], 384],
  ["omitted", "", ["a", "b", "c"], [], 256],
  ["tail", "1", ["a"], ["b", "c"], 384],
  ["undefined", "undefined,undefined", ["a", "b", "c"], [], 256],
  ["infinity", "-1/0,1/0", [], ["a", "b", "c"], 448],
] as const) {
  setModules.set("source-splice-" + name, {
    ...compileSparseList(`export function run(n:number):number {
   const a=["a","b","c"];const b=a.splice(${call});
   if(a.length!==${expected.length}||b.length!==${removed.length})return -1;
   ${expected.map((v, i) => `if(a[${i}]!==${JSON.stringify(v)})return -2;`).join("\n")}
   ${removed.map((v, i) => `if(b[${i}]!==${JSON.stringify(v)})return -3;`).join("\n")}
   return 1;
  }`),
    bytes,
    capacity: Math.floor(512 / bytes),
    expected: 1,
  });
}
for (const [name, setup, separator, expected, bytes] of [
  ["default", 'const a=["a","b","c"];', "undefined", "a,b,c", 400],
  ["empty-separator", 'const a=["a","b","c"];', '""', "abc", 384],
  ["wide-separator", 'const a=["a","b","c"];', '"::"', "a::b::c", 416],
  ["empty", "const a:string[]=[];", "undefined", "", 32],
  ["holes", 'const a=["a"];a[2]="c";', "undefined", "a,,c", 288],
  [
    "undefined",
    'const a:(string|undefined)[]=["a",undefined,"c"];',
    "undefined",
    "a,,c",
    352,
  ],
  ["utf16", 'const a=["😀","x"];', "undefined", "😀,x", 256],
  [
    "all-undefined",
    "const a:(string|undefined)[]=[undefined,undefined];",
    "undefined",
    ",",
    192,
  ],
] as const) {
  setModules.set("source-join-" + name, {
    ...compileSparseList(`function joinInput(a:readonly (string|undefined)[],separator:string|undefined):string{return a.join(separator);}
   export function run(n:number):number{${setup}return joinInput(a,${separator})===${JSON.stringify(expected)}?1:-1;}`),
    bytes,
    capacity: Math.floor(512 / bytes),
    expected: 1,
  });
}
setModules.set("source-join-omission", {
  ...compileSparseList(`export function run(n:number):number{const a=["a","b"];
 return a.join()==="a,b"&&a.join(undefined)==="a,b"?1:-1;}`),
  bytes: 352,
  capacity: 1,
  expected: 1,
});
setModules.set("source-join-effects", {
  ...compileSparseList(`interface Counter {value:number}
 function receiver(c:Counter,a:string[]):string[]{c.value=1;return a;}
 function separator(c:Counter,a:string[]):string{c.value=c.value*10+2;a.push("b");return ",";}
 export function run(n:number):number{const a=["a"];const c:Counter={value:0};
 const text=receiver(c,a).join(separator(c,a));return text==="a,b"&&c.value===12?1:-1;}`),
  bytes: 288,
  capacity: 1,
  expected: 1,
});
setModules.set("source-every-string", {
  ...compileSparseList(`export function run(n:number):number{
    const values=["a",""];return values.every(value=>value)?-1:1;
  }`),
  bytes: 208,
  capacity: 2,
  expected: 1,
});
setModules.set("source-find-index-string", {
  ...compileSparseList(`export function run(n:number):number{
    const values=["","hit","later"];if(values.findIndex(value=>false)!==-1)return -2;return values.findIndex(value=>value)===1?1:-1;
  }`),
  bytes: 320,
  capacity: 1,
  expected: 1,
});
setModules.set("source-find-index-object", {
  ...compileSparseList(
    `export function run(n:number):number{
    const first:Item={value:1},second:Item={value:2};
    const values=[first,second];if(values.findIndex(item=>false)!==-1)return -3;const found=values.findIndex(item=>item!==undefined&&item.value===2);
    if(found!==1)return -1;const matched=values[found];if(matched===undefined)return -2;matched.value=9;return second.value===9?1:-3;
  }`,
    true,
    "export interface Item {value:number}",
  ),
  bytes: 320,
  capacity: 1,
  expected: 1,
});
setModules.set("source-find-string", {
  ...compileSparseList(`export function run(n:number):number{
    const values=["","hit","later"];if(values.find(value=>false)!==undefined)return -2;return values.find(value=>value)==="hit"?1:-1;
  }`),
  bytes: 320,
  capacity: 1,
  expected: 1,
});
setModules.set("source-find-object", {
  ...compileSparseList(
    `export function run(n:number):number{
    const first:Item={value:1},second:Item={value:2};
    const values=[first,second];if(values.find(item=>false)!==undefined)return -3;const found=values.find(item=>item!==undefined&&item.value===2);
    if(found===undefined)return -1;found.value=9;return second.value===9?1:-2;
  }`,
    true,
    "export interface Item {value:number}",
  ),
  bytes: 320,
  capacity: 1,
  expected: 1,
});
setModules.set("source-some-string", {
  ...compileSparseList(
    `export function run(n:number):number{const values=["","x"];return values.some(value=>value)?1:-1;}`,
  ),
  bytes: 208,
  capacity: 2,
  expected: 1,
});
setModules.set("source-array-of-sets", {
  ...compileSparseList(
    `export function run(n:number):number{
    const set=new Set<number>();const groups:Item[]=[set,set];
    const first=groups[0],second=groups[1];if(first===undefined||second===undefined)return -1;
    first.add(7);if(!second.has(7))return -2;
    first.delete(7);if(second.has(7))return -3;
    second.add(9);return set.has(9)&&first.size===1?1:-4;
  }`,
    true,
    "export type Item=Set<number>;",
    ["Item"],
    false,
    false,
    ["number"],
  ),
  bytes: 304,
  capacity: 1,
  expected: 1,
});
setModules.set("source-array-of-readonly-sets", {
  ...compileSparseList(
    `export function run(n:number):number{
    const set=new Set<string>();const groups:Item[]=[set];const view=groups[0];
    if(view===undefined)return -1;set.add("live");return view.has("live")?1:-2;
  }`,
    true,
    "export type Item=ReadonlySet<string>;",
    ["Item"],
    false,
    false,
    ["string"],
  ),
  bytes: 192,
  capacity: 2,
  expected: 1,
});
setModules.set("source-nested-array", {
  ...compileSparseList(
    `export function run(n:number):number {
      const inner:string[]=["a"];
      const rows:(Item|undefined)[]=[inner,inner];
      rows[3]=undefined;
      const first=rows[0],second=rows[1];
      if(first===undefined||second===undefined)return 0;
      first[0]="b";
      if(second[0]!=="b"||inner[0]!=="b")return 0;
      if(rows.length!==4||rows[2]!==undefined||rows[3]!==undefined)return 0;
      return 1;
    }`,
    true,
    "export type Item=string[];",
    ["Item"],
    true,
  ),
  capacity: 1,
  bytes: 320,
  expected: 1,
});
setModules.set("source-nested-number-array", {
  ...compileSparseList(
    `export function run(n:number):number {
      const refs:number[]=[7,9];
      const edges:Item[]=[];
      edges.push(refs);
      const row=edges[0];
      if(row===undefined)return -1;
      refs[0]=11;
      return row[0]===11&&row[1]===9?1:-2;
    }`,
    true,
    "export type Item=readonly number[];",
    ["Item"],
    false,
    true,
  ),
  capacity: 2,
  bytes: 240,
  expected: 1,
});
setModules.set("source-array-default-string", {
  ...compileSparseList(`function read(a:string[]=["x"]):string[]{return a;}
 function empty(a:readonly string[]=[]):number{return a.length;}
 export function run(n:number):number{const first=read(),second=read(undefined),supplied=["p"];const third=read(supplied);first[0]="a";third[0]="q";return second[0]==="x"&&supplied[0]==="q"&&empty()===0?1:-1;}`),
  bytes: 320,
  capacity: 1,
  expected: 1,
});
setModules.set("source-array-default-object", {
  ...compileSparseList(
    `function read(a:Item[]=[{value:1}]):Item[]{return a;}
 export function run(n:number):number{const first=read(),second=read(undefined),supplied:Item[]=[{value:2}];const third=read(supplied);const a=first[0],b=second[0],c=third[0],d=supplied[0];if(a===undefined||b===undefined||c===undefined||d===undefined)return -1;a.value=9;c.value=7;return b.value===1&&d.value===7?1:-2;}`,
    true,
    "export interface Item{value:number}",
  ),
  bytes: 384,
  capacity: 1,
  expected: 1,
});
setModules.set("source-sort-number", {
  ...compileSparseList(
    `export function run(n:number):number{const values=[3,1,2];const result=values.sort((a,b)=>a-b);result[0]=7;return values[0]===7&&values[1]===2&&values[2]===3?1:-1;}`,
    true,
    undefined,
    [],
    false,
    true,
    [],
    true,
  ),
  bytes: 800,
  regionBytes: 800,
  capacity: 1,
  expected: 1,
});
setModules.set("source-sort-sparse-mutation", {
  ...compileSparseList(
    `export function run(n:number):number{
 const values:(number|undefined)[]=[3,undefined,1];values[4]=undefined;
 values.sort((a,b):number=>{values[0]=99;values[6]=8;return a-b;});
 return values.length===7&&values[0]===1&&values[1]===3&&values[2]===undefined&&values[3]===undefined&&values[6]===8&&values.every((v,i)=>i!==4&&i!==5)?1:-1;
 }`,
    true,
    undefined,
    [],
    false,
    true,
    [],
    true,
  ),
  bytes: 1024,
  regionBytes: 1024,
  capacity: 1,
  expected: 1,
});
setModules.set("source-sort-stable-object", {
  ...compileSparseList(
    `export function run(n:number):number{
 const a:Item={rank:2,id:1},b:Item={rank:1,id:2},c:Item={rank:2,id:3};const values=[a,b,c];
 values.sort((a,b)=>a.rank-b.rank);const first=values[0],second=values[1],third=values[2];
 if(first===undefined||second===undefined||third===undefined)return -1;
 second.rank=9;return first.id===2&&second.id===1&&third.id===3&&a.rank===9?1:-2;
 }`,
    true,
    "export interface Item{rank:number;id:number}",
    ["Item"],
    false,
    false,
    [],
    true,
  ),
  bytes: 960,
  regionBytes: 960,
  capacity: 1,
  expected: 1,
});
setModules.set("source-sort-empty", {
  ...compileSparseList(
    `export function run(n:number):number{const values:number[]=[];values.sort((a,b):number=>{throw "unexpected comparison";});return values.length===0?1:-1;}`,
    true,
    undefined,
    [],
    false,
    true,
    [],
    true,
  ),
  bytes: 656,
  regionBytes: 656,
  capacity: 1,
  expected: 1,
});
setModules.set("source-sort-nan", {
  ...compileSparseList(
    `export function run(n:number):number{const values=[3,1,2];values.sort((a,b)=>0/0);return values[0]===3&&values[1]===1&&values[2]===2?1:-1;}`,
    true,
    undefined,
    [],
    false,
    true,
    [],
    true,
  ),
  bytes: 800,
  regionBytes: 800,
  capacity: 1,
  expected: 1,
});
setModules.set("source-sort-string", {
  ...compileSparseList(
    `export function run(n:number):number{const values=["bbb","a","cc"];values.sort((a,b)=>a.length-b.length);return values[0]==="a"&&values[1]==="cc"&&values[2]==="bbb"?1:-1;}`,
    true,
    undefined,
    [],
    false,
    false,
    [],
    true,
  ),
  bytes: 864,
  regionBytes: 864,
  capacity: 1,
  expected: 1,
});
setModules.set("source-set-object-iteration", {
  ...compileSource(
    stringSetSource +
      `
    interface Item {value:number}
    function run(n:number):number {
      const a:Item={value:7};const b:Item={value:9};
      const values=new Set<Item>();values.add(a).add(b).add(a);
      if(values.size!==2||!values.has(a))return -1;
      let total=0;
      for(const item of values){item.value=item.value+1;total+=item.value;}
      if(a.value!==8||b.value!==10||!values.delete(a)||values.has(a))return -2;
      return total;
    }`,
    false,
    ["Item"],
  ),
  bytes: 272,
  capacity: 1,
  expected: 18,
});
setModules.set("source-set-copy-number", {
  ...compileSparseList(
    `export function run(n:number):number{
    const source=new Set<number>();source.add(0/0);source.add(-0);
    const view:ReadonlySet<number>=source, copy=new Set(view);source.delete(0/0);
    if(copy.size!==2||!copy.has(0/0)||source.size!==1)return -1;
    let index=0;for(const value of copy){if(index===0&&value===value)return -2;if(index===1&&1/value!==1/0)return -3;index=index+1;}
    return index===2?1:-4;
  }`,
    true,
    undefined,
    [],
    false,
    true,
    ["number"],
  ),
  bytes: 416,
  capacity: 1,
  expected: 1,
});
setModules.set("source-set-copy-string", {
  ...compileSparseList(
    `export function run(n:number):number{
    const source=new Set<string>();source.add("a");source.add("b");
    const copy=new Set(source);source.delete("a");
    let index=0;for(const value of copy){if(index===0&&value!=="a")return -1;if(index===1&&value!=="b")return -2;index=index+1;}
    copy.delete("b");return index===2&&copy.has("a")&&!source.has("a")&&source.has("b")?1:-3;
  }`,
    true,
    undefined,
    [],
    false,
    false,
    ["string"],
  ),
  bytes: 416,
  capacity: 1,
  expected: 1,
});
setModules.set("source-set-copy-empty", {
  ...compileSparseList(
    `interface Counter{calls:number}
    function receiver(source:ReadonlySet<number>,counter:Counter):ReadonlySet<number>{counter.calls=counter.calls+1;return source;}
    export function run(n:number):number{const source=new Set<number>(),counter:Counter={calls:0};const copy=new Set(receiver(source,counter));return copy.size===0&&counter.calls===1?1:-1;}
  `,
    true,
    undefined,
    [],
    false,
    true,
    ["number"],
  ),
  bytes: 192,
  capacity: 2,
  expected: 1,
});
setModules.set("source-set-spread-number", {
  ...compileSparseList(
    `export function run(n:number):number{
 const set=new Set<number>();set.add(2);set.add(1);set.delete(2);set.add(2);
 const values=[0,...set,9];return values.length===4&&values[0]===0&&values[1]===1&&values[2]===2&&values[3]===9?1:-1;
 }`,
    true,
    undefined,
    [],
    false,
    true,
    ["number"],
  ),
  bytes: 528,
  regionBytes: 528,
  capacity: 1,
  expected: 1,
});
setModules.set("source-set-spread-empty", {
  ...compileSparseList(
    `interface Counter{calls:number}
 function receiver(set:ReadonlySet<number>,counter:Counter):ReadonlySet<number>{counter.calls=counter.calls+1;return set;}
 export function run(n:number):number{
 const set=new Set<number>(),counter:Counter={calls:0};const values=[...receiver(set,counter)];return values.length===0&&counter.calls===1?1:-1;
 }`,
    true,
    undefined,
    [],
    false,
    true,
    ["number"],
  ),
  bytes: 288,
  capacity: 1,
  expected: 1,
});
setModules.set("source-set-spread-string", {
  ...compileSparseList(
    `export function run(n:number):number{
 const set=new Set<string>();set.add("a");set.add("b");set.add("a");const view:ReadonlySet<string>=set;
 const values=[...view];return values.length===2&&values[0]==="a"&&values[1]==="b"?1:-1;
 }`,
    true,
    undefined,
    [],
    false,
    false,
    ["string"],
  ),
  bytes: 368,
  capacity: 1,
  expected: 1,
});
setModules.set("source-list-slice-object", {
  ...compileSparseList(
    `export function run(n:number):number{const a:Item={value:1};const source=[a];const result=source.slice();const item=result[0];if(item===undefined)return -1;item.value=9;return a.value===9&&result.length===1?1:-2;}`,
    true,
    "export interface Item{value:number}",
    ["Item"],
  ),
  bytes: 224,
  capacity: 2,
  expected: 1,
});
setModules.set("source-filter-string", {
  ...compileSparseList(`export function run(n:number):number{
    const values=["a","","b"];const result=values.filter(value=>value);return result.length===2&&result[0]==="a"&&result[1]==="b"?1:-1;
  }`),
  bytes: 432,
  capacity: 1,
  expected: 1,
});
setModules.set("source-filter-object", {
  ...compileSparseList(
    `export function run(n:number):number{
    const a:Item={value:1},b:Item={value:2};const values=[a,b];const result=values.filter(item=>item.value===2);const found=result[0];if(found===undefined)return -1;found.value=9;return result.length===1&&b.value===9?1:-2;
  }`,
    true,
    "export interface Item {value:number}",
  ),
  bytes: 368,
  capacity: 1,
  expected: 1,
});
setModules.set("source-map-object", {
  ...compileSparseList(
    `export function run(n:number):number{
    const first:Item={value:1};const second:Item={value:2};
    const source=[first,second];const mapped=source.map(item=>item);
    if(mapped===source||mapped[0]!==first||mapped[1]!==second)return -1;
    const item=mapped[0];if(item===undefined)return -2;item.value=7;
    return first.value===7?1:-3;
  }`,
    true,
    "export interface Item {value:number}",
  ),
  bytes: 432,
  capacity: 1,
  expected: 1,
});
setModules.set("source-map-string-capture", {
  ...compileSparseList(`export function run(n:number):number{
    const source:readonly string[]=["a","b"];
    const counter:{value:number}={value:0};
    const mapped=source.map((value):string=>{counter.value=counter.value+1;return value==="a"?"z":value;});
    return mapped[0]==="z"&&mapped[1]==="b"&&source[0]==="a"&&counter.value===2?1:-1;
  }`),
  bytes: 464,
  capacity: 1,
  expected: 1,
});
setModules.set("source-list-index-of-string", {
  ...compileSparseList(`function search(a:readonly string[],text:string|undefined,start:number|undefined):number{return a.indexOf(text,start);}
 export function run(n:number):number{const a=["a","b","a","c"];return search(a,"a",undefined)===0&&search(a,"a",1)===2&&search(a,"c",-1)===3&&search(a,undefined,0)===-1?1:-1;}`),
  bytes: 288,
  capacity: 1,
  expected: 1,
});
setModules.set("source-list-index-of-object", {
  ...compileSparseList(
    `export function run(n:number):number{const a:Item={value:1},b:Item={value:1};const values=[a];values[2]=a;return values.indexOf(a)===0&&values.indexOf(a,1)===2&&values.indexOf(b)===-1&&values.indexOf(undefined)===-1?1:-1;}`,
    true,
    "export interface Item{value:number}",
  ),
  bytes: 224,
  capacity: 2,
  expected: 1,
});
setModules.set("source-list-includes-string", {
  ...compileSparseList(`function search(a:readonly string[],text:string|undefined,start:number|undefined):boolean{return a.includes(text,start);}
 export function run(n:number):number{const a=["<",">","+","-"];
 if(!search(a,"+",undefined)||search(a,"+",3)||!search(a,"-",-1)||search(a,undefined,0)||search(a,"x",0))return -1;
 return 1;}`),
  bytes: 288,
  capacity: 1,
  expected: 1,
});
setModules.set("source-list-includes-object", {
  ...compileSparseList(
    `export function run(n:number):number{const item:Item={value:3};const other:Item={value:3};const a=[item];a[2]=item;
 if(!a.includes(item)||a.includes(other)||!a.includes(undefined)||a.includes(item,3))return -1;
 return 1;}`,
    true,
    "export interface Item {value:number}",
  ),
  bytes: 224,
  capacity: 2,
  expected: 1,
});
setModules.set("source-conditional-empty-array", {
  ...compileSparseList(`interface Counter {value:number}
 function source(c:Counter,a:string[]):string[]{c.value=c.value+1;return a;}
 function left(flag:boolean,c:Counter,a:string[]):string[]{const selected=flag?[]:source(c,a);return selected;}
 function right(flag:boolean,c:Counter,a:string[]):string[]{const selected=flag?source(c,a):[];return selected;}
 export function run(n:number):number{const a=["x"];const c:Counter={value:0};
 if(right(true,c,a)!==a||left(false,c,a)!==a||c.value!==2)return -1;
 const first=right(false,c,a),second=left(true,c,a);
 if(first.length!==0||second.length!==0||first===second||c.value!==2)return -2;
 return 1;}`),
  bytes: 192,
  capacity: 2,
  expected: 1,
});
setModules.set("source-pop-holes", {
  ...compileSparseList(`export function run(n:number):number{const a:(string|undefined)[]=["a"];a[2]=undefined;a[3]="d";
 if(a.pop()!=="d"||a.length!==3||a.pop()!==undefined||a.length!==2||a.pop()!==undefined||a.length!==1||a.pop()!=="a"||a.pop()!==undefined||a.length!==0)return -1;
 return 1;}`),
  bytes: 224,
  capacity: 2,
  expected: 1,
});
setModules.set("source-pop-object", {
  ...compileSparseList(
    `interface Counter {count:number}
 function receiver(c:Counter,a:Item[]):Item[]{c.count=c.count+1;return a;}
 export function run(n:number):number{const item:Item={value:3};const a=[item];const c:Counter={count:0};
 const result=receiver(c,a).pop();if(result!==item||c.count!==1||a.length!==0)return -1;
 if(result===undefined)return -2;result.value=7;return item.value;}`,
    true,
    "export interface Item {value:number}",
  ),
  bytes: 160,
  capacity: 3,
  expected: 7,
});
setModules.set("source-splice-effects", {
  ...compileSparseList(`interface Counter {value:number}
 function receiver(c:Counter,a:string[]):string[]{c.value=1;return a;}
 function start(c:Counter,a:string[]):number{c.value=c.value*10+2;a.push("c");return 0;}
 function item(c:Counter):string{c.value=c.value*10+3;return "x";}
 export function run(n:number):number {
  const c:Counter={value:0};const a=["a","b"];
  const b=receiver(c,a).splice(start(c,a),1,item(c));
  if(c.value!==123||a.length!==3||a[0]!=="x"||a[1]!=="b"||a[2]!=="c"||b[0]!=="a")return -1;
  return 1;
 }`),
  bytes: 352,
  capacity: 1,
  expected: 1,
});
setModules.set("source-splice-holes", {
  ...compileSparseList(`export function run(n:number):number {
  const a:(string|undefined)[]=["a"];a[3]="d";a[2]=undefined;
  const b=a.splice(1,2);
  if(a.length!==2||a[0]!=="a"||a[1]!=="d"||b.length!==2||b[0]!==undefined||b[1]!==undefined)return -1;
  return 1;
 }`),
  bytes: 384,
  capacity: 1,
  expected: 1,
});
setModules.set("source-splice-shift-holes", {
  ...compileSparseList(`export function run(n:number):number {
  const a=["a","b","c"];a[5]="f";const b=a.splice(0,3);
  if(a.length!==3||a[0]!==undefined||a[1]!==undefined||a[2]!=="f"||b.length!==3)return -1;
  return 1;
 }`),
  bytes: 512,
  capacity: 1,
  expected: 1,
});
setModules.set("source-splice-object", {
  ...compileSparseList(
    `export function run(n:number):number {
  const first:Item={value:1};const second:Item={value:2};const a=[first,second];
  const b=a.splice(0,1,second,first);first.value=7;
  if(a.length!==3||a[0]!==second||a[1]!==first||a[2]!==second||b[0]!==first)return -1;
  return 1;
 }`,
    true,
    "export interface Item {value:number}",
  ),
  bytes: 384,
  capacity: 1,
  expected: 1,
});
setModules.set("source-object-list", {
  ...compileSparseList(
    `
    interface Holder {items:Item[]}
    export function run(n:number):number {
      const first:Item={value:7};const holder:Holder={items:[first]};
      const old=holder.items;holder.items[3]={value:9};holder.items.push(first);
      first.value=11;
      let sum=0;let count=0;
      for(const item of holder.items){count++;if(item!==undefined)sum+=item.value;}
      if(sum!==31||count!==5||holder.items[1]!==undefined)return -1;
      const head=holder.items[0];if(head!==first)return -2;
      holder.items=[];if(holder.items.length!==0||old.length!==5)return -3;
      return 1;
    }
  `,
    true,
    "export interface Item {value:number}",
  ),
  bytes: 352,
  capacity: 1,
  expected: 1,
});
setModules.set("source-object-list-types", {
  ...compileSparseList(
    `
    function score(items:readonly Item[]):number {const item=items[0];return item===undefined?0:item.value;}
    export function run(n:number):number {
      const items:Item[]=[{value:7}];const others:Other[]=[{name:"hello"}];
      const other=others[0];if(other===undefined)return -1;
      const readonlyItems:readonly Item[]=items;
      return score(readonlyItems)+other.name.length;
    }
  `,
    true,
    "export interface Item {value:number} export interface Other {name:string}",
    ["Item", "Other"],
  ),
  bytes: 256,
  capacity: 2,
  expected: 12,
});
setModules.set("source-object-union-list", {
  ...compileSparseList(
    `
    export function run(n:number):number {
      const items:Item[]=[{kind:"a",value:7},{kind:"b",label:"hello"}];
      let sum=0;for(const item of items){if(item===undefined)continue;
        if(item.kind==="a")sum+=item.value;else sum+=item.label.length;}
      return sum;
    }
  `,
    true,
    'export type Item={readonly kind:"a";value:number}|{readonly kind:"b";label:string};',
  ),
  bytes: 224,
  capacity: 2,
  expected: 12,
});
for (const [name, text, separator, limit] of [
  ["fields", "a,,b,", ",", undefined],
  ["units", "😀", "", undefined],
  ["empty-units", "", "", undefined],
  ["empty-field", "", ",", undefined],
  ["omitted", "a,b", undefined, undefined],
  ["zero", "a,b", ",", 0],
  ["one", "a,b", ",", 1],
  ["wrap", "a,b", ",", 4294967297],
  ["negative", "a,b", ",", -1],
  ["nan", "a,b", ",", NaN],
  ["infinite", "a,b", ",", Infinity],
  ["overlap", "aaaaa", "aa", undefined],
] as const) {
  const expected =
    separator === undefined ? [text] : text.split(separator, limit);
  const limitSource =
    limit === undefined
      ? "undefined"
      : Number.isNaN(limit)
        ? "0/0"
        : limit === Infinity
          ? "1/0"
          : String(limit);
  const bytes =
    32 +
    expected.length * 64 +
    (separator === undefined
      ? 0
      : expected.reduce(
          (sum, value) => sum + Math.ceil((24 + value.length * 2) / 16) * 16,
          0,
        ));
  setModules.set("source-string-split-" + name, {
    ...compileSparseList(`
    function splitInput(text:string,separator:string|undefined,limit:number|undefined):string[]{return text.split(separator,limit);}
    export function run(n:number):number {
      const parts=splitInput(${JSON.stringify(text)},${separator === undefined ? "undefined" : JSON.stringify(separator)},${limitSource});
      if(parts.length!==${expected.length})return -1;
      ${expected.map((value, index) => `if(parts[${index}]!==${JSON.stringify(value)})return -2;`).join("\n")}
      return parts.length;
    }`),
    bytes,
    capacity: Math.floor(512 / bytes),
    expected: expected.length,
  });
}
setModules.set("source-string-list-spread", {
  ...compileSparseList(`
    export function run(n:number):number {
      const source=["a"];source[2]="c";
      const copied=[...source];copied.push(undefined);source[0]="z";
      let sum=0,missing=0;
      for(const value of copied){if(value===undefined)missing++;else sum+=value.charCodeAt(0);}
      return sum+missing*10+copied.length;
    }
  `),
  bytes: 448,
  capacity: 1,
  expected: 220,
});
setModules.set("source-object-list-spread", {
  ...compileSparseList(
    `
    export function run(n:number):number {
      const original:Item={value:7};
      const source:Item[]=[original];source[2]={value:9};
      const copied=[...source];copied.push(undefined);
      original.value=11;source[0]={value:99};
      let sum=0,missing=0;
      for(const value of copied){if(value===undefined)missing++;else sum+=value.value;}
      return sum+missing*10+copied.length;
    }
  `,
    true,
    "export interface Item {value:number}",
  ),
  bytes: 544,
  capacity: 1,
  expected: 44,

  regionBytes: 544,
});
setModules.set("source-string-list", {
  ...compileSparseList(`
 function source(a:string[]):string[]{a[0]="a";return a;}
 export function run(n:number):number {
   const a=["x","b"];a[4]="e";if(a.push("f","g")!==7)return -1;
   if(a[2]!==undefined||a[3]!==undefined||a[-1]!==undefined)return -2;
   let count=0,sum=0;for(const item of source(a)) {
     if(item===undefined)sum+=10;else sum+=item.charCodeAt(0);
     if(count===0)a.push("h");count++;
   }
   if(count!==8||sum!==625||a.length!==8||a.push()!==8)return -3;
   return 1;
 }
 `),
  bytes: 416,
  capacity: 1,
  expected: 1,
});
setModules.set("source-string-list-effects", {
  ...compileSparseList(`
 interface Counter{calls:number}
 function receiver(a:string[],c:Counter):string[]{c.calls=c.calls*10+1;return a;}
 function first(a:string[],c:Counter):string{c.calls=c.calls*10+2;a.push("nested");return "outer";}
 function second(c:Counter):string{c.calls=c.calls*10+3;return "after";}
 export function run(n:number):number {
   const a=["start"];const c:Counter={calls:0};
   if(receiver(a,c).push(first(a,c),second(c))!==4||c.calls!==123)return -1;
   if(a[0]!=="start"||a[1]!=="nested"||a[2]!=="outer"||a[3]!=="after")return -2;
   return 1;
 }
 `),
  bytes: 320,
  capacity: 1,
  expected: 1,
});
setModules.set("source-string-list-fields", {
  ...compileSparseList(`
 interface Box{items:string[]}
 export function run(n:number):number {
   const box:Box={items:["a"]};const old=box.items;box.items=["b"];
   if(old[0]!=="a"||box.items[0]!=="b"||old===box.items)return -1;
   return 1;
 }
 `),
  bytes: 224,
  capacity: 2,
  expected: 1,
});
setModules.set("generic-sparse-list-presence", {
  ...compileSparseList(
    `export function run(n:number):number {
   const list=createList<string|undefined>(0);
   writeList<string|undefined>(list,0,"keep");writeList<string|undefined>(list,2,undefined);
   writeList<string|undefined>(list,4294967294,"last");
   if(!hasList<string|undefined>(list,2)||hasList<string|undefined>(list,1))return -1;
   if(!deleteList<string|undefined>(list,2)||deleteList<string|undefined>(list,2))return -2;
   if(lengthList<string|undefined>(list)!==4294967295)return -3;
   resizeList<string|undefined>(list,2);resizeList<string|undefined>(list,4294967295);
   if(hasList<string|undefined>(list,4294967294)||readList<string|undefined>(list,0)!=="keep")return -4;
   resizeList<string|undefined>(list,-0);
   return 1/lengthList<string|undefined>(list)===1/0?1:-5;
 }`,
    false,
  ),
  bytes: 224,
  capacity: 2,
  expected: 1,
});
setModules.set("generic-sparse-list", {
  ...compileSparseList(
    `
 export function run(n:number):number {
   const list=createList<string>(0);writeList<string>(list,4,"a");
   if(lengthList<string>(list)!==5||readList<string>(list,3)!==undefined)return -1;
   if(pushList<string>(list,"b")!==6)return -2;writeList<string>(list,4,"c");
   if(popList<string>(list)!=="b"||popList<string>(list)!=="c"||popList<string>(list)!==undefined)return -3;
   writeList<string>(list,0,"d");if(readList<string>(list,0)!=="d"||lengthList<string>(list)!==3)return -4;
   return 1;
 }
 `,
    false,
  ),
  bytes: 224,
  capacity: 2,
  expected: 1,
});
{
  const linked = linkModules(
    [
      moduleSource(
        "values",
        `export interface Box {value:number}
      export function value():number{return 7;}`,
        [],
      ),
      moduleSource(
        "barrel",
        'export * from "values";export {value as get} from "values";',
        [["values", "values"]],
      ),
      moduleSource(
        "main",
        `import {get,type Box} from "barrel";
      export function run(n:number):number{const box:Box={value:get()};return box.value;}`,
        [["barrel", "barrel"]],
      ),
    ],
    "main",
    [],
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const entry = linked.value.exports.find(
    (e) => e.module === "main" && e.name === "run" && e.namespace === "value",
  );
  assert.ok(entry);
  setModules.set("source-reexports", {
    ...compileModule(
      linked.value.module,
      undefined,
      false,
      new Map(),
      [],
      [],
      false,
      entry.linkedName,
    ),
    bytes: 32,
    capacity: 16,
    expected: 7,
  });
}
setModules.set("source-captures-narrowed-variant", {
  ...compileSource(`
    type Item={readonly kind:"item";value:number}|{readonly kind:"empty"};
    function make(input:Item):()=>number {
      const source=input;
      if(source.kind==="item") {
        const state:{value:number}={value:0};state.value=1;
        return ():number=>source.value;
      }
      return ():number=>0;
    }
    function run(n:number):number {
      const item:Item={kind:"item",value:7};const read=make(item);
      if(item.kind!=="item")return -1;item.value=9;return read();
    }`),
  bytes: 176,
  capacity: 2,
  expected: 9,
});
setModules.set("source-captures-narrowed-number", {
  ...compileSource(`
    function make(input:number|undefined):()=>number{
      const value=input;if(value!==undefined)return ():number=>value+1;
      return ():number=>0;
    }
    function run(n:number):number{const read=make(7);return read();}
  `),
  bytes: 128,
  capacity: 4,
  expected: 8,
});
setModules.set("source-captures-counter", {
  ...compileSource(`
    function factory(x:number):(delta:number)=>number {
      return (delta:number):number=>{x+=delta;return x;};
    }
    function run(n:number):number {
      const a=factory(7);const b=factory(100);
      return a(3)+a(2)+b(5)+a(0);
    }
  `),
  bytes: 224,
  capacity: 2,
  expected: 139,
});
setModules.set("source-captures-siblings", {
  ...compileSource(`
    interface Pair {a:(delta:number)=>number;b:(delta:number)=>number}
    function factory(x:number):Pair {
      return {a:(delta:number):number=>{x+=delta;return x;},b:(delta:number):number=>{x+=delta;return x;}};
    }
    function run(n:number):number {
      const pair=factory(7);
      return pair.a(3)+pair.b(2)+pair.a(0);
    }
  `),
  bytes: 224,
  capacity: 2,
  expected: 34,
});
setModules.set("source-captures-forwarded", {
  ...compileSource(`
    type Counter=(delta:number)=>number;
    type Factory=()=>Counter;
    function factory(x:number):Factory {
      return ():Counter=>(delta:number):number=>{x+=delta;return x;};
    }
    function run(n:number):number {
      const make=factory(7);const a=make();const b=make();
      return a(3)+b(2)+a(0);
    }
  `),
  bytes: 272,
  capacity: 1,
  expected: 34,
});
setModules.set("source-captures-locals", {
  ...compileSource(`
    type Counter=(delta:number)=>number;
    function factory():Counter {
      let x=7;
      const f=(delta:number):number=>{const old=x++;x+=delta;return old;};
      x=10;return f;
    }
    function run(n:number):number {const f=factory();return f(2)+f(3);}
  `),
  bytes: 112,
  capacity: 4,
  expected: 23,
});
setModules.set("source-captures-block", {
  ...compileSource(`
    type Counter=(delta:number)=>number;
    interface Pair {first:Counter;last:Counter}
    function factory():Pair {
      let f:Counter=(delta:number):number=>delta;
      let first:Counter=f;
      let i=0;
      while(i<2){let x=7+i;f=(delta:number):number=>{x+=delta;return x;};if(i===0)first=f;i++;}
      return {first:first,last:f};
    }
    function run(n:number):number {const pair=factory();return pair.first(2)+pair.last(3)+pair.first(0);}
  `),
  bytes: 304,
  capacity: 1,
  expected: 29,
});
setModules.set("source-inferred-records", {
  ...compileSource(`
    function run(n:number):number {
      const first={};const second={};const alias=first;
      if(first===second||first!==alias)return -1;
      const state={count:1,nested:{value:2},label:"ok"};
      state.count=3;state.nested.value=4;
      if(state.label!=="ok")return -2;
      return state.count+state.nested.value;
    }
  `),
  // Two 16-byte empty records, a 32-byte nested record and a 48-byte outer record.
  bytes: 112,
  capacity: 4,
  expected: 7,
});
setModules.set("source-math-min-max", {
  ...compileSource(`
    interface Calls {count:number}
    function arg(c:Calls,n:number):number{c.count=c.count+1;return n;}
    function run(n:number):number {
      if(Math.min()!==1/0||Math.max()!==-1/0)return -1;
      if(Math.min(7,-3,9)!==-3||Math.max(7,-3,9)!==9)return -2;
      if(1/Math.min(0,-0)!==-1/0||1/Math.min(-0,0)!==-1/0)return -3;
      if(1/Math.max(0,-0)!==1/0||1/Math.max(-0,0)!==1/0)return -4;
      const c:Calls={count:0};
      const low=Math.min(arg(c,0/0),arg(c,3));
      const high=Math.max(arg(c,3),arg(c,0/0));
      if(low===low||high===high||c.count!==4)return -5;
      if(Math.min(-1/0,1/0)!==-1/0||Math.max(-1/0,1/0)!==1/0)return -6;
      return 1;
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 1,
});
setModules.set("source-string-compound", {
  ...compileSource(`
    function append(value:string|undefined):string {
      if(value===undefined)return "";
      value+="z";return value;
    }
    function run(n:number):number {
      let value="a";
      const rhs=():string=>{value="reset";return "b";};
      const result=(value+=rhs());
      if(result!=="ab"||value!=="ab")return -1;
      if(append(value)!=="abz"||append(undefined)!=="")return -2;
      return 1;
    }
  `),
  bytes: 176,
  capacity: 2,
  expected: 1,
});
setModules.set("source-string-code-point", {
  ...compileSource(`
    interface Calls {count:number}
    function arg(c:Calls,value:number):number{c.count=c.count+1;return value+c.count-1;}
    function run(n:number):number {
      const c:Calls={count:0};
      const s=String.fromCodePoint(arg(c,55296),arg(c,65534),arg(c,65534),arg(c,1114108));
      if(c.count!==4||s.length!==6)return -1;
      if(s.charCodeAt(0)!==55296||s.charCodeAt(1)!==65535||s.charCodeAt(2)!==55296||s.charCodeAt(3)!==56320||s.charCodeAt(4)!==56319||s.charCodeAt(5)!==57343)return -2;
      if(String.fromCodePoint()!==""||String.fromCodePoint(0).charCodeAt(0)!==0||String.fromCodePoint(-0).charCodeAt(0)!==0)return -3;
      const emoji=String.fromCodePoint(128512);
      if(emoji.length!==2||emoji.charCodeAt(0)!==55357||emoji.charCodeAt(1)!==56832)return -4;
      return 1;
    }
  `),
  // Counter, four chunks, three joins, empty/zero/negative-zero and emoji strings.
  bytes: 400,
  capacity: 1,
  expected: 1,
});
setModules.set("source-definite-assignment", {
  ...compileSource(`
    function select(flag:boolean):string {
      let value:string;if(flag)value="yes";else value="no";
      let result:string;result=value;return result;
    }
    function run(n:number):number {
      let sum:number;sum=0;
      for(let i=0;i<3;i++){let item:number;if(i===1)item=4;else item=2;sum+=item;}
      let absent:string|undefined;
      if(absent!==undefined||select(true)!=="yes"||select(false)!=="no"||sum!==8)return -1;
      const result={value:sum};return result.value;
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 8,
});
setModules.set("source-string-includes", {
  ...compileSource(`
    interface Calls {value:number}
    function receiver(c:Calls):string{c.value=c.value*10+1;return "ababa";}
    function search(c:Calls):string{c.value=c.value*10+2;return "ba";}
    function position(c:Calls):number{c.value=c.value*10+3;return 1;}
    function run(n:number):number {
      const c:Calls={value:0};
      if(!receiver(c).includes(search(c),position(c))||c.value!==123)return -1;
      if(!"ababa".includes("ba",2)||"ababa".includes("ba",4))return -2;
      if(!"ababa".includes("ba",1.9)||!"ababa".includes("ab",-9)||!"ababa".includes("ab",0/0))return -3;
      if(!"ababa".includes("",1/0)||"ababa".includes("a",1/0)||!"ababa".includes("ab",-1/0))return -4;
      if(!"".includes("")||"".includes("x")||!"abc".includes("",undefined))return -5;
      if(!"😀".includes(String.fromCharCode(56832),1)||"😀".includes("😀",1))return -6;
      c.value=0;
      if(receiver(c).indexOf(search(c),position(c))!==1||c.value!==123)return -7;
      if("ababa".indexOf("ba",2)!==3||"ababa".indexOf("ba",4)!==-1)return -8;
      if("abc".indexOf("",1/0)!==3||"abc".indexOf("a",1/0)!==-1)return -9;
      if("abc".indexOf("a",0/0)!==0||"abc".indexOf("a",-1/0)!==0)return -10;
      if("abc".indexOf("b",1.9)!==1||"abc".indexOf("b",undefined)!==1)return -11;
      if("".indexOf("")!==0||"".indexOf("a")!==-1||"abc".indexOf("abcd")!==-1)return -12;
      c.value=0;
      if(receiver(c).lastIndexOf(search(c),position(c))!==1||c.value!==123)return -13;
      if("ababa".lastIndexOf("ba")!==3||"ababa".lastIndexOf("ba",undefined)!==3)return -14;
      if("ababa".lastIndexOf("ba",2.9)!==1||"ababa".lastIndexOf("ba",3)!==3)return -15;
      if("ababa".lastIndexOf("ba",0/0)!==3||"ababa".lastIndexOf("ba",1/0)!==3)return -16;
      if("ababa".lastIndexOf("ab",-1/0)!==0||"ababa".lastIndexOf("ba",-1)!==-1)return -17;
      if("abc".lastIndexOf("")!==3||"abc".lastIndexOf("",-1)!==0||"abc".lastIndexOf("",0/0)!==3)return -18;
      if("".lastIndexOf("")!==0||"".lastIndexOf("a")!==-1||"abc".lastIndexOf("abcd")!==-1)return -19;
      return 1;
    }
  `),
  bytes: 64,
  capacity: 8,
  expected: 1,
});
setModules.set("source-string-order", {
  ...compileSource(`function less(a:string,b:string):boolean{return a<b;}
    function run(n:number):number{
      if(!less("","a")||less("same","same")||!less("a","ab")||less("ab","a"))return -1;
      if(!less("A","a")||!less("10","2")||!less("abc","abd")||less("abd","abc"))return -2;
      if(!("a"<="a")||!("a">="a")||"a">"b"||!("b">"a")||"b"<="a")return -3;
      if(!less("😀","\\ue000")||!less("\\ud800","\\ud801")||!less("a\\u0000b","a\\u0000c"))return -4;
      const result:{value:number}={value:1};return result.value;
    }`),
  bytes: 32,
  capacity: 16,
  expected: 1,
});
const primitiveUnion = primitiveUnionFixture();
const primitiveUnionNative = emitDarwinModule(primitiveUnion.module);
assert.ok(primitiveUnionNative.ok, JSON.stringify(primitiveUnionNative));
setModules.set("source-primitive-union", {
  native: primitiveUnionNative.value,
  entry: primitiveUnion.entry,
  bytes: 32,
  capacity: 16,
  expected: 11,
});
setModules.set("source-native-finally-return", {
  ...compileSource(`
    function snapshot(state:{value:number}):number {try{return state.value;}finally{state.value=7;}}
    function run(n:number):number {const state:{value:number}={value:42};const result=snapshot(state);return result===42&&state.value===7?42:-1;}
  `),
  bytes: 32,
  capacity: 16,
  expected: 42,
});
setModules.set("source-native-finally-throw", {
  ...compileSource(`
    function fail():never {try{throw 1;}finally{throw 42;}}
    function run(n:number):number {const state:{value:number}={value:42};try{fail();}catch(error){return error===42?state.value:-1;}}
  `),
  bytes: 32,
  capacity: 16,
  expected: 42,
});
setModules.set("source-native-finally-loop", {
  ...compileSource(`
    function run(n:number):number {const state:{value:number}={value:0};for(let i=0;i<4;i++){try{if(i===1)continue;if(i===2)break;}finally{state.value=state.value+1;}}return state.value===3?42:-1;}
  `),
  bytes: 32,
  capacity: 16,
  expected: 42,
});
setModules.set("source-native-finally-override", {
  ...compileSource(`
    function result():number {try{return 1;}finally{return 42;}}
    function run(n:number):number {const state:{value:number}={value:0};return result()+state.value;}
  `),
  bytes: 32,
  capacity: 16,
  expected: 42,
});
setModules.set("source-native-catch-narrowing", {
  ...compileSource(`
    function fail(value:unknown):never {throw value;}
    function run(n:number):number {
      const allocated:{value:number}={value:42};
      try {fail(allocated.value);} catch(error) {return typeof error==="number"?error:-1;}
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 42,
});
setModules.set("source-native-rethrow", {
  ...compileSource(`
    function fail(value:unknown):never {throw value;}
    function run(n:number):number {
      const sentinel:{value:number}={value:42};
      try {
        try {fail(sentinel);} catch(error) {if(error!==sentinel)return -1;throw error;}
      } catch(error) {if(error===sentinel)return sentinel.value;return -2;}
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 42,
});
setModules.set("source-native-catch", {
  ...compileSource(`
    function fail():never {throw 42;}
    function run(n:number):number {
      const allocated:{value:number}={value:42};
      try {fail();} catch(error) {return allocated.value;}
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 42,
});
const generalException = emitDarwinModule(generalExceptionFixture());
assert.ok(generalException.ok, JSON.stringify(generalException));
setModules.set("general-exception-roundtrip", {
  native: generalException.value,
  entry: 0,
  bytes: 32,
  capacity: 16,
  expected: 42,
});
const largeFrameNative = emitDarwinModule(largeFrameFixture());
assert.ok(largeFrameNative.ok, JSON.stringify(largeFrameNative));
setModules.set("large-native-frame", {
  native: largeFrameNative.value,
  entry: 0,
  bytes: 32,
  capacity: 16,
  expected: 42,
});
const largeImageNative = emitDarwinModule(largeImageFixture());
assert.ok(largeImageNative.ok, JSON.stringify(largeImageNative));
assert.ok(largeImageNative.value.code.length > 1048576);
setModules.set("large-native-image", {
  native: largeImageNative.value,
  entry: 0,
  bytes: 32,
  capacity: 16,
  expected: 42,
});
const largeBranchNative = emitDarwinModule(largeBranchFixture());
assert.ok(largeBranchNative.ok, JSON.stringify(largeBranchNative));
assert.ok(largeBranchNative.value.functions[0]!.byteLength > 1048576);
setModules.set("large-native-branch", {
  native: largeBranchNative.value,
  entry: 0,
  bytes: 32,
  capacity: 16,
  expected: 42,
});
const generalBridge = emitDarwinModule(generalValueFixture());
assert.ok(generalBridge.ok, JSON.stringify(generalBridge));
setModules.set("general-abi-roundtrip", {
  native: generalBridge.value,
  entry: 0,
  bytes: 32,
  capacity: 16,
  expected: 42,
});
const primitiveBridge = emitDarwinModule({
  records: [
    {
      byteLength: 48,
      fields: [
        { offset: 16, type: "number", mutable: false },
        { offset: 24, type: "number", mutable: false },
        { offset: 32, type: "boolean", mutable: false },
        { offset: 40, type: "optional-string", mutable: false },
      ],
    },
  ],
  functions: [
    {
      id: 0,
      name: "run",
      exported: true,
      parameters: [0],
      slots: ["number", "number"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "constant", id: 0, value: 1, ...s },
            { kind: "constant", id: 1, value: 42, ...s },
            { kind: "constant", id: 2, value: false, ...s },
            { kind: "string-none", id: 3, ...s },
            {
              kind: "record-new",
              id: 4,
              record: 0,
              arguments: [0, 1, 2, 3],
              ...s,
            },
            { kind: "primitive-wrap", id: 5, value: 4, ...s },
            { kind: "call", id: 6, target: 1, arguments: [5], ...s },
            { kind: "primitive-reference", id: 7, value: 6, ...s },
          ],
          terminator: {
            kind: "record",
            object: 7,
            record: 0,
            field: 1,
            operation: "read",
            slot: 1,
            consequent: 1,
            alternate: 2,
            ...s,
          },
        },
        {
          id: 1,
          instructions: [{ kind: "load", id: 8, slot: 1, ...s }],
          terminator: { kind: "return", value: 8, ...s },
        },
        { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
      ],
    },
    {
      id: 1,
      name: "identity",
      exported: false,
      parameters: [0],
      slots: ["primitive"],
      returnType: "primitive",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
          terminator: { kind: "return", value: 0, ...s },
        },
      ],
    },
  ],
});
assert.ok(primitiveBridge.ok, JSON.stringify(primitiveBridge));
setModules.set("primitive-abi-roundtrip", {
  native: primitiveBridge.value,
  entry: 0,
  bytes: 48,
  capacity: 10,
  expected: 42,
});
setModules.set("source-primitive-value", {
  ...compileSource(
    readFileSync("packages/native-runtime/src/values/index.ts", "utf8") +
      `
    function run(n:number):number {
      const number=fromNumber(0/0),other=fromNumber(0/0);
      const logical=fromBoolean(false),absent=fromUndefined();
      const text=fromString("a"),same=fromString("a");
      if(strictEqual(number,other)||!sameValueZero(number,other))return -1;
      if(strictEqual(logical,absent)||readBoolean(logical))return -2;
      if(!strictEqual(text,same)||readString(text)!=="a")return -3;
      if(kindOf(absent)!=="undefined"||kindOf(number)!=="number")return -4;
      return 42;
    }`,
  ),
  bytes: 288,
  capacity: 1,
  expected: 42,
});
const encodingHelperNames = ["legacy-uri", "uri", "well-formed"];
const encodingHelperDependencies: readonly [string, string][] =
  encodingHelperNames.map((name) => [
    "./" + name + ".ts",
    "text-encoding/" + name,
  ]);
function encodingSupportModules(): SourceModule[] {
  return encodingHelperNames.map((name) =>
    moduleSource(
      "text-encoding/" + name,
      readFileSync(
        "packages/foundation/src/text/text-encoding/" + name + ".ts",
        "utf8",
      ),
      [
        ["../string-builder.ts", "string-builder"],
        ...encodingHelperDependencies,
      ],
    ),
  );
}
function compileAutomaticCollectionRuntime(body?: string, instance = false) {
  const globals = [
    "TypeError",
    "RangeError",
    "undefined",
    "Number",
    "String",
    "Math",
    "NaN",
    "Infinity",
    "Map",
    "Set",
    "Uint8Array",
    "Float64Array",
    "Uint32Array",
    "TextEncoder",
    "TextDecoder",
  ];
  const packages = [
    "key-index",
    "number-list",
    "linked-map",
    "sparse-list",
    "linked-set",
    "primitive-value",
    "number-text",
    "indexed-sort",
    "list-sort",
    "string-builder",
    "text-encoding",
  ];
  const linked = linkModules(
    [
      ...encodingSupportModules(),
      moduleSource(
        "text-encoding",
        readFileSync(
          "packages/foundation/src/text/text-encoding/index.ts",
          "utf8",
        ),
        [
          ["../string-builder.ts", "string-builder"],
          ...encodingHelperDependencies,
        ],
      ),
      moduleSource(
        "string-builder",
        readFileSync("packages/foundation/src/text/string-builder.ts", "utf8"),
        [],
      ),
      ...testWorkspaceModules(
        ["number-text"],
        undefined,
        numericFixtureLocations,
      ),
      moduleSource(
        "primitive-value",
        readFileSync("packages/native-runtime/src/values/index.ts", "utf8"),
        [],
      ),
      moduleSource(
        "indexed-sort",
        readFileSync(
          "packages/foundation/src/collections/indexed-sort.ts",
          "utf8",
        ),
        [],
      ),
      moduleSource(
        "list-sort",
        readFileSync(
          "packages/foundation/src/collections/list-sort.ts",
          "utf8",
        ),
        [
          ["./list-sort/numeric.ts", "sort-numeric"],
          ["./list-sort/sparse.ts", "sort-sparse"],
        ],
      ),
      moduleSource(
        "sort-numeric",
        readFileSync(
          "packages/foundation/src/collections/list-sort/numeric.ts",
          "utf8",
        ),
        [
          ["../indexed-sort.ts", "indexed-sort"],
          ["../number-list.ts", "number-list"],
        ],
      ),
      moduleSource(
        "sort-sparse",
        readFileSync(
          "packages/foundation/src/collections/list-sort/sparse.ts",
          "utf8",
        ),
        [
          ["../indexed-sort.ts", "indexed-sort"],
          ["../sparse-list.ts", "sparse-list"],
        ],
      ),
      moduleSource("number-list", listRuntimeSource, []),
      moduleSource(
        "key-index",
        readFileSync(
          "packages/foundation/src/collections/key-index.ts",
          "utf8",
        ),
        [],
      ),
      moduleSource("linked-map", linkedMapSource, [
        ["./key-index.ts", "key-index"],
      ]),
      moduleSource("sparse-list", sparseListSource, [
        ["@tint/foundation/collections/linked-map", "linked-map"],
      ]),
      moduleSource("linked-set", stringSetSource, []),
      moduleSource(
        "main",
        packages.map((name) => `import "${name}";`).join("") +
          (body ??
            `
      interface Item {value:number}
      function run(n:number):number {
        const a:Item={value:7};const list:Item[]=[a];const numbers:number[]=[2];
        const map=new Map<string,Item>();map.set("a",a);
        const set=new Set<Item>();set.add(a);let total=0;
        for(const item of set)total+=item.value;
        const found=map.get("a"),item=list[0];
        if(found===undefined||item===undefined)return -1;
        return total+found.value+item.value+(numbers[0]??0);
      }`),
        [
          ...packages.flatMap((name): [string, string][] => [
            [name, name],
            ["@tint/" + name, name],
          ]),
          ...encodingHelperDependencies,
        ],
      ),
    ],
    "main",
    globals,
    { evaluation: "instance" },
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const helpers = new Map(
    linked.value.exports
      .filter((e) => e.namespace === "value")
      .map((e) => [e.module + ":" + e.name, e.linkedName]),
  );
  const bound = bindModule(linked.value.module, globals);
  assert.ok(bound.ok, JSON.stringify(bound));
  const normalized = prepareNativeGlobals(
    linked.value.module,
    bound.value,
    ["TextEncoder", "TextDecoder"].map((name) => {
      const factory = helpers.get("text-encoding:createNative" + name);
      assert.ok(factory);
      return { global: name, factory };
    }),
  );
  assert.ok(normalized.ok, JSON.stringify(normalized));
  const rebound = bindModule(normalized.value, globals);
  assert.ok(rebound.ok, JSON.stringify(rebound));
  const source = specializeModule(normalized.value, rebound.value);
  assert.ok(source.ok, JSON.stringify(source));
  const checked = checkClosureModule(source.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const originalRun = linked.value.module.statements
    .filter(
      (s) =>
        s.kind === "function" && linked.value.origins.get(s)?.module === "main",
    )
    .at(-1);
  assert.ok(originalRun?.kind === "function");
  let entryName = originalRun.name;
  const prepared = prepareCollectionRuntimes(
    normalized.value,
    checked.value,
    helpers,
    globals,
    instance
      ? (module) => {
          const retained = module.statements.flatMap((s) =>
            locateSource(linked.value, s)?.module !== "main"
              ? s.kind === "function"
                ? [s.name]
                : s.kind === "variable"
                  ? s.declarations.flatMap((d) =>
                      bindingIdentifiers(d).map(
                        (identifier) => identifier.name,
                      ),
                    )
                  : []
              : [],
          );
          const bound = bindModule(module, globals);
          assert.ok(bound.ok);
          const prepared = prepareModuleInstance(
            module,
            bound.value,
            [{ name: "run", local: originalRun.name }],
            retained,
          );
          assert.ok(prepared.ok, JSON.stringify(prepared));
          entryName = "__tint_native_instance_run";
          const driver = moduleSource(
            "driver",
            " ".repeat(module.end) +
              `function ${entryName}(n:number):number{const state=${prepared.value.initializer.name}();return state.run(n);}`,
            [],
          ).module;
          return {
            ok: true,
            value: {
              ...prepared.value.module,
              statements: [
                ...prepared.value.module.statements,
                ...driver.statements,
              ],
              end: driver.end,
            },
          };
        }
      : undefined,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const c = prepared.value.checked;
  const entries = c.bindings.functions
    .filter((fn) => fn.parent === undefined)
    .map((fn) => fn.id);
  const lowered = lowerModuleEntries(
    c,
    entries,
    target,
    4096,
    prepared.value.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const native = emitDarwinModule(lowered.value.module);
  assert.ok(native.ok, JSON.stringify(native));
  const run = c.module.statements.find(
    (s) => s.kind === "function" && s.name === entryName,
  );
  const fn = c.bindings.functions.find((f) => f.node === run);
  assert.ok(fn);
  return { native: native.value, entry: entries.indexOf(fn.id) };
}
setModules.set("source-runtime-module-instance", {
  ...compileAutomaticCollectionRuntime(
    `const values=[20,21];function increment(x:number):number{return x+1;}
    function run(n:number):number{return values.map(increment)[0]??0;}`,
    true,
  ),
  bytes: 512,
  regionBytes: 512,
  capacity: 1,
  expected: 21,
});
setModules.set("source-optional-callback", {
  ...compileSource(`function apply(f:((x:number)=>number)|undefined,n:number):number {if(f===undefined)return 0;return f(n);}
    function run(n:number):number{return apply((x:number):number=>x+1,41)+apply(undefined,9);}`),
  bytes: 48,
  capacity: 10,
  expected: 42,
});

setModules.set("source-automatic-number-format", {
  ...compileAutomaticCollectionRuntime(
    `function run(n:number):number{return String(0.5)==="0.5"?1:-1;}`,
  ),
  bytes: 816,
  regionBytes: 816,
  capacity: 1,
  expected: 1,
});
setModules.set("source-automatic-number-parse", {
  ...compileAutomaticCollectionRuntime(
    `function run(n:number):number{return Number("0.1")===0.1?1:-1;}`,
  ),
  bytes: 6096,
  regionBytes: 6096,
  capacity: 1,
  expected: 1,
});
setModules.set("source-automatic-sort-number", {
  ...compileAutomaticCollectionRuntime(
    `function run(n:number):number{const values=[3,1,2];const result=values.sort((a,b)=>a-b);result[0]=7;return values[0]===7&&values[1]===2&&values[2]===3?1:-1;}`,
  ),
  bytes: 800,
  regionBytes: 800,
  capacity: 1,
  expected: 1,
});
setModules.set("source-automatic-sort-string", {
  ...compileAutomaticCollectionRuntime(
    `function run(n:number):number{const values=["bbb","a","cc"];values.sort((a,b)=>a.length-b.length);return values[0]==="a"&&values[1]==="cc"&&values[2]==="bbb"?1:-1;}`,
  ),
  bytes: 864,
  regionBytes: 864,
  capacity: 1,
  expected: 1,
});

{
  const program = moduleSource(
    "main",
    "export function run(n:number):number{return n+42;}",
    [],
  );
  const compiled = compileArm64Program({
    modules: [program],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [],
  });
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.notEqual(compiled.value.entry, undefined);
  setModules.set("source-native-compiler-pipeline", {
    native: compiled.value.native,
    entry: compiled.value.entry!,
    bytes: 80,
    regionBytes: 80,
    capacity: 1,
    expected: 43,
  });
}
{
  const runtimeIds = [
    "key-index",
    "number-list",
    "linked-map",
    "sparse-list",
    "linked-set",
    "primitive-value",
    "number-text",
    "indexed-sort",
    "list-sort",
    "text-encoding",
  ];
  const runtimeModules = testWorkspaceModules(
    runtimeIds,
    undefined,
    new Map([...collectionFixtureLocations, ...numericFixtureLocations]),
  );
  const compiled = compileArm64Program({
    modules: [
      ...runtimeModules,
      moduleSource(
        "main",
        'export function run(n:number):number{return new TextEncoder().encode("aé😀\\ud800").length+32;}',
        [],
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: runtimeIds.map((id) => ({ module: id, namespace: id })),
  });
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.notEqual(compiled.value.entry, undefined);
  setModules.set("source-native-global-encoder", {
    native: compiled.value.native,
    entry: compiled.value.entry!,
    bytes: 304,
    regionBytes: 304,
    capacity: 1,
    expected: 42,
  });
  const decoder = compileArm64Program({
    modules: [
      ...runtimeModules,
      moduleSource(
        "main",
        `export function run(n:number):number {
    const encoder=new TextEncoder(),decoder=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});
    if(decoder.decode(encoder.encode("é😀"))!=="é😀")return -1;
    const invalid=new Uint8Array(1);invalid[0]=255;
    try{decoder.decode(invalid);return -2;}catch(error){return error instanceof TypeError?42:-3;}
  }`,
        [],
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: runtimeIds.map((id) => ({ module: id, namespace: id })),
  });
  assert.ok(decoder.ok, JSON.stringify(decoder));
  assert.notEqual(decoder.value.entry, undefined);
  setModules.set("source-native-global-decoder", {
    native: decoder.value.native,
    entry: decoder.value.entry!,
    bytes: 1840,
    regionBytes: 1920,
    capacity: 1,
    expected: 42,
  });
  const sourceText = compileArm64Program({
    modules: [
      ...runtimeModules,
      moduleSource(
        "source-text",
        readFileSync("packages/source/src/text.ts", "utf8"),
        [],
      ),
      moduleSource(
        "main",
        `import {createSourceText} from "source-text";
      export function run(n:number):number {
        const bytes=new TextEncoder().encode("é\\n😀"),source=createSourceText(bytes,bytes.length);
        if(!source.ok)return -1;
        const value=source.value,position=value.positionAt(2),copied=value.copyBytes();
        bytes[0]=0;
        if(!position.ok||position.value.line!==2||position.value.column!==1||copied[0]!==195)return -2;
        const invalid=new Uint8Array(1);invalid[0]=255;
        const failure=createSourceText(invalid,1);
        if(failure.ok)return -3;
        const error=failure.error;if(error.kind!=="invalid-utf8"||error.byteOffset!==0)return -4;
        return 42;
      }`,
        [["source-text", "source-text"]],
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: runtimeIds.map((id) => ({ module: id, namespace: id })),
  });
  assert.ok(sourceText.ok, JSON.stringify(sourceText));
  assert.notEqual(sourceText.value.entry, undefined);
  setModules.set("source-native-source-text", {
    native: sourceText.value.native,
    entry: sourceText.value.entry!,
    bytes: 5984,
    regionBytes: 6128,
    capacity: 1,
    expected: 42,
  });

  const collector = compileArm64Program({
    modules: [
      ...runtimeModules,
      ...[
        "native-tracing",
        "native-tracing/scan",
        "native-tracing/collector",
        "native-tracing/relocation",
        "native-tracing/fixups",
        "native-tracing/extent",
        "native-tracing/nursery",
        "linear-allocator",
        "graph-marking",
      ].map((id) => {
        const parts = id.split("/");
        return moduleSource(
          id,
          readFileSync(
            "packages/" + parts[0] + "/src/" + (parts[1] ?? "index") + ".ts",
            "utf8",
          ),
          [
            ["./relocation.ts", "native-tracing/relocation"],
            ["./fixups.ts", "native-tracing/fixups"],
            ["./extent.ts", "native-tracing/extent"],
            ["./nursery.ts", "native-tracing/nursery"],
            ["@tint/native-runtime/allocators/linear", "linear-allocator"],
            ["./scan.ts", "native-tracing/scan"],
            ["./collector.ts", "native-tracing/collector"],
            ["@tint/native-runtime/graph", "graph-marking"],
          ],
        );
      }),
      moduleSource(
        "main",
        `
        import {createNativeCollector} from "native-tracing";
        function word(address:number,root:number):number|undefined{
          if(address===256||address===512||address===768)return 4096;
          if(address===264||address===520||address===776||address===4120||address===8192||address===4176)return 0;
          if(address===272)return 512;if(address===528)return 256;if(address===784)return 768;
          if(address===4096)return 32;if(address===4104||address===4160)return 1;
          if(address===4112||address===4168)return 16;if(address===8200)return 4160;if(address===8208)return root;
          return undefined;
        }
        export function run(n:number):number{
          let root=256;
          const starts=new Float64Array(3),sizes=new Uint32Array(3),marks=new Uint8Array(3),pending=new Uint32Array(3),roots=new Float64Array(3);
          starts[0]=256;starts[1]=512;starts[2]=768;sizes.fill(32);
          const collector=createNativeCollector((address)=>word(address,root),starts,sizes,marks,pending,roots,(address)=>false);
          if(collector.mark(3,8192)!=="complete"||marks[0]!==2||marks[1]!==2||marks[2]!==0)return -1;
          root=768;
          if(collector.mark(3,8192)!=="complete"||marks[0]!==0||marks[1]!==0||marks[2]!==2)return -2;
          root=776;
          if(collector.mark(3,8192)!=="read"||marks[0]!==0||marks[1]!==0||marks[2]!==0)return -3;
          return 42;
        }`,
        [["native-tracing", "native-tracing"]],
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: runtimeIds.map((id) => ({ module: id, namespace: id })),
  });
  assert.ok(collector.ok, JSON.stringify(collector));
  assert.notEqual(collector.value.entry, undefined);
  setModules.set("source-native-collector", {
    native: collector.value.native,
    entry: collector.value.entry!,
    bytes: 3440,
    regionBytes: 3440,
    capacity: 1,
    expected: 42,
  });

  const hostSource = `export function openRead(path:Uint8Array):number{throw "HOST_UNAVAILABLE";}
    export function openExclusive(path:Uint8Array,mode:number):number{throw "HOST_UNAVAILABLE";}
    export function read(fd:number,buffer:Uint8Array):number{throw "HOST_UNAVAILABLE";}
    export function write(fd:number,buffer:Uint8Array):number{throw "HOST_UNAVAILABLE";}
    export function close(fd:number):number{throw "HOST_UNAVAILABLE";}
    export function chmod(fd:number,mode:number):number{throw "HOST_UNAVAILABLE";}
    export function rename(from:Uint8Array,to:Uint8Array):number{throw "HOST_UNAVAILABLE";}
    export function unlink(path:Uint8Array):number{throw "HOST_UNAVAILABLE";}`;
  const fileHost = compileArm64Program({
    modules: [
      ...runtimeModules,
      moduleSource("host", hostSource, []),
      moduleSource(
        "main",
        `
    import {openRead,openExclusive,read,write,close,chmod,rename,unlink} from "host";
    export function run(n:number):number{
      const encoder=new TextEncoder(),temporary=encoder.encode("native-host.tmp\\0"),destination=encoder.encode("native-host.out\\0");
      const outgoing=new Uint8Array(4),incoming=new Uint8Array(4);
      outgoing[0]=0;outgoing[1]=255;outgoing[2]=42;outgoing[3]=10;
      const writer=openExclusive(temporary,0o600);if(writer<0)return -1;
      if(write(writer,outgoing)!==4||chmod(writer,0o755)!==0||close(writer)!==0)return -2;
      if(rename(temporary,destination)!==0)return -3;
      const reader=openRead(destination);if(reader<0)return -4;
      if(read(reader,incoming)!==4||read(reader,incoming)!==0||close(reader)!==0)return -5;
      if(incoming[0]!==0||incoming[1]!==255||incoming[2]!==42||incoming[3]!==10)return -6;
      if(unlink(destination)!==0||openRead(destination)!==-2)return -7;
      return 42;
    }`,
        [["host", "host"]],
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [
      ...runtimeIds.map((id) => ({ module: id, namespace: id })),
      { module: "host", namespace: "host" },
    ],
    hostBindings: [
      { module: "host", name: "openRead", operation: "open-read" },
      { module: "host", name: "openExclusive", operation: "open-exclusive" },
      { module: "host", name: "read", operation: "read" },
      { module: "host", name: "write", operation: "write" },
      { module: "host", name: "close", operation: "close" },
      { module: "host", name: "chmod", operation: "chmod" },
      { module: "host", name: "rename", operation: "rename" },
      { module: "host", name: "unlink", operation: "unlink" },
    ],
  });
  assert.ok(fileHost.ok, JSON.stringify(fileHost));
  assert.notEqual(fileHost.value.entry, undefined);
  setModules.set("source-native-host-files", {
    native: fileHost.value.native,
    entry: fileHost.value.entry!,
    bytes: 480,
    regionBytes: 480,
    capacity: 1,
    expected: 42,
  });
  const adapterIds = [
    "native-fs",
    "native-fs/api",
    "native-fs/darwin",
    "native-fs/host",
    "file-service",
    "sync-io",
  ];
  const adapterModules = adapterIds.map((id) => {
    const parts = id.split("/");
    return moduleSource(
      id,
      readFileSync(
        "packages/" + parts[0] + "/src/" + (parts[1] ?? "index") + ".ts",
        "utf8",
      ),
      [
        ["./api.ts", "native-fs/api"],
        ["./darwin.ts", "native-fs/darwin"],
        ["./host.ts", "native-fs/host"],
        ["@tint/platform/files/service", "file-service"],
        ["@tint/platform/io/sync", "sync-io"],
      ],
    );
  });
  const adapter = compileArm64Program({
    modules: [
      ...runtimeModules,
      ...adapterModules,
      moduleSource(
        "main",
        `
      import {openSync,readSync,writeSync,closeSync,fchmodSync,renameSync,unlinkSync,createNativeFileHost} from "node:fs";
      import {readFile,publishFile} from "file-service";
      export function run(n:number):number{
        const outgoing=new Uint8Array(4),incoming=new Uint8Array(6);
        outgoing[0]=0;outgoing[1]=255;outgoing[2]=42;outgoing[3]=10;
        const writer=openSync("adapter-😀.tmp","wx",0o600);
        if(writeSync(writer,outgoing,0,4,null)!==4)return -1;
        fchmodSync(writer,0o755);closeSync(writer);renameSync("adapter-😀.tmp","adapter.out");
        const reader=openSync("adapter.out","r");
        if(readSync(reader,incoming,1,4,null)!==4||readSync(reader,incoming,0,1,null)!==0)return -2;
        closeSync(reader);unlinkSync("adapter.out");
        if(incoming[1]!==0||incoming[2]!==255||incoming[3]!==42||incoming[4]!==10)return -3;
        const host=createNativeFileHost(),missing=host.openRead("adapter.out");
        if(missing.ok)return -4;
        const error=missing.error;
        if(error.kind!=="host"||error.code!=="ENOENT"||error.interrupted)return -5;
        const published=publishFile<number>(host,"service.out",outgoing,true);
        if(!published.ok)return -6;
        const loaded=readFile<number>(host,"service.out",32);
        if(!loaded.ok)return -7;
        const content=loaded.value;
        if(content.length!==4||content[0]!==0||content[1]!==255||content[2]!==42||content[3]!==10)return -8;
        unlinkSync("service.out");
        return 42;
      }`,
        [
          ["node:fs", "native-fs"],
          ["file-service", "file-service"],
        ],
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [
      ...runtimeIds.map((id) => ({ module: id, namespace: id })),
      { module: "native-fs/host", namespace: "native-fs-host" },
    ],
    hostBindings: [
      { module: "native-fs/host", name: "openRead", operation: "open-read" },
      {
        module: "native-fs/host",
        name: "openExclusive",
        operation: "open-exclusive",
      },
      { module: "native-fs/host", name: "read", operation: "read" },
      { module: "native-fs/host", name: "write", operation: "write" },
      { module: "native-fs/host", name: "close", operation: "close" },
      { module: "native-fs/host", name: "chmod", operation: "chmod" },
      { module: "native-fs/host", name: "rename", operation: "rename" },
      { module: "native-fs/host", name: "unlink", operation: "unlink" },
    ],
  });
  assert.ok(adapter.ok, JSON.stringify(adapter));
  assert.notEqual(adapter.value.entry, undefined);
  setModules.set("source-native-fs-adapter", {
    native: adapter.value.native,
    entry: adapter.value.entry!,
    bytes: 10096,
    regionBytes: 10176,
    capacity: 1,
    expected: 42,
  });
}
{
  const hosted = compileArm64Program({
    modules: [
      moduleSource(
        "host",
        'export function closeFile(fd:number):number{throw "HOST_UNAVAILABLE";}',
        [],
      ),
      moduleSource(
        "main",
        'import {closeFile} from "host";export function run(n:number):number{return closeFile(-1)+51;}',
        [["host", "host"]],
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [{ module: "host", namespace: "host" }],
    hostBindings: [{ module: "host", name: "closeFile", operation: "close" }],
  });
  assert.ok(hosted.ok, JSON.stringify(hosted));
  assert.notEqual(hosted.value.entry, undefined);
  setModules.set("source-native-host-close", {
    native: hosted.value.native,
    entry: hosted.value.entry!,
    bytes: 80,
    regionBytes: 80,
    capacity: 1,
    expected: 42,
  });
}
{
  const memory = compileArm64Program({
    modules: [
      moduleSource(
        "memory",
        readFileSync(
          "packages/native-runtime/src/intrinsics/memory.ts",
          "utf8",
        ),
        [],
      ),
      moduleSource(
        "main",
        `import {mapMemory as map,unmapMemory as unmap,readMemoryWord as read,writeMemoryWord as write,currentRootHead} from "memory";
   export function run(n:number):number{
    const address=map(4096);if(address<=0)return -1;
    let result=42;
    if(currentRootHead()<=0)return -6;
    if(read(address,4096,0)!==0)result=-20;
    if(write(address,4096,0,9007199254740991)!==0)result=-21;
    if(read(address,4096,0)!==9007199254740991)result=-22;
    if(write(address,4096,4088,42)!==0||read(address,4096,4088)!==42)result=-3;
    if(read(address,4096,4096)!==-1||read(address,4096,1)!==-1||write(address,4096,0,-1)!==-1||read(0,4096,0)!==-1)result=-4;
    if(unmap(address,4096)!==0)result=-5;
    return result;
   }`,
        [["memory", "memory"]],
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [{ module: "memory", namespace: "memory" }],
    hostBindings: [
      { module: "memory", name: "mapMemory", operation: "memory-map" },
      { module: "memory", name: "currentRootHead", operation: "root-head" },
      { module: "memory", name: "unmapMemory", operation: "memory-unmap" },
      {
        module: "memory",
        name: "readMemoryWord",
        operation: "memory-read-word",
      },
      {
        module: "memory",
        name: "writeMemoryWord",
        operation: "memory-write-word",
      },
    ],
  });
  assert.ok(memory.ok, JSON.stringify(memory));
  assert.notEqual(memory.value.entry, undefined);
  setModules.set("source-native-memory", {
    native: memory.value.native,
    entry: memory.value.entry!,
    bytes: 80,
    regionBytes: 80,
    capacity: 1,
    expected: 42,
  });
}
{
  const heapRequest: CompileRequest = {
    modules: [
      ...[
        "native-memory",
        "native-heap",
        "native-heap/compaction",
        "relocation-plan",
        "relocation-plan/commit",
        "native-tracing",
        "native-tracing/scan",
        "native-tracing/collector",
        "native-tracing/relocation",
        "native-tracing/fixups",
        "native-tracing/extent",
        "native-tracing/nursery",
        "linear-allocator",
        "graph-marking",
        "region-allocator",
      ].map((id) => {
        const parts = id.split("/");
        return moduleSource(
          id,
          readFileSync(
            "packages/" + parts[0] + "/src/" + (parts[1] ?? "index") + ".ts",
            "utf8",
          ),
          [
            ["./compaction.ts", "native-heap/compaction"],
            ["./commit.ts", "relocation-plan/commit"],
            ["./relocation.ts", "native-tracing/relocation"],
            ["./fixups.ts", "native-tracing/fixups"],
            ["./extent.ts", "native-tracing/extent"],
            ["./nursery.ts", "native-tracing/nursery"],
            ["@tint/native-runtime/allocators/linear", "linear-allocator"],
            ["@tint/native-runtime/relocation", "relocation-plan"],
            ["./scan.ts", "native-tracing/scan"],
            ["./collector.ts", "native-tracing/collector"],
            ["@tint/native-runtime/graph", "graph-marking"],
            ["@tint/native-runtime/allocators/region", "region-allocator"],
            ["@tint/native-runtime/tracing", "native-tracing"],
          ],
        );
      }),
      moduleSource(
        "main",
        `
   import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord} from "native-memory";
   import {createNativeCollector} from "native-tracing";
   import {createRegionAllocator,snapshotRegionAllocations} from "region-allocator";
   export function run(n:number):number{
    const base=mapMemory(4096);if(base<=0)return -1;
    const metadata=new Uint32Array(24+96),allocator=createRegionAllocator(128,16,metadata);
    if(allocator===undefined)return -2;
    if(allocator.allocate(32)!==0||allocator.allocate(32)!==32||allocator.allocate(32)!==64)return -3;
    const offsets=new Uint32Array(3),sizes=new Uint32Array(3),starts=new Float64Array(3),marks=new Uint8Array(3),pending=new Uint32Array(3),roots=new Float64Array(3);
    const count=snapshotRegionAllocations(metadata,128,offsets,sizes);if(count===undefined||count!==3)return -4;
    for(let i=0;i<count;i++){
     const offset=offsets[i];if(offset===undefined)return -5;starts[i]=base+offset;
     if(writeMemoryWord(base,4096,offset,base+1024)!==0)return -6;
    }
    writeMemoryWord(base,4096,16,base+32);writeMemoryWord(base,4096,48,base);writeMemoryWord(base,4096,80,base+64);
    writeMemoryWord(base,4096,1024,32);writeMemoryWord(base,4096,1032,1);writeMemoryWord(base,4096,1040,16);
    writeMemoryWord(base,4096,1088,1);writeMemoryWord(base,4096,1096,16);
    writeMemoryWord(base,4096,2056,base+1088);writeMemoryWord(base,4096,2064,base);
    const collector=createNativeCollector((address)=>{const value=readMemoryWord(base,4096,address-base);return value<0?undefined:value;},starts,sizes,marks,pending,roots,(address)=>false);
    if(collector.mark(3,base+2048)!=="complete"||marks[0]!==2||marks[1]!==2||marks[2]!==0)return -7;
    if(!allocator.release(64)||allocator.usedBytes()!==64||allocator.allocate(32)!==64)return -8;
    writeMemoryWord(base,4096,2064,base+8);
    if(collector.mark(3,base+2048)!=="read"||allocator.usedBytes()!==96)return -9;
    writeMemoryWord(base,4096,2064,base+64);writeMemoryWord(base,4096,80,0);
    if(collector.mark(3,base+2048)!=="complete"||marks[0]!==0||marks[1]!==0||marks[2]!==2)return -10;
    for(let i=2;i>=0;i--){if(marks[i]===0){const offset=offsets[i];if(offset===undefined||!allocator.release(offset))return -11;}}
    if(allocator.allocate(64)!==0||allocator.usedBytes()!==96)return -12;
    if(unmapMemory(base,4096)!==0)return -13;
    return 42;
   }`,
        [
          ["native-memory", "native-memory"],
          ["native-tracing", "native-tracing"],
          ["region-allocator", "region-allocator"],
        ],
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [{ module: "native-memory", namespace: "native-memory" }],
    hostBindings: [
      { module: "native-memory", name: "mapMemory", operation: "memory-map" },
      {
        module: "native-memory",
        name: "unmapMemory",
        operation: "memory-unmap",
      },
      {
        module: "native-memory",
        name: "readMemoryWord",
        operation: "memory-read-word",
      },
      {
        module: "native-memory",
        name: "writeMemoryWord",
        operation: "memory-write-word",
      },
    ],
  };
  const heap = compileArm64Program(heapRequest);
  assert.ok(heap.ok, JSON.stringify(heap));
  assert.notEqual(heap.value.entry, undefined);
  setModules.set("source-native-heap-collection", {
    native: heap.value.native,
    entry: heap.value.entry!,
    bytes: 5824,
    regionBytes: 5824,
    capacity: 1,
    expected: 42,
  });
  const automaticHeap = compileArm64Program({
    ...heapRequest,
    modules: [
      ...heapRequest.modules.filter((module) => module.id !== "main"),
      moduleSource(
        "main",
        `
    import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord} from "native-memory";
    import {createCollectingRegion} from "native-heap";
    function object(base:number,offset:number,next:number):void{
      writeMemoryWord(base,4096,offset,base+1024);writeMemoryWord(base,4096,offset+8,0);writeMemoryWord(base,4096,offset+16,next);
    }
    export function run(n:number):number{
      const base=mapMemory(4096);if(base<=0)return -1;
      writeMemoryWord(base,4096,1024,32);writeMemoryWord(base,4096,1032,1);writeMemoryWord(base,4096,1040,16);
      writeMemoryWord(base,4096,1088,1);writeMemoryWord(base,4096,1096,16);
      writeMemoryWord(base,4096,2056,base+1088);writeMemoryWord(base,4096,2064,base);
      const heap=createCollectingRegion({base,byteLength:96,metadata:new Uint32Array(12+96),offsets:new Uint32Array(3),sizes:new Uint32Array(3),starts:new Float64Array(3),marks:new Uint8Array(3),pending:new Uint32Array(3),roots:new Float64Array(3),readWord:(address)=>{const value=readMemoryWord(base,4096,address-base);return value<0?undefined:value;},rootHead:()=>base+2048,isExternal:(address)=>false});
      if(heap===undefined)return -2;
      if(heap.allocate(32)!==0)return -3;object(base,0,base);
      if(heap.allocate(32)!==32)return -4;object(base,32,base+64);
      if(heap.allocate(32)!==64)return -5;object(base,64,base+32);
      if(heap.allocate(48)!==32||heap.usedBytes()!==80)return -6;object(base,32,0);
      writeMemoryWord(base,4096,2064,base+32);
      if(heap.collect()!=="complete"||heap.usedBytes()!==48||heap.allocate(32)!==0)return -7;object(base,0,0);
      writeMemoryWord(base,4096,2064,base+8);
      if(heap.allocate(32)!==undefined||heap.usedBytes()!==80)return -8;
      if(unmapMemory(base,4096)!==0)return -9;
      return 42;
    }`,
        [
          ["native-memory", "native-memory"],
          ["native-heap", "native-heap"],
        ],
      ),
    ],
  });
  assert.ok(automaticHeap.ok, JSON.stringify(automaticHeap));
  assert.notEqual(automaticHeap.value.entry, undefined);
  setModules.set("source-native-heap-pressure", {
    native: automaticHeap.value.native,
    entry: automaticHeap.value.entry!,
    bytes: 6720,
    regionBytes: 6720,
    capacity: 1,
    expected: 42,
  });
}
setModules.set("source-typed-array-list", {
  ...compileAutomaticCollectionRuntime(`function run(n:number):number{
    const chunks:Uint8Array[]=[];const first=new Uint8Array(2);first[0]=7;first[1]=8;
    chunks.push(first);chunks.push(first.subarray(1));
    const a=chunks[0],b=chunks.pop();if(a===undefined||b===undefined)return -1;
    b[0]=35;return (a[0]??0)+(a[1]??0);
  }`),
  bytes: 256,
  regionBytes: 272,
  capacity: 1,
  expected: 42,
});
setModules.set("source-uninitialized-primitive", {
  ...compileAutomaticCollectionRuntime(`function pick(enabled:boolean):number|string|undefined{
   let result:number|string|undefined;if(enabled)result="ab";return result;
 }function run(n:number):number{const a=pick(false),b=pick(true);
   if(typeof a!=="undefined"||typeof b!=="string")return -1;return b.length+40;}`),
  bytes: 144,
  regionBytes: 144,
  capacity: 1,
  expected: 42,
});
setModules.set("source-widened-string-union", {
  ...compileSource(`function choose(tag:string|"a"):number{switch(tag){case "a":return 42;default:return 0;}}
 function run(n:number):number{const tag:{value:string|"a"}={value:"a"};return choose(tag.value);}`),
  bytes: 32,
  regionBytes: 32,
  capacity: 1,
  expected: 42,
});
setModules.set("source-mixed-primitive-for-of", {
  ...compileAutomaticCollectionRuntime(`function run(n:number):number {
   const values:(number|string|boolean|undefined)[]=[20,"ab",undefined,false];
   let total=0;for(const value of values){if(typeof value==="number")total+=value;
     else if(typeof value==="string")total+=value.length;
     else if(typeof value==="boolean"&&!value)total+=20;}
   return total;}`),
  bytes: 480,
  regionBytes: 480,
  capacity: 1,
  expected: 42,
});
setModules.set("source-optional-typed-array", {
  ...compileAutomaticCollectionRuntime(`
    function size(bytes:Uint8Array=new Uint8Array(0)):number{return bytes.length;}
    function run(n:number):number{const bytes=new Uint8Array(42);return size(bytes)+size();}`),
  bytes: 112,
  regionBytes: 112,
  capacity: 1,
  expected: 42,
});
setModules.set("source-type-error-brand", {
  ...compileAutomaticCollectionRuntime(`
    function isError(value:unknown):boolean{return value instanceof TypeError;}
    function run(n:number):number {
      const lookalike:{name:string;message:string}={name:"TypeError",message:"bad"};
      if(isError("bad")||isError(0)||isError(undefined)||isError(lookalike))return -1;
      const range=new RangeError("range");if(isError(range)||!(range instanceof RangeError))return -4;
      try{throw new TypeError("bad");}catch(error){if(isError(error))return 42;return -2;}
    }`),
  bytes: 96,
  regionBytes: 96,
  capacity: 1,
  expected: 42,
});
setModules.set("source-utf8-encoding", {
  ...compileAutomaticCollectionRuntime(
    readFileSync(
      "packages/foundation/src/text/text-encoding/index.ts",
      "utf8",
    ) +
      `
    function run(n:number):number {
      const bytes=encodeUTF8("aé😀\\ud800");
      if(bytes.length!==10||bytes[0]!==97||bytes[1]!==195||bytes[2]!==169||bytes[3]!==240||bytes[7]!==239||bytes[9]!==189)return -1;
      return 42;
    }`,
  ),
  bytes: 80,
  regionBytes: 80,
  capacity: 1,
  expected: 42,
});
setModules.set("source-indexed-marking", {
  ...compileAutomaticCollectionRuntime(
    readFileSync("packages/native-runtime/src/graph/index.ts", "utf8") +
      `
    function root(index:number):number|undefined{return index===0?0:-1;}
    function count(node:number):number|undefined{return node<2?1:0;}
    function edge(node:number,index:number):number|undefined{return node===0?1:0;}
    function run(n:number):number {
      const graph:IndexedGraph={nodeCount:3,rootCount:2,rootAt:(i)=>root(i),edgeCount:(node)=>count(node),edgeAt:(node,i)=>edge(node,i)};
      const marks=new Uint8Array(3),pending=new Uint32Array(2);
      if(markIndexedGraph(graph,marks,pending)!=="complete")return -1;
      if(markIndexedGraph(graph,marks,pending)!=="complete")return -2;
      if(marks[0]!==2||marks[1]!==2||marks[2]!==0)return -3;
      return 42;
    }`,
  ),
  bytes: 304,
  regionBytes: 304,
  capacity: 1,
  expected: 42,
});
setModules.set("source-typed-array-metadata", {
  ...compileAutomaticCollectionRuntime(`
    function run(n:number):number {
      const root=new Uint32Array(8),view=root.subarray(2,7),inner=view.subarray(1,3),other=new Uint8Array(1);
      if(root.buffer!==view.buffer||view.buffer!==inner.buffer||root.buffer===other.buffer)return -1;
      if(root.byteOffset!==0||view.byteOffset!==8||inner.byteOffset!==12||view.byteLength!==20)return -2;
      return root.byteLength+inner.byteLength+2;
    }`),
  bytes: 208,
  regionBytes: 208,
  capacity: 1,
  expected: 42,
});
setModules.set("source-nullable-primitive", {
  ...compileAutomaticCollectionRuntime(`
    function read(value:number|null|undefined):number {
      if(value===undefined)return 10;
      if(value===null)return 12;
      return value;
    }
    function run(n:number):number{return read(undefined)+read(null)+read(20);}`),
  bytes: 384,
  regionBytes: 384,
  capacity: 1,
  expected: 42,
});
setModules.set("source-nullable-coalescing", {
  ...compileAutomaticCollectionRuntime(`
    function fallback(value:number|null|undefined):number{return value??10;}
    function run(n:number):number{return fallback(null)+fallback(undefined)+fallback(22);}`),
  bytes: 144,
  regionBytes: 144,
  capacity: 1,
  expected: 42,
});
setModules.set("source-nullish-widening", {
  ...compileAutomaticCollectionRuntime(`
    function fallback(value:string|undefined):string|number{return value??22;}
    function run(n:number):number{const a=fallback("x"),b=fallback(undefined);
      if(typeof a!=="string"||typeof b!=="number")return -1;
      return a.length+b+19;}`),
  bytes: 96,
  regionBytes: 96,
  capacity: 1,
  expected: 42,
});

setModules.set("source-mixed-primitive-set-zero", {
  ...compileAutomaticCollectionRuntime(`
    function run(n:number):number {
      const set=new Set<number|string>();set.add(-0);set.add(0);
      let total=0;
      for(const value of set) {
        if(typeof value!=="number"||1/value<0)return -1;
        total+=1;
      }
      return total;
    }`),
  bytes: 304,
  capacity: 1,
  expected: 1,
});
setModules.set("source-mixed-primitive-set-nan", {
  ...compileAutomaticCollectionRuntime(`
    function run(n:number):number {
      const set=new Set<number|string|undefined>();
      set.add(0/0);set.add(0/0);set.add(undefined);set.add("NaN");
      if(!set.has(0/0))return -1;
      return set.size;
    }`),
  bytes: 432,
  capacity: 1,
  expected: 3,
});
setModules.set("source-optional-primitive-sets", {
  ...compileAutomaticCollectionRuntime(`
    function run(n:number):number {
      const numbers=new Set<number|undefined>();numbers.add(-0);numbers.add(undefined);
      const strings=new Set<string|undefined>();strings.add("a");strings.add(undefined);
      let total=0;
      for(const value of numbers) {
        if(value!==undefined&&1/value<0)return -1;
        total+=1;
      }
      for(const value of strings) {
        if(value!==undefined&&value!=="a")return -2;
        total+=1;
      }
      return total;
    }`),
  bytes: 416,
  capacity: 1,
  expected: 4,
});
setModules.set("source-logical-assignment", {
  ...compileSource(`
    function bump(state:{calls:number}):number {state.calls=state.calls+1;return state.calls;}
    function run(n:number):number {
      const state:{calls:number}={calls:0};
      let a=0; a ||= bump(state); a ||= bump(state); a &&= bump(state);
      let b=0; b &&= bump(state);
      let text=""; text ||= "value"; text &&= "done";
      let flag=false; flag ||= true; flag &&= false;
      let absent:number|undefined=undefined; absent ??= bump(state); absent ??= bump(state);
      let zero:number|undefined=-0; zero ??= bump(state);
      let nan:number|undefined=0/0; nan ??= bump(state);
      let optionalText:string|undefined=undefined; optionalText ??= ""; optionalText ??= "wrong";
      let optionalFlag:boolean|undefined=undefined; optionalFlag ??= false; optionalFlag ??= true;
      return state.calls===3 && a===2 && b===0 && text==="done" && !flag && absent===3 && 1/zero===-1/0 && nan!==nan && optionalText==="" && !optionalFlag ? 42 : -1;
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 42,
});
setModules.set("source-literal-index", {
  ...compileSource(
    'interface Box {["quoted-key"]:number;[42]:number;maybe:number|undefined;["__proto__"]:number}\nfunction receiver(calls:{value:number},box:Box):Box{calls.value++;return box;}\nfunction key(calls:{value:number},box:Box):42{calls.value++;box[42]=50;return 42;}\nfunction read(box:Box,key:"quoted-key"):number{return box[key];}\nfunction run(n:number):number{\n const calls={value:0};const box:Box={["quoted-key"]:1,[0x2a]:2,maybe:undefined,["__proto__"]:9};\n if(box["quoted-key"]!==1||box[0x2a]!==2)return -1;\n const old=box[42]++;box[42]+=39;\n const first=box["maybe"]??=box[42];\n receiver(calls,box)[42]+=(calls.value+=10,1);\n if(old!==2||first!==42||box[42]!==43||calls.value!==11)return -2;\n const label="quoted-key";box[label]=0;box[label]||=7;\n const absent:Box|undefined=undefined;\n if(absent?.[42]!==undefined||box?.[42]!==43||box[`quoted-key`]!==7)return -3;\n if(box["__proto__"]!==9)return -4;\n box[key(calls,box)]+=1;\n if(box[42]!==51||calls.value!==12||read(box,label)!==7)return -5;\n if(absent?.[key(calls,box)]!==undefined||calls.value!==12)return -6;\n return 42;\n}',
  ),
  bytes: 96,
  regionBytes: 384,
  capacity: 4,
  expected: 42,
});
setModules.set("source-property-nullish", {
  ...compileSource(
    'interface Box {n:number|undefined;text:string|undefined;flag:boolean|undefined}\nfunction receiver(calls:{value:number},box:Box):Box{calls.value++;return box;}\nfunction bump(calls:{value:number}):number{calls.value++;return calls.value;}\nfunction run(n:number):number{\n const calls={value:0};const box:Box={n:undefined,text:undefined,flag:undefined};\n const first=receiver(calls,box).n??=bump(calls);\n const second=receiver(calls,box).n??=bump(calls);\n box.text??="";box.text??="wrong";box.flag??=false;box.flag??=true;\n if(first!==2||second!==2||calls.value!==3||box.text!==""||box.flag!==false)return -1;\n box.n=-0;const zero=box.n??=bump(calls);if(1/zero!==-1/0)return -2;\n box.n=0/0;const nan=box.n??=bump(calls);if(nan===nan||calls.value!==3)return -3;\n return 42;\n}',
  ),
  bytes: 96,
  regionBytes: 384,
  capacity: 4,
  expected: 42,
});
setModules.set("source-property-logical", {
  ...compileSource(
    'interface Box {n:number;text:string;flag:boolean}\nfunction receiver(calls:{value:number},box:Box):Box{calls.value++;return box;}\nfunction bump(calls:{value:number}):number{calls.value++;return calls.value;}\nfunction run(n:number):number{\n const calls={value:0};const box:Box={n:0,text:"",flag:false};\n receiver(calls,box).n&&=bump(calls);\n receiver(calls,box).n||=bump(calls);\n receiver(calls,box).n||=bump(calls);\n receiver(calls,box).n&&=bump(calls);\n box.text||="value";box.text&&="done";\n box.flag||=true;box.flag&&=false;\n return calls.value===6&&box.n===6&&box.text==="done"&&!box.flag?42:-1;\n}',
  ),
  bytes: 80,
  regionBytes: 320,
  capacity: 4,
  expected: 42,
});
setModules.set("source-property-updates", {
  ...compileSource(
    "function receiver(calls:{value:number},box:{value:number}):{value:number}{calls.value++;return box;}\nfunction rhs(calls:{value:number},box:{value:number}):number{calls.value++;box.value=100;return 2;}\nfunction run(n:number):number{\n const calls={value:0},box={value:1},other={value:99};\n const before=receiver(calls,box).value++;\n const after=++receiver(calls,box).value;\n const result=receiver(calls,box).value+=rhs(calls,box);\n if(before!==1||after!==3||result!==5||box.value!==5||calls.value!==4)return -1;\n const prior=box.value--;if(prior!==5||--box.value!==3)return -2;\n box.value*=4;box.value>>=1;box.value%=4;if(box.value!==2)return -3;\n let selected=box;selected.value+=(selected=other,2);\n if(box.value!==4||other.value!==99||selected!==other)return -4;\n return 42;\n}",
  ),
  bytes: 96,
  regionBytes: 384,
  capacity: 4,
  expected: 42,
});
setModules.set("source-string-suffix", {
  ...compileSource(
    'function string(state:{calls:number}):string {state.calls=state.calls*10+1;return "abc";}\nfunction search(state:{calls:number}):string {state.calls=state.calls*10+2;return "b";}\nfunction end(state:{calls:number}):number {state.calls=state.calls*10+3;return 2;}\nfunction run(n:number):number {\n const state:{calls:number}={calls:0};\n if(!string(state).endsWith(search(state),end(state)) || state.calls!==123)return -1;\n if(!"abc".endsWith("bc") || !"abc".endsWith("bc",undefined))return -2;\n if(!"abc".endsWith("b",2.9) || "abc".endsWith("a",0/0))return -3;\n if(!"abc".endsWith("",-1/0) || !"abc".endsWith("c",1/0))return -4;\n if("abc".endsWith("abcd") || "abc".endsWith("ab",1))return -5;\n if(!"abc".endsWith("",0/0) || !"abc".endsWith("",-0))return -6;\n if(!"\ud83d\ude00".endsWith("\\uDE00") || !"\ud83d\ude00".endsWith("\\uD83D",1))return -7;\n let position:number|undefined=undefined;\n if(!"abc".endsWith("bc",position))return -8;\n position=2;if(!"abc".endsWith("b",position))return -9;\n return 42;\n}',
  ),
  bytes: 32,
  capacity: 16,
  expected: 42,
});
setModules.set("source-static-template", {
  ...compileSource(
    'function run(n:number):number {\n  const state:{value:number}={value:n};\n  const t\\u0065xt=`first\r\nsecond`;\n  const escaped=`\\`\\${literal}\\u{1f600}`;\n  return state.value===n && text==="first\\nsecond" && escaped==="`${literal}\ud83d\ude00" ? 42 : -1;\n}',
  ),
  bytes: 32,
  capacity: 16,
  expected: 42,
});
setModules.set("source-captured-for-iterations", {
  ...compileAutomaticCollectionRuntime(`
    function run(n:number):number {
      let first:()=>number=()=>-1;
      let second:()=>number=()=>-1;
      for(let i=0;i<2;i++) {
        if(i===0)first=function(){return i;};
        else second=()=>i;
      }
      return first()===0 && second()===1 ? 42 : -1;
    }
  `),
  bytes: 384,
  capacity: 1,
  expected: 42,
});
setModules.set("source-optional-chain", {
  ...compileAutomaticCollectionRuntime(`
    interface Leaf {value:number}
    interface Box {child:Leaf}
    interface State {calls:number;value:Box|undefined}
    function get(state:State):Box|undefined {state.calls=state.calls+1;return state.value;}
    function run(n:number):number {
      const leaf:Leaf={value:42},box:Box={child:leaf};
      const present:State={calls:0,value:box},absent:State={calls:0,value:undefined};
      const first=get(present)?.child.value,second=get(absent)?.child.value;
      if(present.calls!==1||absent.calls!==1)return -1;
      return (first??0)+(second??0);
    }
  `),
  bytes: 128,
  capacity: 4,
  expected: 42,
});
setModules.set("source-optional-index", {
  ...compileAutomaticCollectionRuntime(`
    function index(state:{calls:number}):number {state.calls=state.calls+1;return 0;}
    function read(value:number[]|undefined,state:{calls:number}):number|undefined {return value?.[index(state)];}
    function run(n:number):number {
      const state:{calls:number}={calls:0},values:number[]=[42];
      const absent=read(undefined,state),present=read(values,state);
      if(absent!==undefined)return -1;return (present??0)+state.calls;
    }
  `),
  bytes: 176,
  capacity: 2,
  expected: 43,
});

setModules.set("source-optional-array-field", {
  ...compileAutomaticCollectionRuntime(`
    interface Box {values?:(number|string)[]}
    function run(n:number):number {
      const box:Box={values:[7]};
      const values=box.values;
      if(values===undefined)return -1;
      const value=values[0];
      if(typeof value!=="number")return -2;
      return value;
    }`),
  bytes: 176,
  capacity: 2,
  expected: 7,
});
setModules.set("source-optional-boolean-field", {
  ...compileSource(`
    interface Flag {enabled?:boolean}
    function read(flag:Flag):number {
      const enabled=flag.enabled;
      if(typeof enabled==="undefined")return 2;
      return enabled?1:0;
    }
    function run(n:number):number {
      const yes:Flag={enabled:true},no:Flag={enabled:false},absent:Flag={};
      return read(yes)+read(no)+read(absent);
    }`),
  bytes: 144,
  capacity: 3,
  expected: 3,
});
setModules.set("source-optional-primitive-field", {
  ...compileAutomaticCollectionRuntime(`
    interface Box {value?:number|string}
    function read(box:Box):number {
      const value=box.value;
      if(typeof value==="undefined")return 2;
      if(typeof value==="number")return value;
      return value.length;
    }
    function run(n:number):number {
      const a:Box={value:7},b:Box={value:"a"},c:Box={};
      const before=read(a)+read(b)+read(c);
      c.value=3;
      return before+read(c);
    }`),
  bytes: 288,
  capacity: 1,
  expected: 13,
});
setModules.set("source-never-return", {
  ...compileSource(`
    function stop():never{throw "STOP";}
    function read(flag:boolean):number{if(flag)return stop();return 7;}
    function choose(flag:boolean):number{return flag?7:stop();}
    function run(n:number):number{const box:{value:number}={value:read(false)+choose(true)};return box.value;}
  `),
  bytes: 32,
  capacity: 16,
  expected: 14,
});
setModules.set("source-optional-boolean-abi", {
  ...compileSource(`
    function same(a:boolean|undefined,b:boolean|undefined):boolean{return a===b;}
    function choose(value:boolean|undefined):boolean|undefined{return value;}
    function run(n:number):number {
      if(!same(undefined,undefined)||same(false,undefined)||same(true,false)||!same(true,true))return -1;
      if(choose(undefined)!==undefined||choose(false)!==false||choose(true)!==true)return -2;
      const box:{value:number}={value:7};return box.value;
    }`),
  bytes: 32,
  capacity: 16,
  expected: 7,
});
for (const own of ["absent", "undefined", "value"] as const) {
  for (const depth of [1, 2]) {
    for (const optimized of [false, true]) {
      const module = prototypeRecordFixture(own, depth);
      const emitted = emitDarwinModule(
        optimized ? optimizeModule(module).module : module,
      );
      assert.ok(emitted.ok, JSON.stringify(emitted));
      setModules.set(
        `prototype-record-${depth}-${own}-${optimized ? "optimized" : "direct"}`,
        {
          native: emitted.value,
          entry: 0,
          bytes: 48 + 64 * depth,
          capacity: Math.floor(512 / (48 + 64 * depth)),
          expected: 42,
        },
      );
    }
  }
}
for (const target of ["own", "prototype"] as const) {
  for (const optimized of [false, true]) {
    const module = prototypeMutationFixture(target);
    const emitted = emitDarwinModule(
      optimized ? optimizeModule(module).module : module,
    );
    assert.ok(emitted.ok, JSON.stringify(emitted));
    setModules.set(
      `prototype-mutation-${target}-${optimized ? "optimized" : "direct"}`,
      {
        native: emitted.value,
        entry: 0,
        bytes: 112,
        capacity: 4,
        expected: 42,
      },
    );
  }
}
for (const optimized of [false, true]) {
  const fixture = classRecordFixture();
  const emitted = emitDarwinModule(
    optimized ? optimizeModule(fixture.module).module : fixture.module,
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  setModules.set(
    `class-record-initialization-${optimized ? "optimized" : "direct"}`,
    {
      native: emitted.value,
      entry: 0,
      bytes: fixture.bytes,
      capacity: Math.floor(512 / fixture.bytes),
      expected: 42,
    },
  );
}
for (const present of [false, true]) {
  for (const optimized of [false, true]) {
    const module = functionEnvironmentFixture(present);
    const emitted = emitDarwinModule(
      optimized ? optimizeModule(module).module : module,
    );
    assert.ok(emitted.ok, JSON.stringify(emitted));
    const bytes = present ? 80 : 48;
    setModules.set(
      `function-environment-${present ? "captured" : "empty"}-${optimized ? "optimized" : "direct"}`,
      {
        native: emitted.value,
        entry: 0,
        bytes,
        capacity: Math.floor(512 / bytes),
        expected: 42,
      },
    );
  }
}
for (const write of [false, true]) {
  for (const optimized of [false, true]) {
    const fixture = classConstructorFixture(write);
    const emitted = emitDarwinModule(
      optimized ? optimizeModule(fixture.module).module : fixture.module,
    );
    assert.ok(emitted.ok, JSON.stringify(emitted));
    setModules.set(
      `class-constructor-${write ? "write" : "read"}-${optimized ? "optimized" : "direct"}`,
      {
        native: emitted.value,
        entry: 0,
        bytes: fixture.bytes,
        capacity: Math.floor(512 / fixture.bytes),
        expected: 42,
      },
    );
  }
}
for (const mode of [
  "order",
  "defaults",
  "throw-argument",
  "throw-constructor",
] as const) {
  for (const optimized of [false, true]) {
    const fixture = classNewFixture(mode);
    const emitted = emitDarwinModule(
      optimized ? optimizeModule(fixture.module).module : fixture.module,
    );
    assert.ok(emitted.ok, JSON.stringify(emitted));
    setModules.set(`class-new-${mode}-${optimized ? "optimized" : "direct"}`, {
      native: emitted.value,
      entry: 0,
      bytes: fixture.bytes,
      capacity: Math.floor(512 / fixture.bytes),
      expected: 42,
    });
  }
}
for (const mode of ["normal", "throw-field", "throw-body"] as const) {
  for (const optimized of [false, true]) {
    const fixture = classConstructionBodyFixture(mode);
    const emitted = emitDarwinModule(
      optimized ? optimizeModule(fixture.module).module : fixture.module,
    );
    assert.ok(emitted.ok, JSON.stringify(emitted));
    setModules.set(
      `class-construction-body-${mode}-${optimized ? "optimized" : "direct"}`,
      {
        native: emitted.value,
        entry: 0,
        bytes: fixture.bytes,
        capacity: Math.floor(512 / fixture.bytes),
        expected: 42,
      },
    );
  }
}
for (const mode of ["normal", "throw-field"] as const) {
  for (const optimized of [false, true]) {
    const fixture = classConstructionBodyFixture(mode, true);
    const emitted = emitDarwinModule(
      optimized ? optimizeModule(fixture.module).module : fixture.module,
    );
    assert.ok(emitted.ok, JSON.stringify(emitted));
    setModules.set(
      `class-static-initialization-${mode}-${optimized ? "optimized" : "direct"}`,
      {
        native: emitted.value,
        entry: 0,
        bytes: fixture.bytes,
        capacity: Math.floor(512 / fixture.bytes),
        expected: 42,
      },
    );
  }
}
for (const throws of [false, true]) {
  for (const optimized of [false, true]) {
    const fixture = classDefinitionFixture(throws);
    const emitted = emitDarwinModule(
      optimized ? optimizeModule(fixture.module).module : fixture.module,
    );
    assert.ok(emitted.ok, JSON.stringify(emitted));
    setModules.set(
      `class-definition-${throws ? "throw" : "normal"}-${optimized ? "optimized" : "direct"}`,
      {
        native: emitted.value,
        entry: 0,
        bytes: fixture.bytes,
        regionBytes: 1024,
        capacity: 1,
        expected: 42,
      },
    );
  }
}
const recordPresenceNative = emitDarwinModule({
  records: [
    {
      byteLength: 48,
      fields: [
        {
          offset: 24,
          presenceOffset: 16,
          type: "optional-number",
          mutable: true,
        },
      ],
    },
    { byteLength: 16, fields: [] },
  ],
  functions: [
    {
      id: 0,
      name: "run",
      exported: true,
      parameters: [0],
      slots: ["number"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "undefined", id: 0, ...s },
            { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
            {
              kind: "record-new",
              id: 2,
              record: 0,
              arguments: [undefined],
              ...s,
            },
            { kind: "record-new", id: 3, record: 1, arguments: [], ...s },
            { kind: "record-has", id: 4, object: 1, record: 0, field: 0, ...s },
            { kind: "record-has", id: 5, object: 2, record: 0, field: 0, ...s },
            { kind: "record-has", id: 6, object: 3, record: 0, field: 0, ...s },
            {
              kind: "unary",
              id: 7,
              operator: "boolean-number",
              operand: 4,
              ...s,
            },
            {
              kind: "unary",
              id: 8,
              operator: "boolean-number",
              operand: 5,
              ...s,
            },
            {
              kind: "unary",
              id: 9,
              operator: "boolean-number",
              operand: 6,
              ...s,
            },
            { kind: "binary", id: 10, operator: "-", left: 7, right: 8, ...s },
            { kind: "binary", id: 11, operator: "-", left: 10, right: 9, ...s },
          ],
          terminator: { kind: "return", value: 11, ...s },
        },
      ],
    },
  ],
});
assert.ok(recordPresenceNative.ok, JSON.stringify(recordPresenceNative));
setModules.set("record-property-presence", {
  native: recordPresenceNative.value,
  entry: 0,
  bytes: 112,
  capacity: 4,
  expected: 1,
});
setModules.set("source-object-spread-optional-discriminant", {
  ...compileSource(`type Item={readonly kind?:"a";readonly a:number}|{readonly kind:"b";readonly b:number};
 function copy(item:Item):Item{return {...item};}
 function run(n:number):number{const x=copy({a:10}),y=copy({kind:"a",a:12}),z=copy({kind:"b",b:20});
 if(x.kind==="b"||y.kind==="b"||z.kind!=="b")return -1;if(x.kind!==undefined||y.kind!=="a")return -2;return x.a+y.a+z.b;}`),
  bytes: 256,
  regionBytes: 256,
  capacity: 1,
  expected: 42,
});
setModules.set("source-object-spread-general-snapshot", {
  ...compileSource(`type Item={readonly kind:"n";readonly value:number}|{readonly kind:"o";readonly value:{amount:number}}|{readonly kind:"none"};
 function copy(item:Item):Item{return {...item};}
 function run(n:number):number{const a=copy({kind:"n",value:20}),b=copy({kind:"o",value:{amount:22}}),c=copy({kind:"none"});
 if(a.kind!=="n"||b.kind!=="o"||c.kind!=="none")return -1;return a.value+b.value.amount;}`),
  bytes: 224,
  regionBytes: 224,
  capacity: 1,
  expected: 42,
});
setModules.set("source-object-spread-union-variants", {
  ...compileSource(`type Item={readonly kind:"a";readonly value:number;readonly label:string}|{readonly kind:"b";readonly value:number};
    function copy(item:Item):Item{return {...item,value:item.value+1};}
    function run(n:number):number{const a=copy({kind:"a",value:20,label:"x"}),b=copy({kind:"b",value:20});
      if(a.kind!=="a"||b.kind!=="b"||a.label!=="x")return -1;return a.value+b.value;}`),
  bytes: 160,
  regionBytes: 160,
  capacity: 1,
  expected: 42,
});
setModules.set("source-object-spread-union-layout", {
  ...compileSource(`type Item={readonly kind:"a";readonly value:number}|{readonly kind:"b";readonly value:number};
    function copy(item:Item):Item{return {...item};}
    function run(n:number):number{const a:Item={kind:"b",value:42};const b=copy(a);return b.kind==="b"?b.value:-1;}`),
  bytes: 64,
  capacity: 8,
  expected: 42,
});
setModules.set("source-object-spread-overwritten-shape", {
  ...compileSource(`interface Span {start:number;end:number}
    interface Text extends Span {type:string}
    interface Numeric extends Span {type:{value:number}}
    function copy(span:Span):Text{return {...span,type:"text"};}
    function run(n:number):number{const input:Numeric={start:20,end:22,type:{value:3}};
      const output=copy(input);return output.type==="text"?output.start+output.end:-1;}`),
  bytes: 128,
  regionBytes: 128,
  capacity: 1,
  expected: 42,
});
setModules.set("source-object-spread-snapshot", {
  ...compileAutomaticCollectionRuntime(`
    function overwrite(source:{value:number}):number{source.value=9;return 1;}
    function run(n:number):number {
      const original={value:2};const copy={...original,other:overwrite(original)};
      return copy.value+copy.other+original.value;
    }`),
  bytes: 64,
  capacity: 8,
  expected: 12,
});
setModules.set("source-object-spread-presence", {
  ...compileAutomaticCollectionRuntime(`
    interface Source {value?:number|undefined}
    function run(n:number):number {
      const missing:Source={},present:Source={value:undefined};
      const a={...missing},b={...present};
      const first={value:7,...a},second={value:7,...b};
      if(first.value!==7||second.value!==undefined)return -1;
      return 1;
    }`),
  bytes: 256,
  capacity: 2,
  expected: 1,
});
function compileCheckedListRuntime() {
  const linked = linkModules(
    [
      moduleSource("list", sparseListSource, []),
      moduleSource("main", 'import "list";', [["list", "list"]]),
    ],
    "main",
    ["undefined", "Number"],
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const names = ["createList", "writeList", "readList"].map((name) => {
    const entry = linked.value.exports.find(
      (e) => e.module === "list" && e.name === name && e.namespace === "value",
    );
    assert.ok(entry, name);
    return entry.linkedName;
  });
  const specialized = specializeCheckedRoots(
    linked.value.module,
    [
      { kind: "number" },
      {
        kind: "object",
        properties: [{ name: "value", type: 0, readonly: false }],
      },
    ],
    names.map((name) => ({ name, arguments: [1] })),
    ["undefined", "Number"],
  );
  assert.ok(specialized.ok, JSON.stringify(specialized));
  const [create, write, read] = specialized.value.roots;
  assert.ok(create && write && read);
  const wrapper = moduleSource(
    "wrapper",
    `function run(n:number):number {
    const list=${create}(0);
    const item:{value:number}={value:42};
    ${write}(list,3,item);
    const found=${read}(list,3);
    if(found===undefined)return -1;
    found.value=found.value+1;
    return item.value;
  }`,
    [],
  ).module;
  return compileModule(
    {
      ...specialized.value.module,
      statements: [
        ...specialized.value.module.statements,
        ...wrapper.statements,
      ],
    },
    undefined,
    false,
    new Map(),
    [],
    [],
    false,
    "run",
  );
}
setModules.set("source-checked-runtime-specialization", {
  ...compileCheckedListRuntime(),
  bytes: 128,
  capacity: 4,
  expected: 43,
});
setModules.set("source-nested-generic", {
  ...compileSource(`function outer(start:number):number{
    let total=start;
    function add<T>(value:T,n:number):T{total+=n;return value;}
    const a=add<number>(2,3);const b=add<string>("x",4);
    return a+total+b.length;
  }function run(n:number):number{return outer(10)+outer(20);}`),
  bytes: 384,
  capacity: 1,
  expected: 50,
});
setModules.set("source-optional-write-context", {
  ...compileSource(`
    interface R{value?:string;other:string|undefined}
    function make(flag:boolean):R{return {value:flag?"a":"b",other:undefined};}
    function run(n:number):number{const a=make(true),b=make(false);return a.value==="a"&&b.value==="b"&&a.other===undefined&&b.other===undefined?1:-1;}
  `),
  bytes: 96,
  capacity: 5,
  expected: 1,
});
setModules.set("source-optional-discriminant", {
  ...compileSource(`
    type P={readonly kind?:"property";name:string}|{readonly kind:"spread";value:number};
    function effect():number{return 0;}
    function read(p:P):number{if(p.kind==="spread")return p.value;effect();return p.name.length;}
    function run(n:number):number{const a:P={name:"ab"},b:P={kind:"property",name:"abc"},c:P={kind:"spread",value:4};return read(a)+read(b)+read(c);}
  `),
  bytes: 128,
  capacity: 4,
  expected: 9,
});
setModules.set("source-typeof-narrowing", {
  ...compileSource(`
    function accept(value:number):number{return value+1;}
    function read(value:number|undefined):number{if(typeof value==="number")return accept(value);return 0;}
    function inverse(value:number|undefined):number{if(typeof value!=="undefined")return accept(value);return 0;}
    function run(n:number):number{const result:{value:number}={value:read(2)+read(undefined)+inverse(3)+inverse(undefined)};return result.value;}
  `),
  bytes: 32,
  capacity: 16,
  expected: 7,
});
setModules.set("source-literal-union-narrowing", {
  ...compileSource(`
    type Value="number"|"boolean";
    function accept(value:Value):number{return value==="number"?2:3;}
    function read(input:Value|"void"):number{const value=input;if(value==="void")return 0;return accept(value);}
    function one(value:1):number{return value;}
    function numeric(value:1|2):number{if(1===value)return one(value);return 0;}
    function run(n:number):number{const result:{value:number}={value:read("number")+read("boolean")+read("void")+numeric(1)+numeric(2)};return result.value;}
  `),
  bytes: 32,
  capacity: 16,
  expected: 6,
});
setModules.set("source-switch-joined-tags", {
  ...compileSource(`
    type Op={readonly kind:"read"|"valid";array:number}|{readonly kind:"write";array:number;value:number}|{readonly kind:"other";label:string};
    function read(op:Op):number{switch(op.kind){case "read":case "valid":case "write":const extra=op.kind==="write"?0:0;if(op.kind==="write"&&op.value>0){op.value;}else{op.array;}return op.array+extra;default:return 0;}}
    function run(n:number):number{
      const a:Op={kind:"read",array:2},b:Op={kind:"valid",array:3},c:Op={kind:"write",array:4,value:8},d:Op={kind:"other",label:"x"};
      return read(a)+read(b)+read(c)+read(d);
    }
  `),
  bytes: 144,
  capacity: 3,
  expected: 9,
});
setModules.set("source-number-is-safe-integer", {
  ...compileSource(`
    function safe(value:number|undefined):boolean{return Number.isSafeInteger(value);}
    function text(c:{value:number}):string{c.value=c.value+1;return "2";}
    function run(n:number):number{
      const c:{value:number}={value:0};
      if(!safe(0)||!safe(-0)||!safe(9007199254740991)||!safe(-9007199254740991))return -1;
      if(safe(9007199254740992)||safe(-9007199254740992)||safe(0.5)||safe(5e-324))return -2;
      if(safe(1/0)||safe(-1/0)||safe(0/0)||safe(undefined))return -3;
      if(Number.isSafeInteger(text(c))||Number.isSafeInteger(true)||Number.isSafeInteger(c)||c.value!==1)return -4;
      return 1;
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 1,
});
setModules.set("source-number-is-finite", {
  ...compileSource(`
    function finite(value:number|undefined):boolean{return Number.isFinite(value);}
    function text(c:{value:number}):string{c.value=c.value+1;return "2";}
    function run(n:number):number{
      const c:{value:number}={value:0};
      if(!finite(0)||!finite(-0)||!finite(0.5)||!finite(5e-324)||!finite(1.7976931348623157e308))return -1;
      if(finite(1/0)||finite(-1/0)||finite(0/0)||finite(undefined))return -2;
      if(Number.isFinite(text(c))||Number.isFinite(true)||Number.isFinite(c)||c.value!==1)return -3;
      return 1;
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 1,
});
setModules.set("source-filtered-intersection", {
  ...compileSource(`
    type Node={readonly kind:"value";value:number}|{readonly kind:"other";text:string};
    type Value=Node & {readonly kind:"value"};
    function read(node:Value):number{return node.value;}
    function run(n:number):number{const node:Value={kind:"value",value:7};return read(node);}
  `),
  bytes: 32,
  capacity: 16,
  expected: 7,
});
setModules.set("source-effectful-tag-guard", {
  ...compileSource(`type Item={readonly kind:"a";value:number}|{readonly kind:"b";label:string};
 interface Counter{calls:number}
 function effect(c:Counter):boolean{c.calls=c.calls+1;return c.calls<2;}
 function read(input:Item,c:Counter):number{const item=input;if(item.kind==="a"&&effect(c))return item.value;return 0;}
 function inverse(input:Item,c:Counter):number{const item=input;if(item.kind!=="a"||!effect(c))return 0;return item.value;}
 function run(n:number):number{const a:Item={kind:"a",value:3},b:Item={kind:"b",label:"b"},c:Counter={calls:0};const sum=read(a,c)+read(b,c)+inverse(a,c);return sum===3&&c.calls===2?1:-1;}
 `),
  bytes: 96,
  capacity: 5,
  expected: 1,
});
setModules.set("source-correlated-tags", {
  ...compileSource(`
    type T={readonly kind:"a"|"b";value:number}|{readonly kind:"c";other:number};
    function same(a:T,b:T):number{if((a.kind==="a"||a.kind==="b")&&b.kind===a.kind)return b.value;return 0;}
    function different(a:T,b:T):number{if(a.kind==="c"&&b.kind!==a.kind)return b.value;return 0;}
    function run(n:number):number{
      const a:T={kind:"a",value:3},b:T={kind:"b",value:4},c:T={kind:"c",other:5};
      return same(a,a)+same(a,b)+same(b,b)+different(c,a);
    }`),
  bytes: 96,
  capacity: 5,
  expected: 10,
});
setModules.set("source-multi-tag-exclusion", {
  ...compileSource(`
    type T={readonly kind:"a"|"b";value:number}|{readonly kind:"c";other:number};
    function read(x:T):number{let value:number;switch(x.kind){case "a":value=x.value;break;case "b":value=x.value;break;default:value=x.other;break;}return value;}
    function presence(value:number|undefined):number{const x=value;if(x===undefined)return 0;switch(x){case 3:break;default:break;}while(false){break;}return x;}
    function run(n:number):number{const a:T={kind:"a",value:3};const b:T={kind:"b",value:4};const c:T={kind:"c",other:5};return presence(read(a))+read(b)+read(c);}
  `),
  bytes: 96,
  capacity: 5,
  expected: 12,
});
setModules.set("source-multi-tag-guard", {
  ...compileSource(`type Node={readonly kind:"a";value:number}|{readonly kind:"b";value:number}|{readonly kind:"c"|"d";other:number};
 function read(node:Node):number{while(node.kind==="a"||node.kind==="b"){return node.value;}return 0;}
 function run(n:number):number{const first:Node={kind:"a",value:4};const second:Node={kind:"b",value:3};return read(first)+read(second);}`),
  bytes: 64,
  capacity: 8,
  expected: 7,
});
setModules.set("source-readonly-field-guard", {
  ...compileSource(`
    function operator(value:"++"|"--"):number{return value==="++"?4:3;}
    function read(token:{readonly value:string}):number{
      if(token.value==="++"||token.value==="--")return operator(token.value);
      return 0;
    }
    function run(n:number):number{
      const a:{readonly value:string}={value:"++"};
      const b:{readonly value:string}={value:"--"};
      return read(a)+read(b);
    }
  `),
  bytes: 64,
  capacity: 8,
  expected: 7,
});
setModules.set("source-boolean-default", {
  ...compileSource(`
    interface Counter {value:number}
    function fallback(c:Counter):boolean{c.value=c.value+1;return true;}
    function flag(c:Counter,value:boolean=fallback(c)):boolean{return value;}
    function run(n:number):number {
      const c:Counter={value:0};
      if(flag(c,false)||!flag(c,true)||c.value!==0)return -1;
      if(!flag(c)||!flag(c,undefined)||c.value!==2)return -2;
      if(flag(c,false)||c.value!==2)return -3;
      return 1;
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 1,
});
setModules.set("source-object-default", {
  ...compileSource(`
    interface Box {value:number}
    function fallback(c:Box):Box{c.value=c.value+1;return {value:c.value};}
    function read(c:Box,value:Box=fallback(c)):Box{return value;}
    function run(n:number):number {
      const c:Box={value:0};const supplied:Box={value:99};
      if(read(c,supplied)!==supplied||c.value!==0)return -1;
      const a=read(c);const b=read(c,undefined);
      if(a===b||a.value!==1||b.value!==2||c.value!==2)return -2;
      if(read(c,supplied)!==supplied||c.value!==2)return -3;
      return 1;
    }
  `),
  bytes: 128,
  capacity: 4,
  expected: 1,
});
setModules.set("source-string-default", {
  ...compileSource(`
    interface Calls {count:number}
    function fallback(c:Calls):string{c.count=c.count+1;return String.fromCharCode(65);}
    function read(c:Calls,value:string=fallback(c)):string{return value;}
    function run(n:number):number {
      const c:Calls={count:0};
      if(read(c)!=="A"||read(c,undefined)!=="A"||read(c,"")!==""||read(c,"x")!=="x"||c.count!==2)return -1;
      const callback:(value?:string)=>string=(value="B")=>value;
      if(callback()!=="B"||callback(undefined)!=="B"||callback("")!=="")return -2;
      return 1;
    }
  `),
  // Counter, two dynamically built defaults, and a capture-free callback.
  bytes: 144,
  capacity: 3,
  expected: 1,
});
setModules.set("source-contextual-default", {
  ...compileSource(`
    function consume(value:number):number{return value;}
    function run(n:number):number {
      const read:(ahead?:number)=>number=(ahead=7)=>consume(ahead);
      return read()+read(100)+read(undefined);
    }
  `),
  bytes: 48,
  capacity: 10,
  expected: 114,
});
setModules.set("source-captures-default", {
  ...compileSource(`
    function factory(x:number=7):()=>number {return ():number=>++x;}
    function run(n:number):number {const a=factory();const b=factory(100);return a()+b()+a();}
  `),
  bytes: 224,
  capacity: 2,
  expected: 118,
});
setModules.set("source-captures-string", {
  ...compileSource(`
    function factory(x:string):(next:string)=>string {
      return (next:string):string=>{const old=x;x=next;return old;};
    }
    function run(n:number):number {const f=factory("before");if(f("after")!=="before"||f("final")!=="after")return -1;return 1;}
  `),
  bytes: 112,
  capacity: 4,
  expected: 1,
});
setModules.set("source-captures-recursive", {
  ...compileSource(`
    function run(n:number):number {
      const f:(x:number)=>number=(x:number):number=>{if(x<=1)return 1;return x*f(x-1);};
      return f(5);
    }
  `),
  bytes: 112,
  capacity: 4,
  expected: 120,
});
setModules.set("source-captures-optional", {
  ...compileSource(`
    function factory(x:number|undefined):()=>number {
      return ():number=>{if(x===undefined)x=7;return x;};
    }
    function run(n:number):number {const f=factory(undefined);return f()+f();}
  `),
  bytes: 128,
  capacity: 4,
  expected: 14,
});
setModules.set("source-captures-switch", {
  ...compileSource(`
    function factory(n:number):()=>number {
      switch(n){case 0:let x:number=7;return ():number=>++x;default:return ():number=>0;}
    }
    function run(n:number):number {const f=factory(0);return f()+f();}
  `),
  bytes: 112,
  capacity: 4,
  expected: 17,
});
setModules.set("source-named-counter", {
  ...compileSource(`
    function factory(x:number):(delta:number)=>number {
      x=advance(1);return advance;
      function advance(delta:number):number{x+=delta;return x;}
    }
    function run(n:number):number {const a=factory(7);const b=factory(100);return a(3)+a(2)+b(5)+a(0);}
  `),
  bytes: 224,
  capacity: 2,
  expected: 143,
});
setModules.set("source-named-identity", {
  ...compileSource(`
    type Counter=()=>number;
    interface Pair {a:Counter;b:Counter}
    function factory():Pair {
      const before=next;let x:number=7;
      function next():number{return ++x;}
      return {a:before,b:next};
    }
    function run(n:number):number {const a=factory();const b=factory();if(a.a!==a.b||a.a===b.a)return -1;return a.a()+a.b()+b.a();}
  `),
  bytes: 288,
  capacity: 1,
  expected: 25,
});
setModules.set("source-named-recursive", {
  ...compileSource(`
    function run(n:number):number {
      return factorial(5);
      function factorial(x:number):number {if(x<=1)return 1;return x*factorial(x-1);}
    }
  `),
  bytes: 112,
  capacity: 4,
  expected: 120,
});
setModules.set("source-named-mutual", {
  ...compileSource(`
    type Predicate=(n:number)=>boolean;
    interface Pair {even:Predicate;odd:Predicate}
    function factory():Pair {
      function even(n:number):boolean {if(n===0)return true;return odd(n-1);}
      function odd(n:number):boolean {if(n===0)return false;return even(n-1);}
      return {even:even,odd:odd};
    }
    function run(n:number):number {const p=factory();if(!p.even(10)||p.odd(10)||p.even(9)||!p.odd(9))return -1;return 1;}
  `),
  bytes: 256,
  capacity: 2,
  expected: 1,
});
setModules.set("source-named-block", {
  ...compileSource(`
    type Counter=()=>number;
    interface Pair {first:Counter;last:Counter}
    function factory():Pair {
      let first:Counter=():number=>0;let last:Counter=first;let i=0;
      while(i<2){let x:number=7+i;function next():number{return ++x;}if(i===0)first=next;last=next;i++;}
      return {first:first,last:last};
    }
    function run(n:number):number {const p=factory();return p.first()+p.last()+p.first();}
  `),
  bytes: 304,
  capacity: 1,
  expected: 26,
});
setModules.set("source-named-block-pure", {
  ...compileSource(`
    function run(n:number):number {if(n>=0){return f();function f():number{return 7;}}return -1;}
  `),
  bytes: 48,
  capacity: 10,
  expected: 7,
});
setModules.set("source-named-reassignment", {
  ...compileSource(`
    function run(n:number):number {
      function f():number{return 1;}
      function g():number{return f();}
      const old=f;f=():number=>9;
      return old()+g();
    }
  `),
  bytes: 208,
  capacity: 2,
  expected: 10,
});
setModules.set("source-comma", {
  ...compileSource(`
    type State={value:number};
    function skip():void{return;}
    function run(n:number):number {
      const state:State={value:0};
      const value=(skip(),state.value=1,"discard",state.value=3,state.value);
      (state.value=5,skip());
      if((state.value=4,state.value===4))return value+state.value;
      return 0;
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 7,
});
setModules.set("source-loop-do-while", {
  ...compileSource(`
    type State={value:number};
    function always():number{do{return 7;}while(false);}
    function run(n:number):number {
      const state:State={value:0};let tests=0;let once=0;
      do{once++;}while(false);
      do{
        state.value=state.value+1;
        if(state.value<3)continue;
        if(state.value===4)break;
      }while((tests=tests+1)<9);
      return state.value*10+tests+once+always();
    }
  `),
  bytes: 32,
  capacity: 16,
  expected: 51,
});
setModules.set("source-loop-classic", {
  ...compileSource(`
    type Read=()=>number;
    function run(n:number):number {
      let first:Read=():number=>-1;let last:Read=first;
      for(let i=0;i<2;i++){const read=():number=>i;if(i===0){first=read;continue;}last=read;}
      return first()*10+last();
    }
  `),
  bytes: 336,
  capacity: 1,
  expected: 1,
});
setModules.set("source-loop-initializer", {
  ...compileSource(`
    type Read=()=>number;
    function run(n:number):number {
      let saved:Read=():number=>-1;
      for(let i=0,initial=():number=>i;i<2;i++){i=1;saved=initial;}
      return saved();
    }
  `),
  bytes: 224,
  capacity: 2,
  expected: 0,
});
setModules.set("source-loop-for-of", {
  ...compileSource(`
    type Read=()=>number;
    function run(n:number):number {
      let first:Read=():number=>-1;let last:Read=first;
      const a=new Uint8Array(2);a[0]=7;a[1]=9;let i=0;
      for(const x of a){function read():number{return x;}if(i===0)first=read;last=read;i++;}
      return first()*10+last();
    }
  `),
  bytes: 352,
  capacity: 1,
  expected: 79,
});
function compileInstance(
  text: string,
  exports: readonly string[],
  run: (initializer: string) => string,
) {
  const encoded = new TextEncoder().encode(text);
  const source = createSourceText(encoded, encoded.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  return compileInstanceModule(
    parsed.value,
    exports.map((name) => ({ name, local: name })),
    run,
  );
}
function compileInstanceModule(
  module: Module,
  exports: readonly ModuleInstanceExport[],
  run: (initializer: string) => string,
  globals: readonly string[] = ["undefined"],
  objectListTypes: readonly string[] = [],
) {
  const bound = bindModule(module, globals);
  assert.ok(bound.ok, JSON.stringify(bound));
  const instance = prepareModuleInstance(module, bound.value, exports);
  assert.ok(instance.ok, JSON.stringify(instance));
  let instanceModule = instance.value.module;
  if (objectListTypes.length > 0) {
    // This primitive harness installs explicitly requested reference-list
    // contracts using the same sparse-list implementation as hosted builds.
    const bytes = new TextEncoder().encode(
      readFileSync(
        "packages/foundation/src/collections/sparse-list.ts",
        "utf8",
      ),
    );
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const runtime = parseModule(source.value);
    assert.ok(runtime.ok);
    instanceModule = {
      ...instanceModule,
      statements: [...runtime.value.statements, ...instanceModule.statements],
    };
  }

  const runText = " ".repeat(module.end) + run(instance.value.initializer.name);
  const runBytes = new TextEncoder().encode(runText);
  const runSource = createSourceText(runBytes, runBytes.length);
  assert.ok(runSource.ok);
  const runner = parseModule(runSource.value);
  assert.ok(runner.ok);
  const combined: Module = {
    ...instanceModule,
    statements: [...instanceModule.statements, ...runner.value.statements],
    end: runner.value.end,
  };
  return compileModule(
    combined,
    undefined,
    false,
    new Map(),
    [],
    [],
    false,
    undefined,
    objectListTypes,
  );
}
function compileLinkedInstance(
  texts: readonly [string, string][],
  entry = "main",
  objectListExports: readonly {
    readonly module: string;
    readonly name: string;
  }[] = [],
) {
  const sources = texts.map(([id, text]) => {
    const bytes = new TextEncoder().encode(text);
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseModule(source.value);
    assert.ok(parsed.ok);
    return {
      id,
      module: parsed.value,
      dependencies: new Map(
        parsed.value.imports.map((i) => [i.specifier, i.specifier]),
      ),
    };
  });
  const globals = [
    "undefined",
    "Number",
    "Math",
    "NaN",
    "Infinity",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ];
  const linked = linkModules(sources, entry, globals, {
    evaluation: "instance",
  });
  assert.ok(linked.ok, JSON.stringify(linked));
  const exported = linked.value.exports.find(
    (e) => e.module === entry && e.name === "run" && e.namespace === "value",
  );
  assert.ok(exported);
  const objectListTypes = objectListExports.map((requested) => {
    const found = linked.value.exports.find(
      (item) =>
        item.module === requested.module &&
        item.name === requested.name &&
        item.namespace === "type",
    );
    assert.ok(
      found,
      "missing reference-array contract: " +
        requested.module +
        ":" +
        requested.name,
    );
    return found.linkedName;
  });
  return compileInstanceModule(
    linked.value.module,
    [{ name: "run", local: exported.linkedName }],
    (initializer) =>
      `function run(n:number):number {const instance=${initializer}();return instance.run();}`,
    globals,
    objectListTypes,
  );
}
setModules.set("source-module-graph", {
  ...compileLinkedInstance([
    [
      "main",
      'import {next} from "dep";import type {Unused} from "types";const initial=next();export function run():number{return initial*10+next();}',
    ],
    ["dep", "let count=3;export function next():number{return ++count;}"],
    [
      "types",
      'export interface Unused {x:number}const unreachable=fail();function fail():number{throw "type-only module evaluated";}',
    ],
  ]),
  bytes: 288,
  capacity: 1,
  expected: 45,
});
setModules.set("source-module-graph-cycle", {
  ...compileLinkedInstance([
    [
      "main",
      'import {value} from "dep";export function base():number{return 7;}export function run():number{return value;}',
    ],
    ["dep", 'import {base} from "main";export const value=base();'],
  ]),
  bytes: 144,
  capacity: 3,
  expected: 7,
});
setModules.set("source-module-graph-diamond", {
  ...compileLinkedInstance([
    [
      "main",
      'import "left";import "right";import {read} from "shared";export function run():number{return read();}',
    ],
    ["left", 'import {mark} from "shared";mark(1);'],
    ["right", 'import {mark} from "shared";mark(2);'],
    [
      "shared",
      "let state=0;export function mark(n:number):void{state=state*10+n;}export function read():number{return state;}",
    ],
  ]),
  bytes: 336,
  capacity: 1,
  expected: 12,
});
setModules.set("source-module-graph-inline-type", {
  ...compileLinkedInstance([
    [
      "main",
      'import {type T} from "dep";import {read} from "shared";export function run():number{return read();}',
    ],
    [
      "dep",
      'import {mark} from "shared";export interface T {value:number}mark(7);',
    ],
    [
      "shared",
      "let state=0;export function mark(n:number):void{state=n;}export function read():number{return state;}",
    ],
  ]),
  bytes: 336,
  capacity: 1,
  expected: 7,
});
setModules.set("source-module-instance", {
  ...compileInstance(
    "let count=seed();function seed():number{return 7;}export function next():number{return ++count;}export function read():number{return count;}",
    ["next", "read"],
    (initializer) => `function run(n:number):number {
    const a=${initializer}();const b=${initializer}();
    if(a.next!==a.next||a.next===b.next)return -1;
    return a.next()+a.read()+b.read()+b.next()+a.read();
  }`,
  ),
  bytes: 448,
  capacity: 1,
  expected: 39,
});
setModules.set("source-module-instance-effects", {
  ...compileInstance(
    `
    interface Box {value:number}
    let state:Box={value:seed()};
    const selected=next;
    function seed():number{return 5;}
    state.value=state.value+2;
    export function next(delta:number=1):number{state.value=state.value+delta;return state.value;}
    export function read():number{return selected(0);}
  `,
    ["next", "read"],
    (initializer) => `function run(n:number):number {
    const a=${initializer}();return a.next()+a.read()+a.next(3)+a.read();
  }`,
  ),
  bytes: 288,
  capacity: 1,
  expected: 38,
});
setModules.set("source-module-instance-throw", {
  ...compileInstance(
    `
    let count=seed();
    function seed():number{throw "module failure";}
    export function next():number{return ++count;}
  `,
    ["next"],
    (initializer) =>
      `function run(n:number):number {const a=${initializer}();return a.next();}`,
  ),
  bytes: 112,
  capacity: 4,
  expected: 0,
  thrown: "module failure",
});
for (const [name, call] of [
  ["member", "object.add(23)"],
  ["grouped", "(object.add)(23)"],
  ["computed", 'object["add"](23)'],
  ["optional", "object.add?.(23) ?? 0"],
] as const) {
  setModules.set("source-receiver-" + name, {
    ...compileSource(`
      function run(n: number): number {
        const object = { value: 19, add: function(this: { value: number }, n: number): number { return this.value + n; } };
        return ${call};
      }
    `),
    bytes: 80,
    capacity: 6,
    expected: 42,
  });
}
for (const fixture of receiverSourceFixtures) {
  setModules.set("source-receiver-" + fixture.name, {
    ...compileSource(fixture.source),
    bytes: fixture.bytes,
    capacity: Math.floor(512 / fixture.bytes),
    expected: 42,
  });
}
for (const [name, input, bytes] of [
  ["number", '{kind:"number",value:42}', 96],
  ["number-undefined", '{kind:"number",value:undefined}', 96],
  ["object", '{kind:"object",value:{x:42}}', 96],
  ["object-undefined", '{kind:"object",value:undefined}', 64],
] as const) {
  setModules.set("source-general-optional-spread-" + name, {
    ...compileSource(`
      type Item={readonly kind:"number";value:number|undefined}|{readonly kind:"object";value:{x:number}|undefined};
      function read(item:Item):number {
        const copy:Item={...item};
        if(copy.kind==="number")return copy.value??42;
        return copy.value?.x??42;
      }
      function run(n:number):number { const item:Item=${input}; return read(item); }
    `),
    bytes,
    capacity: Math.floor(512 / bytes),
    expected: 42,
  });
}
for (const fixture of functionCallFixtures) {
  setModules.set("source-function-call-" + fixture.name, {
    ...compileSource(fixture.source),
    bytes: fixture.bytes,
    capacity: Math.floor(512 / fixture.bytes),
    expected: 42,
  });
}
setModules.set("source-functions", {
  ...compileSource(`
    function apply(f:(x:number)=>number,x:number):number{return f(x);}
    function factory():(x:number)=>number{return (x:number):number=>x+1;}
    function run(n:number):number{
      const f=factory();const other=factory();
      if(f===other||f!==f)return -1;
      if(typeof f!=="function")return -2;
      if(apply(f,41)!==42||other(6)!==7)return -3;
      return 1;
    }
  `),
  bytes: 96,
  capacity: 5,
  expected: 1,
});
setModules.set("source-functions-order", {
  ...compileSource(`
    function factory():(x:number)=>number{return (x:number):number=>x+1;}
    function run(n:number):number{
      let f=(x:number):number=>x+10;
      const other=(x:number):number=>{return x+100;};
      if(f((f=other)===other?3:4)!==13)return -1;
      if(f(3)!==103)return -2;
      if(typeof factory()!=="function")return -3;
      return 1;
    }
  `),
  bytes: 144,
  capacity: 3,
  expected: 1,
});
setModules.set("source-functions-throw", {
  ...compileSource(`
    function apply(f:(x:number)=>number):number{return f(1);}
    function run(n:number):number{
      const f=(x:number):number=>{throw "callback failure";};
      return apply(f);
    }
  `),
  bytes: 48,
  capacity: 10,
  expected: 0,
  thrown: "callback failure",
});
setModules.set("source-indexed-access", {
  ...compileSource(`
    interface Shape { value:number; label?:string }
    type Value = Shape["value"];
    function identity<T,K>(value:T[K]):T[K]{return value;}
    function label(value:Shape["label"]):number{if(value===undefined)return 1;return value.length;}
    function run(n:number):number {
      const box:Shape={value:identity<Shape,"value">(7),label:"ok"};
      const value:Value=box.value;
      if(value!==7||label(box.label)!==2||label(undefined)!==1)return -1;
      return 1;
    }
  `),
  bytes: 48,
  capacity: 10,
  expected: 1,
});
setModules.set("source-optional-string", {
  ...compileSource(`
   interface Text {label?:string|undefined}
   function choose(present:boolean,value:string):string|undefined{if(present)return value;return undefined;}
   function sixth(a:string|undefined,b:string|undefined,c:string|undefined,d:string|undefined,e:string|undefined,f:string|undefined):string|undefined{return f;}
   function forbidden():string{throw "unexpected fallback";}
   function length(value:string|undefined):number{if(value===undefined)return 0;return value.length;}
   function run(n:number):number {
     const text="a"+"bc";const a=choose(true,text);const b=choose(true,"abc");const none=choose(false,"x");
     if(a!==b||a==none||none!=undefined||undefined!==none)return -1;
     if(length(a)!==3||length(none)!==0)return -2;
     const empty=choose(true,"");if(empty)return -3;if(!a)return -3;
     if((empty??forbidden())!==""||(none??"fallback")!=="fallback")return -4;
     if(typeof empty!=="string"||typeof none!=="undefined")return -5;
     if(sixth(a,none,empty,b,none,a)!==b||sixth(a,a,a,a,a,none)!==undefined)return -6;
     const box:Text={};if(box.label!==undefined)return -7;
     box.label=a;if(box.label!==b)return -8;box.label=undefined;
     if(box.label!==none)return -9;
     return 1;
   }
 `),
  bytes: 64,
  capacity: 8,
  expected: 1,
});
const optionalReference = emitDarwinModule({
  records: [
    {
      byteLength: 32,
      fields: [{ offset: 16, type: "number", mutable: false }],
    },
    {
      byteLength: 32,
      fields: [
        {
          offset: 16,
          presenceOffset: 24,
          type: "optional-reference",
          mutable: true,
        },
      ],
    },
  ],
  functions: [
    {
      id: 0,
      name: "optionalReferences",
      exported: true,
      parameters: [0],
      slots: ["number", "boolean", "boolean"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "constant", id: 0, value: 9, ...s },
            { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
            { kind: "reference-wrap", id: 2, value: 1, ...s },
            { kind: "reference-none", id: 3, ...s },
            { kind: "record-new", id: 4, record: 1, arguments: [2], ...s },
            {
              kind: "record-new",
              id: 5,
              record: 1,
              arguments: [undefined],
              ...s,
            },
            { kind: "record-new", id: 6, record: 1, arguments: [3], ...s },
            { kind: "reference-value", id: 7, value: 2, ...s },
            { kind: "binary", id: 8, operator: "===", left: 7, right: 1, ...s },
            { kind: "unary", id: 9, operator: "truthy", operand: 2, ...s },
            { kind: "unary", id: 10, operator: "!", operand: 3, ...s },
            { kind: "store", slot: 1, value: 9, ...s },
            { kind: "store", slot: 2, value: 10, ...s },
          ],
          terminator: {
            kind: "branch",
            condition: 8,
            consequent: 1,
            alternate: 4,
            ...s,
          },
        },
        {
          id: 1,
          instructions: [{ kind: "load", id: 11, slot: 1, ...s }],
          terminator: {
            kind: "branch",
            condition: 11,
            consequent: 2,
            alternate: 4,
            ...s,
          },
        },
        {
          id: 2,
          instructions: [{ kind: "load", id: 12, slot: 2, ...s }],
          terminator: {
            kind: "branch",
            condition: 12,
            consequent: 3,
            alternate: 4,
            ...s,
          },
        },
        {
          id: 3,
          instructions: [{ kind: "constant", id: 13, value: 1, ...s }],
          terminator: { kind: "return", value: 13, ...s },
        },
        { id: 4, instructions: [], terminator: { kind: "trap", ...s } },
      ],
    },
  ],
});
assert.ok(optionalReference.ok, JSON.stringify(optionalReference));
assert.deepEqual(optionalReference.value.records[1]?.referenceOffsets, [16]);
setModules.set("optional-reference", {
  native: optionalReference.value,
  entry: 0,
  bytes: 128,
  capacity: 4,
  expected: 1,
});
const invalidSets = new Map<string, ReturnType<typeof compileSource>>();
for (const [name, input] of [
  ["negative", "-1"],
  ["large", "1114112"],
  ["fraction", "0.5"],
  ["nan", "0/0"],
  ["infinity", "1/0"],
  ["negative-infinity", "-1/0"],
]) {
  invalidSets.set(
    "string-code-point-invalid-" + name,
    compileSource(
      `function run(n:number):number{String.fromCodePoint(${input});return 0;}`,
    ),
  );
}

invalidSets.set(
  "source-module-graph-cycle-tdz",
  compileLinkedInstance([
    [
      "main",
      'import {value} from "dep";export const state=7;export function read():number{return state;}export function run():number{return value;}',
    ],
    ["dep", 'import {read} from "main";export const value=read();'],
  ]),
);

invalidSets.set(
  "source-module-instance-tdz",
  compileInstance(
    `
  const value=read();let state:number=7;export function read():number{return state;}
`,
    ["read"],
    (initializer) =>
      `function run(n:number):number {const a=${initializer}();return a.read();}`,
  ),
);

invalidSets.set(
  "source-captures-uninitialized",
  compileSource(`
  function run(n:number):number {const f=():number=>x;const y=f();let x:number=7;return y;}
`),
);

for (const kind of [
  "uninitialized",
  "reinitialize",
  "immutable",
  "environment",
]) {
  const base = ownedClosureFixture();
  const module = {
    ...base,
    records: base.records!.map((record, i) =>
      kind === "immutable" && i === 0
        ? {
            ...record,
            fields: record.fields.map((f) => ({ ...f, mutable: false })),
          }
        : record,
    ),
    functions: base.functions.map((fn) => ({
      ...fn,
      blocks: fn.blocks.map((block) => ({
        ...block,
        instructions: block.instructions.map((op) =>
          kind === "uninitialized" &&
          op.kind === "record-new" &&
          op.record === 0
            ? { ...op, arguments: [undefined] }
            : kind === "environment" && op.kind === "function-new"
              ? { ...op, environment: 1 }
              : op,
        ),
        terminator:
          kind === "reinitialize" &&
          block.terminator.kind === "record-cell" &&
          block.terminator.operation === "write"
            ? { ...block.terminator, operation: "initialize" as const }
            : block.terminator,
      })),
    })),
  };
  const emitted = emitDarwinModule(module);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  invalidSets.set("owned-closure-invalid-" + kind, {
    native: emitted.value,
    entry: 2,
  });
}

{
  const base = functionValueFixture("number", 1);
  const wrongSignature = emitDarwinModule({
    ...base,
    functions: base.functions.map((f) =>
      f.id === 0
        ? {
            ...f,
            returnType: "boolean",
            blocks: [
              {
                id: 0,
                instructions: [{ kind: "constant", id: 0, value: true, ...s }],
                terminator: { kind: "return", value: 0, ...s },
              },
            ],
          }
        : f,
    ),
  });
  assert.ok(wrongSignature.ok, JSON.stringify(wrongSignature));
  invalidSets.set("function-values-invalid-signature", {
    native: wrongSignature.value,
    entry: 3,
  });
  const wrongDescriptor = emitDarwinModule({
    ...base,
    functions: base.functions.map((f) =>
      f.id === 3
        ? {
            ...f,
            blocks: f.blocks.map((b) => ({
              ...b,
              instructions: b.instructions.map((op) =>
                op.kind === "function-new"
                  ? {
                      kind: "record-new",
                      id: op.id,
                      record: 0,
                      arguments: [],
                      ...s,
                    }
                  : op,
              ),
            })),
          }
        : f,
    ),
  });
  assert.ok(wrongDescriptor.ok, JSON.stringify(wrongDescriptor));
  invalidSets.set("function-values-invalid-descriptor", {
    native: wrongDescriptor.value,
    entry: 3,
  });
}

const absentExtraction = emitDarwinModule({
  functions: [
    {
      id: 0,
      name: "extractUndefined",
      exported: true,
      parameters: [],
      slots: [],
      returnType: "reference",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "reference-none", id: 0, ...s },
            { kind: "reference-value", id: 1, value: 0, ...s },
          ],
          terminator: { kind: "return", value: 1, ...s },
        },
      ],
    },
  ],
});
assert.ok(absentExtraction.ok, JSON.stringify(absentExtraction));
invalidSets.set("optional-reference-extract-absent", {
  native: absentExtraction.value,
  entry: 0,
});
const absentStringExtraction = emitDarwinModule({
  functions: [
    {
      id: 0,
      name: "extractAbsentString",
      exported: true,
      parameters: [],
      slots: [],
      returnType: "string",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "string-none", id: 0, ...s },
            { kind: "string-value", id: 1, value: 0, ...s },
          ],
          terminator: { kind: "return", value: 1, ...s },
        },
      ],
    },
  ],
});
assert.ok(absentStringExtraction.ok, JSON.stringify(absentStringExtraction));
invalidSets.set("optional-string-extract-absent", {
  native: absentStringExtraction.value,
  entry: 0,
});
for (const [name, length, offset] of [
  ["negative", 2, "-1"],
  ["infinite", 2, "1/0"],
  ["negative-infinite", 2, "-1/0"],
  ["past-end", 2, "4"],
  ["empty-past-end", 0, "6"],
] as const)
  invalidSets.set(
    "set-invalid-" + name,
    compileSource(
      `function run(n:number):number{const a=new Uint8Array(5),b=new Uint8Array(${length});a.set(b,${offset});return 1;}`,
    ),
  );
const words = compileSource(
  readFileSync(
    new URL("../packages/foundation/src/binary/word64.ts", import.meta.url),
    "utf8",
  ) +
    `
function empty(value:""|"BAD"):boolean { return !value; }
function errorCode(e:WordError):number {
 switch(e){case "INVALID_WORD":return 1;case "INVALID_NUMBER":return 2;case "OVERFLOW":return 3;case "UNDERFLOW":return 4;}
}
function project(r:WordResult<number>):number {switch(r.ok){case true:return r.value;case false:return -30;}}
function run(n:number):number {
 if(!empty("")||empty("BAD"))return -20;
 const a=fromParts(4294967295,0); if(!a.ok)return -1;
 const b=fromSafeInteger(1); if(!b.ok)return -2;
 if(!a.ok)return -15;
 const sum=add(a.value,b.value);if(!sum.ok)return -3;
 if(sum.value.lo!==0||sum.value.hi!==1)return -4;
 if(!b.ok)return -16;
 const diff=subtract(sum.value,b.value);if(!diff.ok)return -5;
 const number=toSafeInteger(diff.value);if(!number.ok)return -6;
 const invalid=fromParts(-1,0);if(invalid.ok)return -7;
 if(errorCode(invalid.error)!==1)return -8;
 if(!b.ok)return -17;
 const overflow=add({lo:4294967295,hi:4294967295},b.value);
 if(overflow.ok)return -9;if(errorCode(overflow.error)!==3)return -10;
 if(!a.ok||!b.ok)return -18;
 const underflow=subtract(b.value,a.value);if(underflow.ok)return -11;
 if(errorCode(underflow.error)!==4)return -12;
 const unsafe=fromSafeInteger(-1);if(unsafe.ok)return -13;
 if(errorCode(unsafe.error)!==2)return -14;
 if(!number.ok)return -19;
 return project(number);
}
`,
);
function moduleSource(
  id: string,
  text: string,
  dependencies: readonly [string, string][],
): SourceModule {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map(dependencies) };
}
{
  const modules = [
    moduleSource(
      "main",
      `import {encodeFloat64} from "@tint/foundation/binary/bytes";
    export function run(n:number):number{
      const a=encodeFloat64(-0),b=encodeFloat64(5e-324),c=encodeFloat64(1.7976931348623157e308),d=encodeFloat64(-1/0),e=encodeFloat64(0/0),f=encodeFloat64(0.1);
      return a.lo===0&&a.hi===2147483648&&b.lo===1&&b.hi===0&&c.lo===4294967295&&c.hi===2146435071&&d.lo===0&&d.hi===4293918720&&e.lo===0&&e.hi===2146959360&&f.lo===2576980378&&f.hi===1069128089?1:-1;
    }`,
      [["@tint/foundation/binary/bytes", "bytes"]],
    ),
    moduleSource(
      "bytes",
      readFileSync(
        new URL("../packages/foundation/src/binary/bytes.ts", import.meta.url),
        "utf8",
      ),
      [["./word64.ts", "word64"]],
    ),
    moduleSource(
      "word64",
      readFileSync(
        new URL("../packages/foundation/src/binary/word64.ts", import.meta.url),
        "utf8",
      ),
      [],
    ),
  ];
  const linked = linkModules(modules, "main", [
    "Number",
    "Math",
    "NaN",
    "Infinity",
    "undefined",
  ]);
  assert.ok(linked.ok, JSON.stringify(linked));
  setModules.set("source-float64-encoding", {
    ...compileModule(linked.value.module, 0),
    bytes: 192,
    capacity: 2,
    expected: 1,
  });
}
const byteMain = moduleSource(
  "main",
  `
import {writeUnsigned,writeSigned,writeWord64,alignUp} from "@tint/foundation/binary/bytes";
export function run(buffer:Uint8Array):number {
 const a=writeUnsigned(buffer,0,4,305419896,"little");if(!a.ok)return -1;
 const b=writeSigned(buffer,4,2,-2,"big");if(!b.ok)return -2;
 const c=writeWord64(buffer,8,{lo:2309737967,hi:19088743},"little");if(!c.ok)return -3;
 if(!a.ok||a.value!==undefined)return -4;
 const bounds=writeUnsigned(buffer,31,4,1,"little");if(bounds.ok)return -5;
 if(bounds.error!=="OUT_OF_BOUNDS")return -6;
 const invalid=writeUnsigned(buffer,0,1,256,"little");if(invalid.ok)return -7;
 if(invalid.error!=="VALUE_OUT_OF_RANGE")return -8;
 let sum=0;for(const value of buffer){sum+=value;}if(sum!==1745)return -10;
 const aligned=alignUp(17,16);if(!aligned.ok)return -9;
 return aligned.value;
}`,
  [["@tint/foundation/binary/bytes", "bytes"]],
);
const linked = linkModules(
  [
    byteMain,
    moduleSource(
      "bytes",
      readFileSync(
        new URL("../packages/foundation/src/binary/bytes.ts", import.meta.url),
        "utf8",
      ),
      [["./word64.ts", "word64"]],
    ),
    moduleSource(
      "word64",
      readFileSync(
        new URL("../packages/foundation/src/binary/word64.ts", import.meta.url),
        "utf8",
      ),
      [],
    ),
  ],
  "main",
  ["Number", "Math", "NaN", "Infinity", "undefined"],
);
assert.ok(linked.ok, JSON.stringify(linked));
const byteModule = compileModule(linked.value.module, 0);
const arrayInstructions: IRInstruction[] = [
  { kind: "constant", id: 0, value: 3, ...s },
  { kind: "constant", id: 1, value: 1, ...s },
  { kind: "constant", id: 2, value: 257.75, ...s },
  { kind: "constant", id: 3, value: 0, ...s },
];
let arrayId = 4,
  arraySum = 3;
for (const type of ["Uint8Array", "Uint16Array", "Uint32Array"] as const) {
  const array = arrayId++;
  arrayInstructions.push({
    kind: "array-new",
    id: array,
    type,
    length: 0,
    ...s,
  });
  for (let n = 0; n < 3; n++) {
    const index = arrayId++,
      read = arrayId++,
      value = arrayId++,
      sum = arrayId++;
    arrayInstructions.push(
      { kind: "constant", id: index, value: n, ...s },
      { kind: "array-read", id: read, array, index, ...s },
      { kind: "optional-value", id: value, value: read, ...s },
      {
        kind: "binary",
        id: sum,
        operator: "+",
        left: arraySum,
        right: value,
        ...s,
      },
    );
    arraySum = sum;
  }
  const read = arrayId++,
    value = arrayId++,
    sum = arrayId++;
  arrayInstructions.push(
    { kind: "array-write", array, index: 1, value: 2, ...s },
    { kind: "array-read", id: read, array, index: 1, ...s },
    { kind: "optional-value", id: value, value: read, ...s },
    {
      kind: "binary",
      id: sum,
      operator: "+",
      left: arraySum,
      right: value,
      ...s,
    },
  );
  arraySum = sum;
}
arrayInstructions.push({
  kind: "array-new",
  id: arrayId++,
  type: "Uint8Array",
  length: 3,
  ...s,
});
const arrayNative = emitDarwinModule({
  functions: [
    {
      id: 0,
      name: "arrays",
      exported: true,
      slots: [],
      parameters: [],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: arrayInstructions,
          terminator: { kind: "return", value: arraySum, ...s },
        },
      ],
    },
  ],
});
assert.ok(arrayNative.ok, JSON.stringify(arrayNative));
const arrays = { native: arrayNative.value, entry: 0 };
const directory = mkdtempSync(join(tmpdir(), "tint-construction-"));
try {
  let verifiedModes = 0;
  for (const mode of [
    "ir",
    "objects",
    "word64",
    "bytes",
    "strings",
    "slices",
    "arrays",
    "source-arrays",
    "views8",
    "views16",
    "views32",
    ...setModules.keys(),
    ...invalidSets.keys(),
  ]) {
    if (
      process.env.TINT_NATIVE_FILTER !== undefined &&
      !mode.includes(process.env.TINT_NATIVE_FILTER)
    )
      continue;
    verifiedModes++;
    const setModule = setModules.get(mode),
      invalidSet = invalidSets.get(mode);
    const sourceObjects = mode !== "ir",
      word64 = mode === "word64",
      byteMode = mode === "bytes",
      stringMode = mode === "strings",
      sliceMode = mode === "slices",
      arrayMode = mode === "arrays",
      sourceArrayMode = mode === "source-arrays",
      viewModule =
        mode === "views8"
          ? viewModules[0]
          : mode === "views16"
            ? viewModules[1]
            : mode === "views32"
              ? viewModules[2]
              : undefined,
      regionBytes =
        setModule?.regionBytes ??
        (mode.startsWith("signature-")
          ? mode.startsWith("signature-409")
            ? 24576
            : 8192
          : mode.startsWith("sha256-")
            ? 4096
            : viewModule !== undefined
              ? 640
              : byteMode || sliceMode
                ? 576
                : 512);
    const largeMetadata =
      mode.startsWith("signature-") || setModule?.regionBytes !== undefined;
    const metadataWords = largeMetadata ? 864 : 192;
    const metadataBase = Math.max(2048, 1024 + regionBytes);
    const frameBytes = metadataBase + metadataWords * 4;
    const selected =
      invalidSet ??
      setModule ??
      (viewModule !== undefined
        ? viewModule
        : sourceArrayMode
          ? sourceArrays
          : arrayMode
            ? arrays
            : sliceMode
              ? sliced
              : stringMode
                ? concatenated
                : byteMode
                  ? byteModule
                  : word64
                    ? words
                    : objects);
    const compiled = sourceObjects ? selected.native : native.value;
    for (const exhausted of [false, true]) {
      const instructions: Instruction[] = [],
        calls: {
          offset: number;
          module: "allocator" | "record";
          function: number;
        }[] = [],
        addresses: {
          offset: number;
          target: "wrapper" | "descriptor" | "roots";
          rd: number;
        }[] = [];
      const emit = (i: Instruction) => instructions.push(i);
      const imm = (rd: number, value: bigint) => {
        for (const shift of [0, 16, 32, 48] as const)
          emit({
            op: shift === 0 ? "movz" : "movk",
            width: 64,
            rd,
            immediate: Number((value >> BigInt(shift)) & 65535n),
            shift,
          });
      };
      const address = (rd: number, offset: number) => {
        if (offset >= 4096)
          emit({
            op: "add-imm",
            width: 64,
            rd,
            rn: "sp",
            immediate: Math.floor(offset / 4096),
            shift: 12,
            setFlags: false,
          });
        emit({
          op: "add-imm",
          width: 64,
          rd,
          rn: offset >= 4096 ? rd : "sp",
          immediate: offset % 4096,
          shift: 0,
          setFlags: false,
        });
      };
      const equal = (a: number, b: number) => {
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: a,
          rm: b,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        emit({ op: "b.cond", condition: "eq", displacement: 8 });
        emit({ op: "brk", immediate: 4 });
      };
      const bits = (n: number) => {
        const d = new DataView(new ArrayBuffer(8));
        d.setFloat64(0, n, true);
        return d.getBigUint64(0, true);
      };
      const number = (d: number, n: number) => {
        imm(9, bits(n));
        emit({ op: "fmov-d-x", rd: d, rn: 9 });
      };
      const check = (offset: number, expected: bigint) => {
        emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset });
        imm(10, expected);
        equal(9, 10);
      };
      const call = (module: "allocator" | "record", fn: number) => {
        calls.push({ offset: instructions.length * 4, module, function: fn });
        emit({ op: "bl", displacement: 0 });
      };
      const pointer = (
        offset: number,
        target: "wrapper" | "descriptor" | "roots",
        rd = 9,
      ) => {
        addresses.push({ offset: instructions.length * 4, target, rd });
        emit({ op: "adr", rd, displacement: 0 });
        if (offset >= 0)
          emit({ op: "str", width: 64, rt: rd, rn: "sp", offset });
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
      if (frameBytes >= 4096)
        emit({
          op: "sub-imm",
          width: 64,
          rd: "sp",
          rn: "sp",
          immediate: Math.floor(frameBytes / 4096),
          shift: 12,
          setFlags: false,
        });
      emit({
        op: "sub-imm",
        width: 64,
        rd: "sp",
        rn: "sp",
        immediate: frameBytes % 4096,
        shift: 0,
        setFlags: false,
      });
      for (let offset = 0; offset < 2048; offset += 8)
        emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
      imm(9, 0xccccccccccccccccn);
      for (let offset = 1024; offset < 1024 + regionBytes; offset += 8)
        emit({ op: "str", width: 64, rt: 9, rn: "sp", offset });
      // Raw metadata is outside the managed region; the host root keeps the current chain alive.
      address(9, metadataBase);
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 472 });
      imm(9, 4n);
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 448 });
      imm(9, 1n);
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 456 });
      imm(9, BigInt(metadataWords));
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 464 });
      address(9, 896);
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 64 });
      address(9, 944);
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 904 });
      imm(9, 2n);
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 944 });
      imm(9, 16n);
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 952 });
      imm(9, 24n);
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 960 });
      address(9, 1024);
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 72 });
      pointer(80, "wrapper");
      address(9, 128);
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 88 });
      imm(9, BigInt(regionBytes));
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 96 });
      address(0, 64);
      address(1, 128);
      imm(2, 0n);
      address(3, 0);
      number(0, regionBytes);
      number(1, 16);
      address(4, 448);
      call("allocator", lowered.value.initializer);
      check(0, 1n);
      check(16, 1n);
      if (byteMode) {
        address(9, 1648);
        emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 1624 });
        imm(9, 2n);
        emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 1600 });
        imm(9, 1n);
        emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 1608 });
        imm(9, 32n);
        emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 1616 });
      }
      const capacity =
        setModule?.capacity ??
        (invalidSet !== undefined
          ? 1
          : arrayMode
            ? 2
            : word64 ||
                byteMode ||
                stringMode ||
                sliceMode ||
                sourceArrayMode ||
                viewModule !== undefined
              ? 1
              : sourceObjects
                ? 5
                : 16);
      const count = capacity + (exhausted ? 1 : 0);
      for (let i = 0; i < count; i++) {
        address(0, 64);
        imm(1, 0n);
        imm(2, 0n);
        address(3, 0);
        number(0, i + 1);
        emit({ op: "ldr", width: 64, rt: 4, rn: "sp", offset: 912 });
        if (byteMode) address(4, 1600);
        call("record", sourceObjects ? selected.entry : 0);
        if (invalidSet !== undefined) {
          // An uncaught language exception reaches the harness through status 2.
          // Preserve the invalid-input exit contract without accepting success.
          check(0, 2n);
          emit({ op: "brk", immediate: 3 });
          continue;
        }
        check(0, setModule?.thrown === undefined ? 1n : 2n);
        if (sourceObjects) {
          if (setModule?.thrown !== undefined) {
            check(16, 3n);
            emit({ op: "ldr", width: 64, rt: 12, rn: "sp", offset: 24 });
            emit({ op: "ldr", width: 64, rt: 9, rn: 12, offset: 0 });
            imm(10, 1n);
            equal(9, 10);
            emit({ op: "ldr", width: 64, rt: 9, rn: 12, offset: 16 });
            imm(10, BigInt(setModule.thrown.length));
            equal(9, 10);
            for (let unit = 0; unit < setModule.thrown.length; unit++) {
              emit({ op: "ldrh", rt: 9, rn: 12, offset: 24 + unit * 2 });
              imm(10, BigInt(setModule.thrown.charCodeAt(unit)));
              equal(9, 10);
            }
          } else
            check(
              16,
              bits(
                setModule !== undefined
                  ? setModule.expected
                  : viewModule !== undefined
                    ? 6276
                    : sourceArrayMode
                      ? 5
                      : arrayMode
                        ? 515
                        : sliceMode
                          ? 1
                          : stringMode
                            ? 31
                            : byteMode
                              ? 32
                              : word64
                                ? 4294967295
                                : 2 * i + 26,
              ),
            );
          if (viewModule !== undefined) {
            const marker =
              viewModule.width === 1 ? 2 : viewModule.width === 2 ? 3 : 4;
            check(1024, BigInt(marker));
            check(1032, 0n);
            check(1040, 6n);
            for (let v = 0; v < viewModule.metadata.length; v++) {
              const m = viewModule.metadata[v]!,
                offset = 1024 + viewModule.ownerBytes + v * 48;
              check(offset, BigInt(marker));
              check(offset + 8, 2n);
              check(offset + 16, BigInt(m.length));
              check(offset + 40, 0n);
              emit({
                op: "ldr",
                width: 64,
                rt: 9,
                rn: "sp",
                offset: offset + 24,
              });
              address(10, 1056 + m.start * viewModule.width);
              equal(9, 10);
              emit({
                op: "ldr",
                width: 64,
                rt: 9,
                rn: "sp",
                offset: offset + 32,
              });
              address(10, 1024 + m.owner);
              equal(9, 10);
            }
          }
          if (mode === "string-set") {
            check(1056, bits(1));
            emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 1040 });
            address(10, 1440);
            equal(9, 10);
            check(1064, bits(8));
            check(1464, bits(8));
            check(1472, 0n);
          }
          if (mode === "source-optional-reference") {
            const base = 1024 + i * 96;
            check(base + 32, 0n);
            emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: base + 80 });
            address(10, base);
            equal(9, 10);
            for (const offset of [24, 72]) {
              emit({ op: "ldrb", rt: 9, rn: "sp", offset: base + offset });
              imm(10, 1n);
              equal(9, 10);
            }
          }
          if (mode === "optional-reference") {
            const base = 1024 + i * 128;
            emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: base + 48 });
            address(10, base);
            equal(9, 10);
            check(base + 80, 0n);
            check(base + 112, 0n);
            for (const [offset, flag] of [
              [56, 1],
              [88, 0],
              [120, 1],
            ] as const) {
              emit({ op: "ldrb", rt: 9, rn: "sp", offset: base + offset });
              imm(10, BigInt(flag));
              equal(9, 10);
            }
          }
          if (mode === "optional-presence") {
            const base = 1024 + i * 144;
            for (const [record, presence] of [
              [0, 0],
              [48, 1],
              [96, 1],
            ] as const) {
              emit({ op: "ldrb", rt: 9, rn: "sp", offset: base + record + 16 });
              imm(10, BigInt(presence));
              equal(9, 10);
              check(base + record + 32, 0n);
            }
            check(base + 24, 0n);
          }
          if (mode === "number-list") {
            check(1184, bits(9));
            emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 1192 });
            address(10, 1216);
            equal(9, 10);
            emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 1200 });
            address(10, 1376);
            equal(9, 10);
            check(1248, 0x8000000000000000n);
          }
          if (mode === "float64-storage") {
            for (const [relative, marker, length, flags] of [
              [0, 5, 6, 0],
              [80, 5, 2, 2],
              [128, 5, 2, 0],
              [176, 5, 3, 2],
              [224, 5, 3, 0],
              [288, 4, 2, 0],
              [336, 5, 2, 0],
              [384, 4, 2, 0],
            ]) {
              check(1024 + relative!, BigInt(marker!));
              check(1032 + relative!, BigInt(flags!));
              check(1040 + relative!, BigInt(length!));
            }
            check(1056, 0x8000000000000000n);
            check(1064, 0x8000000000000000n);
            check(1072, bits(0.1));
            check(1088, bits(-Infinity));
            check(1096, 1n);
            check(1304, 0n);
            for (const relative of [80, 176]) {
              emit({
                op: "ldr",
                width: 64,
                rt: 9,
                rn: "sp",
                offset: 1024 + relative + 32,
              });
              address(10, 1024);
              equal(9, 10);
            }
          }
          if (arrayMode) {
            for (let prior = 0; prior <= i; prior++) {
              const base = 1024 + prior * 176;
              for (let n = 0; n < 4; n++) {
                const offset = base + (n === 3 ? 144 : n * 48);
                check(offset, BigInt(n === 3 ? 2 : n + 2));
                check(offset + 8, 0n);
                check(offset + 16, n === 3 ? 0n : 3n);
                emit({
                  op: "ldr",
                  width: 64,
                  rt: 9,
                  rn: "sp",
                  offset: offset + 24,
                });
                address(10, offset + 32);
                equal(9, 10);
                if (n < 3) {
                  check(offset + 32, [0x100n, 0x1010000n, 0x10100000000n][n]!);
                  check(offset + 40, 0n);
                }
              }
            }
          }
          if (sourceArrayMode) {
            check(1352, 0n);
            emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 1360 });
            address(10, 1024);
            equal(9, 10);
            emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 1368 });
            address(10, 1296);
            equal(9, 10);
            for (const [relative, marker, length] of [
              [0, 2, 3],
              [48, 3, 3],
              [96, 4, 3],
              [144, 2, 0],
              [176, 3, 0],
              [208, 2, 0],
              [240, 2, 0],
              [272, 4, 3],
            ]) {
              const offset = 1024 + relative!;
              check(offset, BigInt(marker!));
              check(offset + 8, 0n);
              check(offset + 16, BigInt(length!));
              emit({
                op: "ldr",
                width: 64,
                rt: 9,
                rn: "sp",
                offset: offset + 24,
              });
              address(10, offset + 32);
              equal(9, 10);
            }
          }
          if (sliceMode) {
            let offset = 1024;
            for (const text of sliceExpected) {
              check(offset, 1n);
              check(offset + 8, 0n);
              check(offset + 16, BigInt(text.length));
              offset += Math.ceil((24 + 2 * text.length) / 16) * 16;
            }
          }
          if (stringMode) {
            for (const [offset, length] of [
              [0, 0],
              [32, 3],
              [64, 5],
              [112, 5],
              [160, 5],
              [240, 31],
            ]) {
              check(1024 + offset!, 1n);
              check(1032 + offset!, 0n);
              check(1040 + offset!, BigInt(length!));
            }
            check(1080, 0xccccd80000000041n);
          }
          if (byteMode) {
            check(1648, 0x0000feff12345678n);
            check(1656, 0x0123456789abcdefn);
            check(1664, 0n);
            check(1672, 0n);
          }
          emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 64 });
          address(10, 896);
          equal(9, 10);
          continue;
        }
        emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 16 });
        address(10, 1024 + i * 32);
        equal(9, 10);
        emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 912 });
        emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 64 });
        address(10, 896);
        equal(9, 10);
        for (let j = 0; j <= i; j++) {
          const offset = 1024 + j * 32;
          emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset });
          pointer(-1, "descriptor", 10);
          equal(9, 10);
          check(offset + 8, 0n);
          check(offset + 16, bits(j + 1));
          if (j === 0) check(offset + 24, 0n);
          else {
            emit({
              op: "ldr",
              width: 64,
              rt: 9,
              rn: "sp",
              offset: offset + 24,
            });
            address(10, 1024 + (j - 1) * 32);
            equal(9, 10);
          }
        }
      }
      if (invalidSet === undefined) {
        address(0, 64);
        address(1, 128);
        imm(2, 0n);
        address(3, 0);
        call("allocator", used);
        check(0, 1n);
        check(
          16,
          bits(
            count *
              (setModule !== undefined
                ? setModule.bytes
                : viewModule !== undefined
                  ? viewModule.bytes
                  : sourceArrayMode
                    ? 352
                    : arrayMode
                      ? 176
                      : sliceMode
                        ? sliceBytes
                        : stringMode
                          ? 400
                          : byteMode
                            ? 528
                            : word64
                              ? 448
                              : sourceObjects
                                ? 96
                                : 32),
          ),
        );
      }
      imm(0, 0n);
      if (frameBytes >= 4096)
        emit({
          op: "add-imm",
          width: 64,
          rd: "sp",
          rn: "sp",
          immediate: Math.floor(frameBytes / 4096),
          shift: 12,
          setFlags: false,
        });
      emit({
        op: "add-imm",
        width: 64,
        rd: "sp",
        rn: "sp",
        immediate: frameBytes % 4096,
        shift: 0,
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
      const wrapper = instructions.length * 4,
        root: NativeRootFrame = native.value.roots[0]!;
      if (!sourceObjects) {
        assert.equal(root.offsets.length, 3);
        emit({ op: "ldr", width: 64, rt: 8, rn: 0, offset: 0 });
        emit({ op: "ldr", width: 64, rt: 9, rn: 8, offset: 8 });
        pointer(-1, "roots", 10);
        equal(9, 10);
        emit({ op: "ldr", width: 64, rt: 12, rn: 8, offset: 0 });
        emit({ op: "ldr", width: 64, rt: 13, rn: 12, offset: 16 });
        for (const offset of root.offsets.slice(0, 2)) {
          emit({ op: "ldr", width: 64, rt: 9, rn: 8, offset });
          equal(9, 13);
        }
        emit({ op: "ldr", width: 64, rt: 9, rn: 8, offset: root.offsets[2]! });
        imm(10, 0n);
        equal(9, 10);
      }
      const tail = instructions.length * 4;
      emit({ op: "b", displacement: 0 });
      const recordBase = instructions.length * 4,
        allocatorBase = recordBase + compiled.code.length,
        code = new Uint8Array(allocatorBase + allocator.value.code.length);
      instructions.forEach((i, n) =>
        assert.ok(writeInstruction(code, n * 4, i).ok),
      );
      code.set(compiled.code, recordBase);
      code.set(allocator.value.code, allocatorBase);
      for (const c of calls)
        assert.ok(
          patchBranch(code, {
            offset: c.offset,
            targetOffset:
              c.module === "record"
                ? recordBase + compiled.functions[c.function]!.offset
                : allocatorBase + allocator.value.functions[c.function]!.offset,
            branch: { op: "bl" },
          }).ok,
        );
      assert.ok(
        patchBranch(code, {
          offset: tail,
          targetOffset:
            allocatorBase + allocator.value.functions[allocate]!.offset,
          branch: { op: "b" },
        }).ok,
      );
      for (const fixup of addresses)
        assert.ok(
          patchAddress(code, {
            offset: fixup.offset,
            targetOffset:
              fixup.target === "wrapper"
                ? wrapper
                : recordBase +
                  (fixup.target === "descriptor"
                    ? native.value.records[0]!.offset
                    : root.descriptorOffset),
            rd: fixup.rd,
          }).ok,
        );
      const image = buildAArch64Executable(
        handleNativeTestTraps({
          code,
          imports: [
            ...new Set(compiled.imports.map((item) => item.target.name)),
          ],
          addressFixups: compiled.imports.map((item) => ({
            ...item,
            offset: item.offset + recordBase,
          })),
          entryOffset: 0,
          identifier: "tint.verify.construction",
          minimumOS: { major: 26, minor: 6, patch: 2 },
          sdk: { major: 26, minor: 6, patch: 0 },
          maxByteLength: code.length * 2 + 65536,
        }),
      );
      assert.ok(image.ok, JSON.stringify(image));
      const path = join(
        directory,
        `${mode}-${exhausted ? "exhausted" : "constructed"}`,
      );
      writeFileSync(path, image.value.bytes, { mode: 0o755 });
      if (process.env.TINT_BUILD_ONLY === "1") continue;
      const signature = spawnSync(
        "/usr/bin/codesign",
        ["--verify", "--strict", path],
        { encoding: "utf8" },
      );
      assert.equal(signature.status, 0, signature.stderr);
      for (let i = 0; i < 2; i++) {
        const run = spawnSync(path, [], { timeout: 10000, cwd: directory });
        assert.equal(run.error, undefined);
        assert.equal(run.signal, null, mode);
        assert.equal(
          run.status,
          exhausted || invalidSet !== undefined ? nativeTrapStatus : 0,
          mode,
        );
      }
    }
  }
  assert.ok(verifiedModes > 0, "fixture filter matched nothing");
  if (process.env.TINT_BUILD_ONLY === "1")
    console.log(
      `Built ${verifiedModes} native construction modes for debugger execution; binaries have not been executed.`,
    );
  else
    console.log(
      `Verified ${verifiedModes} native construction modes through the TypeScript allocator, each success/exhaustion image twice, including exact accounting and rooted callback inputs. With no filter this covers records, strings, typed arrays, numeric lists, module state, SHA-256 and linked Apple signatures.`,
    );
} finally {
  if (
    process.env.TINT_KEEP_NATIVE === "1" ||
    process.env.TINT_BUILD_ONLY === "1"
  )
    console.log(directory);
  else rmSync(directory, { recursive: true, force: true });
}
