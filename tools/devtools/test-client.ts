// A raw CDP client over Node's WebSocket, for tests that script the calls
// Chrome DevTools makes against the bridge.

export interface CdpEvent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

export class CdpTestClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  readonly events: CdpEvent[] = [];
  private readonly waiters: {
    method: string;
    filter: (params: Record<string, unknown>) => boolean;
    from: number;
    resolve: (event: CdpEvent) => void;
  }[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { code: number; message: string };
        method?: string;
        params?: Record<string, unknown>;
      };
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error !== undefined)
          entry?.reject(
            Object.assign(new Error(message.error.message), {
              code: message.error.code,
            }),
          );
        else entry?.resolve(message.result);
        return;
      }
      if (message.method === undefined) return;
      const cdpEvent = { method: message.method, params: message.params ?? {} };
      this.events.push(cdpEvent);
      for (const waiter of [...this.waiters])
        if (
          waiter.method === cdpEvent.method &&
          waiter.filter(cdpEvent.params)
        ) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(cdpEvent);
        }
    });
  }

  static connect(url: string): Promise<CdpTestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new CdpTestClient(socket)));
      socket.addEventListener("error", () =>
        reject(new Error("cannot connect to " + url)),
      );
    });
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: object = {},
    timeoutMs = 120000,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + " timed out"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** The next event of that name after the current mark (or since
   * `fromIndex`), optionally matching `filter`. */
  next(
    method: string,
    filter: (params: Record<string, unknown>) => boolean = () => true,
    timeoutMs = 120000,
    fromIndex = this.events.length,
  ): Promise<CdpEvent> {
    const seen = this.events
      .slice(fromIndex)
      .find((event) => event.method === method && filter(event.params));
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for " + method)),
        timeoutMs,
      );
      this.waiters.push({
        method,
        filter,
        from: fromIndex,
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
      });
    });
  }

  close(): void {
    this.socket.close();
  }
}
