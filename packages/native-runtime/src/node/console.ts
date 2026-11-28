import { invalidArgument, outOfRange } from "./coded-errors.ts";
import {
  formatWithOptions,
  inspect,
  type InspectOptions,
} from "./util-inspect.ts";

interface Writer {
  write(text: string): unknown;
}
interface ConsoleOptions {
  readonly stdout: Writer;
  readonly stderr?: Writer;
  readonly ignoreErrors?: boolean;
  readonly colorMode?: boolean | "auto";
  readonly inspectOptions?: InspectOptions | Map<Writer, InspectOptions>;
  readonly groupIndentation?: number;
}

function isWriter(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "write") === "function"
  );
}
function toLabel(value: unknown): string {
  if (typeof value === "symbol")
    throw invalidArgument("label", "convertible to a string", value);
  return String(value);
}

export class Console {
  readonly #stdout: Writer;
  readonly #stderr: Writer;
  readonly #ignoreErrors: boolean;
  readonly #inspectOptions: InspectOptions | Map<Writer, InspectOptions>;
  readonly #indentation: number;
  readonly #counts = new Map<string, number>();
  readonly #times = new Map<string, number>();
  #depth = 0;

  constructor(
    stdoutOrOptions: Writer | ConsoleOptions,
    stderr?: Writer,
    ignoreErrors?: boolean,
  ) {
    const options =
      typeof stdoutOrOptions === "object" &&
      stdoutOrOptions !== null &&
      "write" in stdoutOrOptions
        ? {
            stdout: stdoutOrOptions,
            stderr,
            ignoreErrors,
            colorMode: undefined,
            inspectOptions: undefined,
            groupIndentation: undefined,
          }
        : stdoutOrOptions;
    if (options === undefined || options === null || !isWriter(options.stdout))
      throw invalidArgument("stdout", "a writable stream", options?.stdout);
    const errors = options.stderr ?? options.stdout;
    if (!isWriter(errors))
      throw invalidArgument("stderr", "a writable stream", errors);
    const indentation = options.groupIndentation ?? 2;
    if (!Number.isInteger(indentation) || indentation < 0 || indentation > 1000)
      throw outOfRange(
        "groupIndentation",
        "an integer between 0 and 1000",
        indentation,
      );
    const mode = options.colorMode;
    if (mode !== undefined && mode !== "auto" && typeof mode !== "boolean")
      throw invalidArgument("colorMode", "a boolean or 'auto'", mode);
    this.#stdout = options.stdout;
    this.#stderr = errors;
    this.#ignoreErrors = options.ignoreErrors !== false;
    this.#inspectOptions =
      options.inspectOptions ??
      (typeof mode === "boolean" ? { colors: mode } : {});
    this.#indentation = indentation;

    // Node methods remain usable when detached from the instance.
    for (const name of [
      "log",
      "info",
      "debug",
      "warn",
      "error",
      "dir",
      "dirxml",
      "assert",
      "group",
      "groupCollapsed",
      "groupEnd",
      "count",
      "countReset",
      "time",
      "timeLog",
      "timeEnd",
      "trace",
      "table",
      "clear",
    ]) {
      if (name === undefined) continue;
      const method: unknown = Reflect.get(this, name);
      if (typeof method === "function")
        Object.defineProperty(this, name, {
          value: method.bind(this),
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
  }

  #options(stream: Writer): InspectOptions {
    const options = this.#inspectOptions;
    return options instanceof Map ? (options.get(stream) ?? {}) : options;
  }

  #write(stream: Writer, text: string): void {
    const indent = " ".repeat(this.#indentation * this.#depth);
    const line =
      indent +
      (indent === "" ? text : text.split("\n").join("\n" + indent)) +
      "\n";
    try {
      stream.write(line);
    } catch (error) {
      if (!this.#ignoreErrors) throw error;
    }
  }

  log(...args: unknown[]): void {
    this.#write(
      this.#stdout,
      formatWithOptions(this.#options(this.#stdout), ...args),
    );
  }
  info(...args: unknown[]): void {
    this.log(...args);
  }
  debug(...args: unknown[]): void {
    this.log(...args);
  }
  warn(...args: unknown[]): void {
    this.error(...args);
  }
  error(...args: unknown[]): void {
    this.#write(
      this.#stderr,
      formatWithOptions(this.#options(this.#stderr), ...args),
    );
  }
  dir(value: unknown, options?: InspectOptions): void {
    this.#write(
      this.#stdout,
      inspect(value, {
        ...this.#options(this.#stdout),
        customInspect: false,
        ...options,
      }),
    );
  }
  dirxml(...args: unknown[]): void {
    this.log(...args);
  }
  assert(condition?: unknown, ...args: unknown[]): void {
    if (condition) return;
    if (args.length === 0) this.warn("Assertion failed");
    else if (typeof args[0] === "string")
      this.warn("Assertion failed: " + args[0], ...args.slice(1));
    else this.warn("Assertion failed:", ...args);
  }
  group(...args: unknown[]): void {
    if (args.length > 0) this.log(...args);
    this.#depth++;
  }
  groupCollapsed(...args: unknown[]): void {
    this.group(...args);
  }
  groupEnd(): void {
    if (this.#depth > 0) this.#depth--;
  }
  count(label: unknown = "default"): void {
    const name = toLabel(label);
    const count = (this.#counts.get(name) ?? 0) + 1;
    this.#counts.set(name, count);
    this.log("%s: %d", name, count);
  }
  countReset(label: unknown = "default"): void {
    this.#counts.delete(toLabel(label));
  }
  time(label: unknown = "default"): void {
    const name = toLabel(label);
    if (!this.#times.has(name)) this.#times.set(name, Date.now());
  }
  timeLog(label: unknown = "default", ...args: unknown[]): void {
    const name = toLabel(label);
    const start = this.#times.get(name);
    if (start !== undefined)
      this.log("%s: %dms", name, Date.now() - start, ...args);
  }
  timeEnd(label: unknown = "default"): void {
    this.timeLog(label);
    this.#times.delete(toLabel(label));
  }
  trace(...args: unknown[]): void {
    const error = new Error(
      formatWithOptions(this.#options(this.#stderr), ...args),
    );
    error.name = "Trace";
    this.#write(this.#stderr, error.stack ?? error.toString());
  }
  table(value: unknown): void {
    this.log(value);
  }
  clear(): void {}
}

// The host owns the existing realm console and line sinks. Keep the
// object identity and upgrade its methods when the Node module is loaded.
const logLine = console.log;
const errorLine = console.error;
const logger = new Console({
  stdout: {
    write(text: string): void {
      logLine(text.slice(0, -1));
    },
  },
  stderr: {
    write(text: string): void {
      errorLine(text.slice(0, -1));
    },
  },
});

export const {
  log,
  info,
  debug,
  warn,
  error,
  dir,
  dirxml,
  assert,
  group,
  groupCollapsed,
  groupEnd,
  count,
  countReset,
  time,
  timeLog,
  timeEnd,
  trace,
  table,
  clear,
} = logger;
export default Object.assign(console, {
  Console,
  log,
  info,
  debug,
  warn,
  error,
  dir,
  dirxml,
  assert,
  group,
  groupCollapsed,
  groupEnd,
  count,
  countReset,
  time,
  timeLog,
  timeEnd,
  trace,
  table,
  clear,
});
