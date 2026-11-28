import process, { nextTick } from "node:process";
import { setImmediate, setTimeout } from "node:timers";
import { setInterval, setTimeout as delay } from "node:timers/promises";
import nodeConsole, { Console } from "node:console";

const timer = setTimeout((message: string) => console.log(message), 10, "ok");
timer.ref().refresh()[Symbol.dispose]();
nextTick((value: number) => nodeConsole.log("%d", value), 1);
setImmediate(() => process.cwd()).unref();
const current: string = process.platform;
const timeout: Promise<number> = delay(1, 42, {
  signal: new AbortController().signal,
});
const ticks: AsyncIterableIterator<string> = setInterval(10, "tick", {
  ref: false,
});
new Console({ stdout: { write: (text) => console.log(text) } }).dir({
  current,
});
void [timeout, ticks];
// @ts-expect-error The process object is available only via ESM import.
globalThis.process;
// @ts-expect-error Node immediates are available only via ESM import.
globalThis.setImmediate;
// @ts-expect-error Timer arguments retain the callback's parameter types.
setTimeout((value: number) => console.log(value), 10, "wrong");
// @ts-expect-error Timer options expect a standard AbortSignal.
delay(1, 42, { signal: {} });
