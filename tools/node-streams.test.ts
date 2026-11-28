import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const source = `
import Stream, { Readable, Writable } from "node:stream";
import { pipeline, finished } from "node:stream/promises";
import { ReadableStream, WritableStream, TransformStream } from "node:stream/web";
import { setImmediate } from "node:timers";
import { Buffer } from "node:buffer";
export async function run(): Promise<number> {
  if (Stream.Readable !== Readable || (await import("node:stream")).Writable !== Writable) return 1;
  let release;
  const turns: string[] = [];
  const sink = new Writable({ objectMode: true, highWaterMark: 1, write(chunk, _encoding, done) {
    turns.push("write:" + chunk);
    release = done;
  } });
  sink.on("drain", () => { turns.push("drain"); });
  if (sink.write(1, () => turns.push("callback")) !== false || !sink.writableNeedDrain) return 2;
  turns.push("returned");
  release();
  sink.end();
  await finished(sink);
  if (turns.join(",") !== "write:1,returned,drain,callback") return 3;
  const output: number[] = [];
  async function* producer() {
    yield 2;
    await Promise.resolve();
    yield 3;
  }
  const source = Readable.from(producer(), {highWaterMark: 1});
  await pipeline(source, new Writable({ objectMode: true, highWaterMark: 1,
    write(chunk, _encoding, done) { setImmediate(() => { output.push(chunk); done(); }); }
  }));
  if (output.join(",") !== "2,3" || !source.readableEnded) return 4;
  const piped = Readable.from([4, 5], {highWaterMark: 1});
  const destination = new Writable({ objectMode: true, highWaterMark: 1,
    write(chunk, _encoding, done) { setImmediate(() => { output.push(chunk); done(); }); }
  });
  piped.pause();
  if (!piped.isPaused() || piped.pipe(destination) !== destination) return 5;
  await finished(destination);
  if (output.join(",") !== "2,3,4,5") return 6;
  const controller = new AbortController();
  const blocked = new Readable({ objectMode: true, read() {} });
  const ending = pipeline(blocked, new Writable({objectMode:true, write(_chunk, _enc, done) {done();}}), {signal:controller.signal});
  controller.abort("cancel");
  try { await ending; return 7; } catch (error) {
    if (error.code !== "ABORT_ERR" || !blocked.destroyed) return 8;
  }
  const iterated: number[] = [];
  for await (const value of Readable.from([6,7])) iterated.push(value);
  if (iterated.join(",") !== "6,7") return 9;
  if (ReadableStream !== globalThis.ReadableStream || WritableStream !== globalThis.WritableStream) return 10;
  let next = 0;
  const webSource = new ReadableStream({ pull(controller) {
    if (next === 3) controller.close();
    else controller.enqueue(next++);
  } }, {highWaterMark: 1});
  const webSink = new WritableStream({ async write(value) {
    await Promise.resolve();
    output.push(value);
  } }, {highWaterMark: 1});
  await webSource.pipeTo(webSink);
  if (output.slice(-3).join(",") !== "0,1,2" || webSource.locked || webSink.locked) return 11;
  const doubled = new TransformStream({ transform(value, controller) {controller.enqueue(value * 2);} });
  const webValues: number[] = [];
  await new ReadableStream({ start(controller) {controller.enqueue(9);controller.enqueue(10);controller.close();} })
    .pipeThrough(doubled).pipeTo(new WritableStream({write(value){webValues.push(value);}}));
  if (webValues.join(",") !== "18,20" || TransformStream !== globalThis.TransformStream) return 12;
  const expected = new Error("sink failed");
  const input = Readable.from([1, 2]);
  const broken = new Writable({objectMode: true, write(_chunk, _encoding, done) { done(expected); }});
  try { await pipeline(input, broken); return 13; } catch (error) {
    if (error !== expected || !input.closed || !broken.closed) return 14;
  }
  let writeComplete;
  const writer = new WritableStream({write() { return new Promise(resolve => { writeComplete = resolve; }); }},
    {highWaterMark: 1}).getWriter();
  const writing = writer.write("queued");
  let ready = false;
  const capacity = writer.ready.then(() => {ready = true;});
  await Promise.resolve();
  await Promise.resolve();
  if (ready || writer.desiredSize !== 0 || typeof writeComplete !== "function") return 15;
  writeComplete();
  await writing;
  await capacity;
  if (!ready || writer.desiredSize !== 1) return 16;
  await writer.close();
  writer.releaseLock();
  const stopped = new AbortController();
  const waiting = new ReadableStream({pull() {}});
  const consumer = new WritableStream();
  const piping = waiting.pipeTo(consumer, {signal: stopped.signal});
  stopped.abort(expected);
  try { await piping; return 17; } catch (error) {
    if (error !== expected || waiting.locked || consumer.locked) return 18;
  }
  const binary: string[] = [];
  await pipeline(Readable.from(["a", "β"]), new Writable({write(chunk, encoding, done) {
    if (!Buffer.isBuffer(chunk) || encoding !== "buffer") { done(new Error("Expected a Buffer")); return; }
    binary.push(chunk.toString("hex"));
    done();
  }}));
  if (binary.join(",") !== "61,ceb2") return 19;
  return 42;
}
`;

test("stream lifecycle and Web identity match Node", async () => {
  const fixture = (await import(
    "data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source))
  )) as { run(): Promise<number> };
  assert.equal(await fixture.run(), 42);
});

test("typed and untyped stream consumers share the native scheduler", () => {
  const compiled: { general?: readonly string[] } = {};
  verifyHostedFixture(
    source,
    "m1p8-streams",
    [
      ["node:stream", "packages/native-runtime/src/node/stream.ts"],
      [
        "node:stream/promises",
        "packages/native-runtime/src/node/stream-promises.ts",
      ],
      ["node:stream/web", "packages/native-runtime/src/node/stream-web.ts"],
      ["node:timers", "packages/native-runtime/src/node/timers.ts"],
      ["node:buffer", "packages/native-runtime/src/node/buffer.ts"],
    ],
    [],
    [],
    [],
    {
      nodeEventLoop: true,
      managedBytes: 134217728,
      allocationCapacity: 1048576,
      onGeneralFallback(modules) {
        compiled.general = modules;
      },
    },
  );
  assert.ok(
    compiled.general?.includes("packages/native-runtime/src/node/stream.ts"),
  );
  assert.equal(
    compiled.general?.includes("packages/native-runtime/src/node/buffer.ts"),
    false,
  );
});
