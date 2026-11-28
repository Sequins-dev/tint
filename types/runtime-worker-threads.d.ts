interface StructuredSerializeOptions {
  transfer?: readonly ArrayBuffer[];
}
declare function structuredClone<T>(
  value: T,
  options?: StructuredSerializeOptions,
): T;

declare module "node:worker_threads" {
  export type Transferable = ArrayBuffer | MessagePort;
  export interface ResourceLimits {
    maxYoungGenerationSizeMb?: number;
    maxOldGenerationSizeMb?: number;
    codeRangeSizeMb?: number;
    stackSizeMb?: number;
  }
  export interface WorkerOptions {
    workerData?: unknown;
    transferList?: readonly Transferable[];
    resourceLimits?: ResourceLimits;
  }
  interface PortEvents {
    message: [value: unknown];
    messageerror: [error: unknown];
    close: [];
  }
  interface WorkerEvents {
    message: [value: unknown];
    messageerror: [error: unknown];
    online: [];
    exit: [code: number];
    error: [error: Error];
  }
  export class MessagePort {
    private constructor();
    postMessage(value: unknown, transferList?: readonly Transferable[]): void;
    start(): void;
    close(callback?: () => void): void;
    ref(): void;
    unref(): void;
    hasRef(): boolean;
    on<K extends keyof PortEvents>(
      event: K,
      listener: (...args: PortEvents[K]) => void,
    ): this;
    once<K extends keyof PortEvents>(
      event: K,
      listener: (...args: PortEvents[K]) => void,
    ): this;
  }
  export class MessageChannel {
    readonly port1: MessagePort;
    readonly port2: MessagePort;
  }
  export class Worker {
    constructor(filename: string, options?: WorkerOptions);
    readonly threadId: number;
    readonly resourceLimits: ResourceLimits;
    postMessage(value: unknown, transferList?: readonly Transferable[]): void;
    terminate(): Promise<number | undefined>;
    ref(): void;
    unref(): void;
    on<K extends keyof WorkerEvents>(
      event: K,
      listener: (...args: WorkerEvents[K]) => void,
    ): this;
    once<K extends keyof WorkerEvents>(
      event: K,
      listener: (...args: WorkerEvents[K]) => void,
    ): this;
  }
  export const isMainThread: boolean;
  export const isInternalThread: boolean;
  export const threadId: number;
  export const parentPort: MessagePort | null;
  export const workerData: unknown;
  export const resourceLimits: ResourceLimits;
  export function receiveMessageOnPort(
    port: MessagePort,
  ): { message: unknown } | undefined;
  const workers: {
    Worker: typeof Worker;
    MessagePort: typeof MessagePort;
    MessageChannel: typeof MessageChannel;
    isMainThread: typeof isMainThread;
    isInternalThread: typeof isInternalThread;
    threadId: typeof threadId;
    parentPort: typeof parentPort;
    workerData: typeof workerData;
    resourceLimits: typeof resourceLimits;
    receiveMessageOnPort: typeof receiveMessageOnPort;
  };
  export default workers;
}
