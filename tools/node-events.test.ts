import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const typedHelper =
  "export function negate(value: number): number { return -value; }";
const source = `
import Events, { EventEmitter, addAbortListener, captureRejectionSymbol, errorMonitor, getEventListeners, once, on, setMaxListeners } from "node:events";
import { negate } from "./typed.ts";
interface Messages { message: [number]; close: []; }
export async function run(): Promise<number> {
  if (Events !== EventEmitter) return 1;
  const emitter = new EventEmitter<Messages>();
  const seen: number[] = [];
  emitter.once("message", (value: number): void => { seen.push(value); });
  emitter.prependListener("message", (value: number): void => { seen.push(negate(value)); });
  const waiting = once(emitter, "message");
  const events = on(emitter, "message", { close: ["close"] });
  emitter.emit("message", 2);
  emitter.emit("message", 3);
  emitter.emit("close");
  if (seen.join(",") !== "-2,2,-3" || (await waiting)[0] !== 2) return 2;
  if ((await events.next()).value[0] !== 2 || (await events.next()).value[0] !== 3) return 3;
  if (!(await events.next()).done || emitter.listenerCount("message") !== 1) return 4;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal]);
  const target = new EventTarget();
  let calls = 0;
  target.addEventListener("data", (event) => {
    if (event instanceof CustomEvent && event.detail === 7) calls++;
    event.preventDefault();
  }, { passive: true, signal });
  const abortOrder = [];
  addAbortListener(controller.signal, event => { abortOrder.push(event.target === controller.signal); });
  controller.signal.addEventListener("abort", event => {
    event.stopImmediatePropagation();
    abortOrder.push(signal.aborted);
  });
  const canceled = addAbortListener(controller.signal, () => { calls += 100; });
  canceled[Symbol.dispose]();
  addAbortListener(controller.signal, event => {
    calls++;
    abortOrder.push(event.target === controller.signal);
  });
  if (getEventListeners(target, "data").length !== 1) return 8;
  if (!target.dispatchEvent(new CustomEvent("data", { detail: 7, cancelable: true }))) return 5;
  const interrupted = once(target, "data", { signal: controller.signal });
  interrupted.catch(() => {});
  controller.abort("closed");
  target.dispatchEvent(new CustomEvent("data", { detail: 7 }));
  if (!signal.aborted || signal.reason !== "closed" || calls !== 2) return 6;
  if (abortOrder.join(",") !== "true,true,true") return 9;
  if (getEventListeners(target, "data").length !== 0) return 10;
  try {
    await interrupted;
    return 11;
  } catch (error) {
    if (error.code !== "ABORT_ERR" || error.name !== "AbortError" || error.cause !== "closed") return 12;
  }
  if (!(AbortSignal.abort().reason instanceof DOMException)) return 7;
  const err = new Error("missing");
  const untyped = new EventEmitter();
  let watched;
  untyped.on(errorMonitor, value => { watched = value; });
  try {
    untyped.emit("error", err);
    return 13;
  } catch (error) {
    if (error !== err || watched !== err) return 14;
  }
  try {
    untyped.on("broken", null);
    return 15;
  } catch (error) {
    if (!(error instanceof TypeError) || error.code !== "ERR_INVALID_ARG_TYPE") return 16;
  }
  setMaxListeners(2, untyped, target);
  if (untyped.getMaxListeners() !== 2 || Events.getMaxListeners(target) !== 2) return 17;
  const captured = new EventEmitter({ captureRejections: true });
  const rejected = new Promise(resolve => {
    captured[captureRejectionSymbol] = (reason, name, argument) => {
      resolve(reason === err && name === "async" && argument === 9);
    };
  });
  captured.on("async", () => Promise.reject(err));
  captured.emit("async", 9);
  if (!(await rejected)) return 18;
  const listeners = new EventEmitter();
  const late = () => seen.push(9);
  const later = () => seen.push(10);
  listeners.prependOnceListener("mutable", () => {
    listeners.removeListener("mutable", late);
    listeners.on("mutable", later);
    listeners.emit("mutable");
  });
  listeners.on("mutable", late);
  if (listeners.rawListeners("mutable")[0].listener !== listeners.listeners("mutable")[0]) return 19;
  listeners.emit("mutable");
  if (seen.slice(-2).join(",") !== "10,9") return 20;
  listeners.off("mutable", later);
  if (listeners.eventNames().length !== 0) return 21;
  return 42;
}
`;

test("events fixture matches Node", async () => {
  const helper =
    "data:text/javascript," +
    encodeURIComponent(stripTypeScriptTypes(typedHelper));
  const js = stripTypeScriptTypes(source.replace("./typed.ts", helper));
  const fixture = (await import(
    "data:text/javascript," + encodeURIComponent(js)
  )) as {
    run(): Promise<number>;
  };
  assert.equal(await fixture.run(), 42);
});

test("node:events and Web event globals share a native realm", () => {
  const helperId = "fixture:typed-events-helper";
  const parsed = parseModule(createSourceTextView(typedHelper));
  assert.ok(parsed.ok);
  const observed: { partition?: readonly string[] } = {};
  verifyHostedFixture(
    source,
    "m1p3-events",
    [
      ["node:events", "packages/native-runtime/src/node/events.ts"],
      ["./typed.ts", helperId],
    ],
    [{ id: helperId, module: parsed.value, dependencies: new Map() }],
    [],
    [{ module: helperId, namespace: "typed-events-fixture" }],
    {
      managedBytes: 33554432,
      allocationCapacity: 524288,
      onGeneralFallback(modules) {
        observed.partition = modules;
      },
    },
  );
  const partition = observed.partition;
  assert.ok(partition);
  assert.ok(partition.includes("fixture"));
  assert.ok(!partition.includes(helperId));
});
