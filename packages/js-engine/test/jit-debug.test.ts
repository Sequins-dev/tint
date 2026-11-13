import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createJitDebugRegistrar,
  type JitDebuggerHost,
  type JitPerfMapHost,
} from "../src/native/jit-debug.ts";

/** Simulated process memory: whole 64-bit words and byte copies in mapped
 * windows, plus the image's 24-byte descriptor. */
function memory(): {
  host: JitDebuggerHost;
  words: Map<number, number>;
  bytes: Map<number, Uint8Array>;
  notifications: { action: number; relevant: number; first: number }[];
} {
  const words = new Map<number, number>(),
    bytes = new Map<number, Uint8Array>(),
    notifications: { action: number; relevant: number; first: number }[] = [];
  const descriptor = 0x1000;
  words.set(descriptor, 1);
  let next = 0x100000;
  const host: JitDebuggerHost = {
    map: (length) => {
      const address = next;
      next += length;
      return address;
    },
    write: (address, length, offset, data) => {
      if (offset + data.length > length) return -1;
      bytes.set(address + offset, data.slice());
      return 0;
    },
    readWord: (address, length, offset) =>
      offset + 8 > length ? -1 : (words.get(address + offset) ?? 0),
    writeWord: (address, length, offset, value) => {
      if (offset + 8 > length) return -1;
      words.set(address + offset, value);
      return 0;
    },
    descriptor: () => descriptor,
    notify: () => {
      const header = words.get(descriptor) ?? 0;
      notifications.push({
        action: Math.floor(header / 4294967296),
        relevant: words.get(descriptor + 8) ?? 0,
        first: words.get(descriptor + 16) ?? 0,
      });
    },
  };
  return { host, words, bytes, notifications };
}
const code = new Uint8Array([0x1f, 0x20, 0x03, 0xd5, 0xc0, 0x03, 0x5f, 0xd6]);
function description(address: number, name: string) {
  return {
    address,
    code,
    functions: [{ name, offset: 0, byteLength: 8 }],
    lines: [{ offset: 0, byteLength: 4, file: "jit.ts", line: 1, column: 1 }],
    directory: "/",
  };
}

test("registration links entries into the JIT descriptor and notifies", () => {
  const { host, words, bytes, notifications } = memory();
  const registrar = createJitDebugRegistrar({ debugger: host });
  const first = registrar.register(description(0x5000, "jit:a")),
    second = registrar.register(description(0x6000, "jit:b"));
  assert.ok(first > 0 && second > first);
  // Newest first; doubly linked; action reset to "none" after each call.
  assert.equal(words.get(0x1000 + 16), second);
  assert.equal(words.get(second), first);
  assert.equal(words.get(first + 8), second);
  assert.equal(words.get(0x1000), 1);
  assert.deepEqual(notifications, [
    { action: 1, relevant: first, first },
    { action: 1, relevant: second, first: second },
  ]);
  // The entry names its in-memory object, which describes the live code.
  const object = bytes.get(first + 32);
  assert.ok(object !== undefined);
  assert.equal(words.get(first + 16), first + 32);
  assert.equal(words.get(first + 24), object.length);
  assert.equal(
    new DataView(object.buffer, object.byteOffset).getUint32(0, true),
    0xfeedfacf,
  );
  assert.ok(registrar.unregister(second));
  assert.equal(words.get(0x1000 + 16), first);
  assert.equal(words.get(first + 8), 0);
  assert.deepEqual(notifications[2], {
    action: 2,
    relevant: second,
    first,
  });
  assert.equal(words.get(0x1000), 1);
  assert.equal(registrar.unregister(0), false);
  assert.equal(
    registrar.register({ ...description(0x7002, "jit:c") }),
    -1,
    "misaligned code is rejected",
  );
});

test("perf maps get one hexadecimal line per function, replacing stale files", () => {
  const files = new Map<string, string>(),
    removed: string[] = [];
  let created = 0;
  const host: JitPerfMapHost = {
    processId: () => 4242,
    create: (path) => {
      created++;
      if (created === 1) return -17; // EEXIST from an earlier process
      files.set(path, "");
      return 3;
    },
    remove: (path) => {
      removed.push(path);
      return 0;
    },
    write: (descriptor, data) => {
      assert.equal(descriptor, 3);
      const path = "/tmp/perf-4242.map";
      files.set(path, (files.get(path) ?? "") + new TextDecoder().decode(data));
      return data.length;
    },
  };
  const registrar = createJitDebugRegistrar({ perfMap: host });
  assert.equal(registrar.register(description(0x102be4000, "jit:sum")), 0);
  assert.equal(registrar.register(description(0x102be4100, "jit:product")), 0);
  assert.deepEqual(removed, ["/tmp/perf-4242.map"]);
  assert.equal(registrar.perfMapPath(), "/tmp/perf-4242.map");
  assert.equal(
    files.get("/tmp/perf-4242.map"),
    "102be4000 8 jit:sum\n102be4100 8 jit:product\n",
  );
});
