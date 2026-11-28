import { EventEmitter, on, once } from "node:events";

// Checked by tsconfig.host.json with Node and DOM ambient types disabled.
const message = Symbol("message");
interface Messages {
  [message]: [number, string];
  close: [];
}

const emitter = new EventEmitter<Messages>();
emitter.on(message, (value, text) => {
  value.toFixed();
  text.toUpperCase();
});
emitter.emit(message, 42, "ok");
// @ts-expect-error The event name must be in the event map.
emitter.on("missing", () => {});
// @ts-expect-error Emitted arguments must match the event's tuple.
emitter.emit(message, "wrong", 42);
// @ts-expect-error Listeners must accept the event's argument types.
emitter.on(message, (value: string) => value.toUpperCase());
// @ts-expect-error Static helpers enforce the same event map.
once(emitter, "missing");
const pending: Promise<[number, string]> = once(emitter, message);
const messages: AsyncIterableIterator<[number, string]> = on(emitter, message);

const target = new EventTarget<{ update: CustomEvent<number> }>();
target.addEventListener("update", (event) => event.detail.toFixed());
// @ts-expect-error A typed target admits only names in its event map.
target.addEventListener("missing", () => {});
const update: Promise<[CustomEvent<number>]> = once(target, "update");
void [pending, messages, update];
