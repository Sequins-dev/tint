import { test } from "node:test";
import assert from "node:assert/strict";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import {
  bindHostOperations,
  type HostOperation,
  type ModuleIR,
} from "@tint/ir/scalar";
import { emitModule, type NativeModule } from "../src/aarch64/scalar/index.ts";
import { encode } from "../src/aarch64/isa.ts";
import {
  emitDiagnostics,
  diagnosticDataBytes,
  diagnosticJitDescriptorOffset,
  signpostNames,
  signpostNameSlot,
  type DiagnosticsRequest,
} from "../src/aarch64/diagnostics.ts";
import {
  emitHostedEntry,
  type HostDiagnostics,
  type HostRequest,
} from "../src/aarch64/startup.ts";

function word(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, true);
}
/** Target of an encoded B or BL at `offset`. */
function branchTarget(bytes: Uint8Array, offset: number): number {
  const value = word(bytes, offset);
  assert.ok((value & 0x7c000000) === 0x14000000, "B/BL expected");
  const imm = value & 0x3ffffff,
    signed = imm >= 0x2000000 ? imm - 0x4000000 : imm;
  return offset + signed * 4;
}
function framePush(): number {
  const push = encode({
    op: "stp",
    width: 64,
    rt: 29,
    rt2: 30,
    rn: "sp",
    offset: -16,
    mode: "pre",
  });
  assert.ok(push.ok);
  return push.value;
}

function throwing(): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "fail",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [],
            terminator: {
              kind: "throw-literal",
              value: "boom",
              start: 0,
              end: 0,
            },
          },
        ],
      },
    ],
  };
}

test("throw traces call the hosted capture routine only when requested", () => {
  const plain = emitModule(throwing());
  assert.ok(plain.ok, JSON.stringify(plain));
  assert.equal(plain.value.startupCalls, undefined);
  const traced = emitModule(throwing(), { throwTraces: true });
  assert.ok(traced.ok, JSON.stringify(traced));
  const calls = traced.value.startupCalls ?? [];
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.target, "trace-capture");
  // An unpatched BL, after the thrown value is in x17 and its tag in x16.
  assert.equal(word(traced.value.code, calls[0]?.offset ?? 0), 0x94000000);
  assert.ok(traced.value.code.length > plain.value.code.length);
});

function bound(
  operation: string,
  returnType: "number" | "void",
  parameters: readonly ("number" | "Uint8Array")[] = [],
): NativeModule {
  const slots = parameters.slice();
  const input: ModuleIR = {
    functions: [
      {
        id: 0,
        name: operation,
        exported: true,
        parameters: slots.map((_, index) => index),
        slots,
        returnType,
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [],
            terminator: { kind: "return", value: undefined, start: 0, end: 0 },
          },
        ],
      },
    ],
  };
  const host = bindHostOperations(input, [
    { function: 0, operation: operation as HostOperation },
  ]);
  assert.ok(host.ok, JSON.stringify(host));
  const emitted = emitModule(host.value, { hostABI: darwinHostABI() });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  return emitted.value;
}

test("JIT debugging and process host operations use hosted routines and OS calls", () => {
  assert.deepEqual(
    bound("jit-debug-descriptor", "number").startupCalls?.map((c) => c.target),
    ["jit-descriptor"],
  );
  assert.deepEqual(
    bound("jit-debug-register", "void").startupCalls?.map((c) => c.target),
    ["jit-register"],
  );
  assert.deepEqual(
    bound("process-id", "number").imports.map((i) => i.target.name),
    ["_getpid"],
  );
  const write = bound("memory-write-bytes", "number", [
    "number",
    "number",
    "number",
    "Uint8Array",
  ]);
  // A plain bounded copy: no JIT write protection or cache maintenance.
  assert.deepEqual(
    write.imports.map((i) => i.target.name),
    ["_memmove"],
  );
});

function diagnostics(extra: Partial<DiagnosticsRequest>): DiagnosticsRequest {
  return {
    base: 65536,
    stackTraces: false,
    signposts: [],
    allocationSignposts: false,
    jitDebug: false,
    symbolPrefix: "_",
    signpostABI: darwinHostABI().signposts,
    ...extra,
  };
}

test("diagnostics blocks contain only the requested routines", () => {
  const empty = emitDiagnostics(diagnostics({}));
  assert.ok(empty.ok);
  assert.equal(empty.value.entries.size, 0);
  assert.equal(empty.value.code.length, 0);
  const traces = emitDiagnostics(diagnostics({ stackTraces: true }));
  assert.ok(traces.ok);
  assert.deepEqual(
    [...traces.value.entries.keys()],
    ["trace-capture", "trace-report"],
  );
  assert.deepEqual(
    [...new Set(traces.value.imports.map((i) => i.name))],
    ["_write"],
  );
  assert.equal(traces.value.tableReferences.length, 1);
  const tail = new TextDecoder().decode(
    traces.value.code.subarray(traces.value.cstringOffset),
  );
  assert.match(tail, /Uncaught /);
  assert.match(tail, /no throw-site trace/);
  assert.equal(traces.value.code.length % 16, 0);
  const jit = emitDiagnostics(diagnostics({ jitDebug: true }));
  assert.ok(jit.ok);
  assert.deepEqual(
    [...jit.value.entries.keys()],
    ["jit-register", "jit-descriptor"],
  );
  assert.deepEqual(
    jit.value.dataReferences.map((r) => r.target),
    [diagnosticJitDescriptorOffset],
  );
  assert.deepEqual(
    emitDiagnostics(
      diagnostics({ allocationSignposts: true, signpostABI: undefined }),
    ),
    { ok: false, error: "target has no signpost facility" },
  );
});

test("signpost thunks bracket the displaced body with begin and end", () => {
  const site = 4096,
    request = diagnostics({
      signposts: [
        {
          offset: site,
          name: 1,
          stackBytes: 32,
          classify: { register: 2, alternate: 2 },
        },
      ],
      allocationSignposts: true,
    });
  const block = emitDiagnostics(request);
  assert.ok(block.ok, JSON.stringify(block));
  const value = block.value;
  assert.deepEqual([...value.entries.keys()].sort(), [
    "allocation-signpost",
    "signpost",
    "signpost-init",
    "signpost-thunk-0",
  ]);
  assert.deepEqual([...new Set(value.imports.map((i) => i.name))].sort(), [
    "__dyld_get_image_header",
    "__os_signpost_emit_with_name_impl",
    "_os_log_create",
    "_os_signpost_enabled",
  ]);
  // The stub after the thunk re-executes the frame push, then branches to
  // the function's second instruction.
  const thunk = value.thunks[0] ?? 0;
  let stub = -1;
  for (let offset = thunk; offset < value.cstringOffset; offset += 4)
    if (word(value.code, offset) === framePush() && offset > thunk) {
      stub = offset;
      break;
    }
  assert.ok(stub > thunk);
  assert.equal(request.base + branchTarget(value.code, stub + 4), site + 4);
  // Interval names live in fixed C-string slots after the messages.
  const strings = new TextDecoder().decode(
    value.code.subarray(value.cstringOffset),
  );
  const first = strings.indexOf(signpostNames[0] ?? "");
  assert.equal(first % signpostNameSlot, 0);
  assert.equal(
    strings.indexOf(signpostNames[1] ?? ""),
    first + signpostNameSlot,
  );
  assert.ok(strings.includes("dev.tint.runtime\0PointsOfInterest\0"));
});

function native(
  count: number,
  startupCalls?: NativeModule["startupCalls"],
): NativeModule {
  const code = new Uint8Array(count * 16);
  const push = framePush();
  for (let id = 0; id < count; id++)
    new DataView(code.buffer).setUint32(id * 16, push, true);
  return {
    sourceRanges: [],
    imports: [],
    signatures: [],
    functionDescriptor: undefined,
    functionDescriptorImport: undefined,
    linkage: "local",
    managedImports: [],
    records: [],
    roots: [],
    strings: [],
    cellHelpers: [],
    helpers: [],
    code,
    ...(startupCalls === undefined ? {} : { startupCalls }),
    functions: Array.from({ length: count }, (_, id) => ({
      id,
      name: "stub",
      exported: true,
      offset: id * 16,
      byteLength: 16,
      frameBytes: 0,
      signature: { parameters: [], stackBytes: 0 },
    })),
  };
}
function hosted(
  diagnostics: HostDiagnostics | undefined,
  programCalls?: NativeModule["startupCalls"],
): HostRequest {
  const allocator = native(2),
    runtime = native(2),
    program = native(1, programCalls);
  return {
    abi: darwinHostABI(),
    allocator: {
      native: {
        ...allocator,
        functions: allocator.functions.map((fn, id) => ({
          ...fn,
          signature: {
            parameters:
              id === 0
                ? [
                    { kind: "float", index: 0 },
                    { kind: "float", index: 1 },
                    { kind: "integer", index: 4 },
                  ]
                : [{ kind: "float", index: 0 }],
            stackBytes: 0,
          },
        })),
      },
      initialize: 0,
      allocate: 1,
      environmentBytes: 256,
    },
    runtime: {
      native: {
        ...runtime,
        functions: runtime.functions.map((fn, id) => ({
          ...fn,
          signature:
            id === 0
              ? {
                  parameters: [
                    ...Array.from({ length: 8 }, (_, index) => ({
                      kind: "float" as const,
                      index,
                    })),
                    ...Array.from({ length: 4 }, (_, index) => ({
                      kind: "integer" as const,
                      index: index + 4,
                    })),
                    ...Array.from({ length: 3 }, (_, index) => ({
                      kind: "stack" as const,
                      index: index * 8,
                    })),
                  ],
                  stackBytes: 32,
                }
              : fn.signature,
        })),
      },
      entry: 0,
    },
    program: { native: program, entry: 0 },
    managedBytes: 65536,
    controlBytes: 16384,
    allocationCapacity: 128,
    rootCapacity: 256,
    stackBytes: 1048576,
    pageSize: 16384,
    diagnostics,
  };
}

test("hosted composition patches diagnostics calls, entries and exports", () => {
  const plain = emitHostedEntry(hosted(undefined));
  assert.ok(plain.ok, JSON.stringify(plain));
  assert.equal(plain.value.diagnostics, undefined);
  assert.equal(
    emitHostedEntry(hosted(undefined, [{ offset: 4, target: "trace-capture" }]))
      .ok,
    false,
    "a traced module needs the stack-trace routines",
  );
  const result = emitHostedEntry(
    hosted(
      {
        stackTraces: true,
        signposts: [{ module: 1, offset: 16, name: 5, stackBytes: 0 }],
        allocationSignposts: true,
        jitDebug: true,
      },
      [{ offset: 4, target: "trace-capture" }],
    ),
  );
  assert.ok(result.ok, JSON.stringify(result));
  const value = result.value,
    extra = value.diagnostics;
  assert.ok(extra !== undefined);
  assert.equal(extra.tableOffset, value.code.length);
  assert.equal(extra.data.length, diagnosticDataBytes);
  assert.equal(extra.data[diagnosticJitDescriptorOffset], 1);
  assert.deepEqual(
    extra.codeSymbols.map((s) => s.name),
    ["___jit_debug_register_code"],
  );
  assert.deepEqual(extra.dataSymbols, [
    { name: "___jit_debug_descriptor", offset: diagnosticJitDescriptorOffset },
  ]);
  const routines = new Map(extra.routines.map((r) => [r.name, r.offset]));
  const programBase = value.moduleOffsets[2] ?? 0,
    runtimeBase = value.moduleOffsets[1] ?? 0;
  assert.equal(
    branchTarget(value.code, programBase + 4),
    routines.get("tint:diagnostics:trace-capture"),
  );
  assert.equal(
    branchTarget(value.code, runtimeBase + 16),
    routines.get("tint:diagnostics:signpost-thunk-0"),
  );
  // The other runtime function keeps its own frame push.
  assert.equal(word(value.code, runtimeBase), framePush());
  // Every routine has call-frame rows, in address order.
  let previous = 0;
  for (const range of extra.unwind) {
    assert.ok(range.offset >= previous);
    previous = range.offset + range.byteLength;
  }
  assert.ok(value.imports.some((i) => i.target.name === "_os_log_create"));
  const missingPush = hosted({
    stackTraces: false,
    signposts: [{ module: 1, offset: 20, name: 5, stackBytes: 0 }],
    allocationSignposts: false,
    jitDebug: false,
  });
  assert.deepEqual(emitHostedEntry(missingPush), {
    ok: false,
    error: "signposted function lacks a frame push",
  });
});
