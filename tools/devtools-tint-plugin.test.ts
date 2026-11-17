// The DevTools bridge's Tint plugin on a Tint debug build
// (tools/devtools-fixture.ts): values as JavaScript RemoteObjects, frame
// names, heap snapshots streamed as chunks, sampling heap profiles through
// the allocation hook, and forced major collections at a safepoint.
import assert from "node:assert/strict";
import test from "node:test";
import { findLldbDap } from "./devtools/backend.ts";
import { TintPlugin, tintFrameName } from "./devtools/tint-plugin.ts";
import {
  fixtureLines,
  localScope,
  properties,
  tintSession,
  type Frame,
  type Property,
} from "./devtools-fixture.ts";

const available = findLldbDap() !== undefined;

const byName = (list: Property[], name: string): Property["value"] => {
  const found = list.find((property) => property.name === name);
  assert.ok(found !== undefined, name + " in " + JSON.stringify(list));
  return found.value;
};

test("Tint frame names drop module prefixes and suffixes", () => {
  assert.equal(tintFrameName("program:fixture:run [@1:value:3$255]"), "run");
  assert.equal(tintFrameName("fixture:weight"), "weight");
  assert.equal(tintFrameName("program:__tint_invoke$256"), "__tint_invoke");
  assert.equal(
    tintFrameName("packages/native-runtime/src/generational.ts:collect"),
    "collect",
  );
  assert.equal(tintFrameName("tint:process-entry"), "tint:process-entry");
  assert.equal(tintFrameName("start"), "start");
});

test(
  "Tint plugin formats strings, lists, records, Map, Set and generals",
  { skip: !available && "needs lldb-dap", timeout: 300000 },
  async () => {
    const { client, url, close } = await tintSession("devtools-values", [
      new TintPlugin(),
    ]);
    try {
      await client.send("Debugger.setBreakpointByUrl", {
        url,
        lineNumber: fixtureLines.inspect - 1,
      });
      const mark = client.events.length;
      await client.send("Runtime.runIfWaitingForDebugger");
      const paused = await client.next(
        "Debugger.paused",
        () => true,
        60000,
        mark,
      );
      const frames = paused.params.callFrames as Frame[];
      assert.equal(frames[0]?.functionName, "inspect");
      assert.equal(frames[1]?.functionName, "run");
      const locals = await properties(client, localScope(frames[0]));
      const holder = byName(locals, "holder");
      assert.equal(holder.type, "object");
      assert.equal(holder.className, "Object");
      assert.match(
        holder.description ?? "",
        /^\{items, names, numbers, index, tags, anything, note\}$/,
      );
      const fields = await properties(client, holder.objectId);
      assert.ok(
        !fields.some((field) => field.name.startsWith("__")),
        "no header",
      );
      const items = byName(fields, "items");
      assert.deepEqual(
        [items.subtype, items.className, items.description],
        ["array", "Array", "Array(3)"],
      );
      const elements = await properties(client, items.objectId);
      assert.deepEqual(
        elements.map((element) => element.name),
        ["0", "1", "2"],
      );
      const third = await properties(client, byName(elements, "2").objectId);
      assert.deepEqual(
        third.map((field) => [field.name, field.value.type, field.value.value]),
        [
          ["x", "number", 2],
          ["y", "number", 4],
          ["label", "string", "p2"],
        ],
      );
      const names = await properties(client, byName(fields, "names").objectId);
      assert.deepEqual(
        names.map((entry) => entry.value.value),
        ["alpha", "beta"],
      );
      const numbers = await properties(
        client,
        byName(fields, "numbers").objectId,
      );
      assert.deepEqual(
        numbers.map((entry) => entry.value.value),
        [1.5, 2.5, 3.5],
      );
      const index = byName(fields, "index");
      assert.deepEqual([index.subtype, index.className], ["map", "Map"]);
      const entries = await properties(client, index.objectId);
      assert.deepEqual(
        entries.map((entry) => [entry.name, entry.value.description]),
        [
          ["first", "{x, y, label}"],
          ["second", "{x, y, label}"],
        ],
      );
      const tags = byName(fields, "tags");
      assert.deepEqual([tags.subtype, tags.className], ["set", "Set"]);
      assert.deepEqual(
        (await properties(client, tags.objectId)).map(
          (entry) => entry.value.value,
        ),
        ["red", "green"],
      );
      assert.deepEqual(byName(fields, "note"), {
        type: "string",
        value: "dynamic",
      });
      // A general value holding an object expands to the object's fields.
      const anything = byName(fields, "anything");
      assert.equal(anything.description, "{x, y, label}");
      const general = await properties(client, anything.objectId);
      assert.deepEqual(
        general.map((field) => [field.name, field.value.value]),
        [
          ["x", 2],
          ["y", 4],
          ["label", "p2"],
        ],
      );
      // An opaque reference retyped from its header.
      const retained = byName(locals, "retained");
      assert.equal(retained.description, "{value, next}");
      const node = await properties(client, retained.objectId);
      assert.deepEqual(byName(node, "value"), {
        type: "number",
        value: 4999,
        description: "4999",
      });
      assert.equal(byName(node, "next").description, "{value, next}");
    } finally {
      await close();
    }
  },
);

interface Snapshot {
  snapshot: {
    meta: { node_fields: string[]; edge_fields: string[] };
    node_count: number;
    edge_count: number;
  };
  nodes: number[];
  edges: number[];
  strings: string[];
}
interface HeapNode {
  callFrame: { functionName: string; url: string; scriptId: string };
  selfSize: number;
  id: number;
  children: HeapNode[];
}

test(
  "Tint plugin: heap snapshots, sampling heap profiles and collectGarbage",
  { skip: !available && "needs lldb-dap", timeout: 300000 },
  async () => {
    const { client, url, session, close } = await tintSession("devtools-heap", [
      new TintPlugin(),
    ]);
    try {
      await client.send("HeapProfiler.enable");
      const inspect = await client.send<{ breakpointId: string }>(
        "Debugger.setBreakpointByUrl",
        { url, lineNumber: fixtureLines.inspect - 1 },
      );
      let mark = client.events.length;
      await client.send("Runtime.runIfWaitingForDebugger");
      await client.next("Debugger.paused", () => true, 60000, mark);

      // A snapshot while paused: streamed chunks, then the pause again.
      mark = client.events.length;
      await client.send("HeapProfiler.takeHeapSnapshot", {
        reportProgress: true,
      });
      const chunks = client.events
        .slice(mark)
        .filter((event) => event.method === "HeapProfiler.addHeapSnapshotChunk")
        .map((event) => String(event.params.chunk));
      assert.ok(chunks.length > 0);
      const progress = client.events
        .slice(mark)
        .filter(
          (event) => event.method === "HeapProfiler.reportHeapSnapshotProgress",
        );
      assert.equal(progress.at(-1)?.params.finished, true);
      const repaused = await client.next(
        "Debugger.paused",
        () => true,
        10000,
        mark,
      );
      assert.equal(
        (repaused.params.callFrames as Frame[])[0]?.functionName,
        "inspect",
      );
      const snapshot = JSON.parse(chunks.join("")) as Snapshot;
      const nodeFields = snapshot.snapshot.meta.node_fields.length;
      assert.equal(
        snapshot.nodes.length,
        snapshot.snapshot.node_count * nodeFields,
      );
      assert.equal(
        snapshot.edges.length,
        snapshot.snapshot.edge_count *
          snapshot.snapshot.meta.edge_fields.length,
      );
      let chain = 0,
        edges = 0;
      for (let at = 0; at < snapshot.nodes.length; at += nodeFields) {
        if (snapshot.strings[snapshot.nodes[at + 1] ?? 0] === "{value, next}")
          chain++;
        edges += snapshot.nodes[at + 4] ?? 0;
      }
      assert.equal(edges, snapshot.snapshot.edge_count);
      assert.equal(chain, 5000, "the retained chain, exactly");
      assert.ok(
        snapshot.strings.includes("p2") &&
          snapshot.strings.includes("(Stack roots)"),
      );
      // Root frames by source name: inspect's and run's frames.
      assert.ok(
        snapshot.strings.some((text) => /^inspect \(fixture:\d+\)$/.test(text)),
        snapshot.strings.filter((text) => /fixture/.test(text)).join("\n"),
      );

      // Heap usage while paused.
      const usage = await client.send<{ usedSize: number; totalSize: number }>(
        "Runtime.getHeapUsage",
      );
      assert.ok(usage.usedSize > 120000 && usage.totalSize >= usage.usedSize);

      // Sampling heap profile across the allocation-heavy tail.
      await client.send("Debugger.removeBreakpoint", {
        breakpointId: inspect.breakpointId,
      });
      await client.send("HeapProfiler.startSampling", {
        samplingInterval: 65536,
      });
      mark = client.events.length;
      await client.send("Debugger.resume");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const partial = await client.send<{ profile: { samples: unknown[] } }>(
        "HeapProfiler.getSamplingProfile",
      );
      assert.ok(partial.profile.samples.length > 0, "samples while running");
      const sampled = await client.send<{
        profile: {
          head: HeapNode;
          samples: { nodeId: number; size: number }[];
        };
      }>("HeapProfiler.stopSampling");
      assert.ok(
        !client.events
          .slice(mark)
          .some((event) => event.method === "Debugger.paused"),
        "sampling never pauses the frontend",
      );
      const nodes = new Map<number, HeapNode>();
      let makeChain = 0,
        total = 0;
      const walk = (node: HeapNode, inChain: boolean): void => {
        nodes.set(node.id, node);
        const here = inChain || node.callFrame.functionName === "makeChain";
        total += node.selfSize;
        if (here) makeChain += node.selfSize;
        for (const child of node.children) walk(child, here);
      };
      walk(sampled.profile.head, false);
      assert.ok(sampled.profile.samples.length > 10);
      for (const sample of sampled.profile.samples)
        assert.ok(nodes.has(sample.nodeId));
      assert.ok(
        makeChain > total * 0.9,
        `${makeChain} of ${total} in makeChain`,
      );
      const frame = [...nodes.values()].find(
        (node) => node.callFrame.functionName === "makeChain",
      );
      assert.equal(frame?.callFrame.url, url);
      assert.notEqual(frame?.callFrame.scriptId, "0");

      // A forced major collection while the tail runs: no pause shows.
      mark = client.events.length;
      await client.send("HeapProfiler.collectGarbage");
      assert.ok(
        !client.events
          .slice(mark)
          .some((event) => event.method === "Debugger.paused"),
      );
      // And while paused mid-tail: the nursery is evacuated and only live
      // data stays in the old space.
      mark = client.events.length;
      await client.send("Debugger.pause");
      await client.next("Debugger.paused", () => true, 30000, mark);
      const info = async (): Promise<{
        state: { youngTop: number; oldTop: number };
      }> =>
        JSON.parse(
          (await session.bridge.command("tint-heap info --json")).trim(),
        ) as {
          state: { youngTop: number; oldTop: number };
        };
      const before = await info();
      mark = client.events.length;
      await client.send("HeapProfiler.collectGarbage");
      await client.next("Debugger.paused", () => true, 10000, mark);
      const after = await info();
      assert.equal(after.state.youngTop, 0, "nursery evacuated");
      assert.ok(
        after.state.oldTop < 1 << 20,
        `live old space ${after.state.oldTop}`,
      );
      assert.ok(
        after.state.oldTop + after.state.youngTop <
          before.state.oldTop + before.state.youngTop,
      );
      // The program still completes correctly.
      mark = client.events.length;
      await client.send("Debugger.resume");
      await client.next(
        "Runtime.executionContextDestroyed",
        () => true,
        120000,
        mark,
      );
      assert.equal(session.bridge.exitStatus(), 42);
      await assert.rejects(
        client.send("HeapProfiler.collectGarbage", {}, 5000),
        /exited/,
      );
    } finally {
      await close();
    }
  },
);
