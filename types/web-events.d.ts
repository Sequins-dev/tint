/// <reference lib="esnext.disposable" />

/** Standard Web event globals supplied by each Tint realm. */
interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}
interface CustomEventInit<Detail = unknown> extends EventInit {
  detail?: Detail;
}
declare class Event {
  constructor(type: string, options?: EventInit);
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  readonly timeStamp: number;
  readonly isTrusted: boolean;
  readonly eventPhase: number;
  readonly target: EventTarget | null;
  readonly currentTarget: EventTarget | null;
  readonly srcElement: EventTarget | null;
  readonly defaultPrevented: boolean;
  cancelBubble: boolean;
  returnValue: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  composedPath(): EventTarget[];
  initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void;
  static readonly NONE: 0;
  static readonly CAPTURING_PHASE: 1;
  static readonly AT_TARGET: 2;
  static readonly BUBBLING_PHASE: 3;
}
declare class CustomEvent<Detail = unknown> extends Event {
  constructor(type: string, options?: CustomEventInit<Detail>);
  readonly detail: Detail;
}
interface EventListenerOptions {
  capture?: boolean;
}
interface AddEventListenerOptions extends EventListenerOptions {
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}
type EventListenerFor<E extends Event> =
  ((event: E) => void) | { handleEvent(event: E): void };
declare class EventTarget<
  Events extends Record<keyof Events, Event> = Record<string, Event>,
> {
  addEventListener<Name extends Extract<keyof Events, string>>(
    type: Name,
    callback: EventListenerFor<Events[Name]> | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<Name extends Extract<keyof Events, string>>(
    type: Name,
    callback: EventListenerFor<Events[Name]> | null,
    options?: boolean | EventListenerOptions,
  ): void;
  dispatchEvent(event: Event): boolean;
}
declare class DOMException extends Error {
  constructor(message?: string, name?: string);
  readonly code: number;
  static readonly ABORT_ERR: 20;
  static readonly DATA_CLONE_ERR: 25;
  static readonly INVALID_STATE_ERR: 11;
}
declare class AbortSignal extends EventTarget<{ abort: Event }> {
  private constructor();
  readonly aborted: boolean;
  readonly reason: unknown;
  onabort: ((event: Event) => void) | null;
  throwIfAborted(): void;
  static abort(reason?: unknown): AbortSignal;
  static any(signals: Iterable<AbortSignal>): AbortSignal;
}
declare class AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}
