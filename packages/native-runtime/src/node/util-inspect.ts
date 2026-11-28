import { invalidArgument } from "./coded-errors.ts";

export interface InspectOptions {
  readonly showHidden?: boolean;
  readonly depth?: number | null;
  readonly colors?: boolean;
  readonly customInspect?: boolean;
  readonly sorted?: boolean;
  readonly getters?: boolean | string;
  readonly maxArrayLength?: number | null;
  readonly maxStringLength?: number | null;
}

export const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

const defaultOptions: InspectOptions = {
  showHidden: false,
  depth: 2,
  colors: false,
  customInspect: true,
  sorted: false,
  getters: false,
  maxArrayLength: 100,
  maxStringLength: 10000,
};

function quote(input: string): string {
  const mark = !input.includes("'")
    ? "'"
    : !input.includes('"')
      ? '"'
      : !input.includes("`") && !input.includes("${")
        ? "`"
        : "'";
  let text = "";
  for (let i = 0; i < input.length; i++) {
    const char = input.charAt(i),
      code = input.charCodeAt(i);
    if (char === mark || char === "\\") text += "\\" + char;
    else if (char === "\n") text += "\\n";
    else if (char === "\r") text += "\\r";
    else if (char === "\t") text += "\\t";
    else if (code < 32 || code === 127)
      text += "\\x" + code.toString(16).padStart(2, "0");
    else if (code >= 55296 && code <= 57343) {
      const next = input.charCodeAt(i + 1);
      if (code <= 56319 && next >= 56320 && next <= 57343)
        text += char + input.charAt(++i);
      else text += "\\u" + code.toString(16).padStart(4, "0");
    } else text += char;
  }
  return mark + text + mark;
}

function label(key: PropertyKey): string {
  if (typeof key === "symbol") return "[" + String(key) + "]";
  const name = String(key);
  return /^[A-Za-z_$][\w$]*$/u.test(name) ? name : quote(name);
}

interface Context {
  readonly options: InspectOptions;
  readonly stack: object[];
  readonly cycles: Map<object, number>;
}

function stylize(text: string, color: number, ctx: Context): string {
  return ctx.options.colors
    ? "\u001b[" + color + "m" + text + "\u001b[" + (color === 1 ? 22 : 39) + "m"
    : text;
}

function inspectValue(value: unknown, ctx: Context, depth: number): string {
  if (typeof value === "string") {
    const max = ctx.options.maxStringLength ?? value.length;
    if (value.length <= max) return stylize(quote(value), 32, ctx);
    const omitted = value.length - max;
    return (
      stylize(quote(value.slice(0, max)), 32, ctx) +
      "... " +
      omitted +
      " more character" +
      (omitted === 1 ? "" : "s")
    );
  }
  if (typeof value === "number")
    return stylize(Object.is(value, -0) ? "-0" : String(value), 33, ctx);
  if (typeof value === "bigint") return stylize(String(value) + "n", 33, ctx);
  if (typeof value === "boolean") return stylize(String(value), 33, ctx);
  if (typeof value === "symbol") return stylize(String(value), 32, ctx);
  if (value === null) return stylize("null", 1, ctx);
  if (value === undefined) return stylize("undefined", 90, ctx);
  if (typeof value === "function")
    return (
      "[Function" + (value.name ? ": " + value.name : " (anonymous)") + "]"
    );
  if (typeof value !== "object") return String(value);

  if (ctx.stack.includes(value)) {
    let id = ctx.cycles.get(value);
    if (id === undefined) {
      id = ctx.cycles.size + 1;
      ctx.cycles.set(value, id);
    }
    return "[Circular *" + id + "]";
  }
  if (ctx.options.customInspect !== false) {
    const custom: unknown = Reflect.get(value, inspectSymbol);
    if (typeof custom === "function" && custom !== inspect) {
      const result: unknown = Reflect.apply(custom, value, [
        depth,
        ctx.options,
        inspect,
      ]);
      if (typeof result === "string") return result;
      if (result !== value) return inspectValue(result, ctx, depth);
    }
  }
  if (value instanceof Date)
    return stylize(
      Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString(),
      35,
      ctx,
    );
  if (value instanceof RegExp) return stylize(value.toString(), 31, ctx);
  if (value instanceof Error)
    return typeof value.stack === "string" ? value.stack : value.toString();
  if (depth < 0) {
    if (Array.isArray(value)) return "[Array]";
    if (value instanceof Map) return "[Map]";
    if (value instanceof Set) return "[Set]";
    return "[Object]";
  }
  ctx.stack.push(value);
  try {
    const entries: string[] = [];
    let open = "{",
      close = "}";
    const limit = ctx.options.maxArrayLength ?? Infinity;
    let skipArrayIndices = false;
    if (Array.isArray(value)) {
      open = "[";
      close = "]";
      skipArrayIndices = true;
      let holes = 0;
      for (let i = 0; i < value.length && entries.length < limit; i++) {
        if (!Object.hasOwn(value, i)) {
          holes++;
          continue;
        }
        if (holes > 0) {
          entries.push(
            "<" + holes + " empty item" + (holes === 1 ? "" : "s") + ">",
          );
          holes = 0;
        }
        entries.push(inspectValue(value[i], ctx, depth - 1));
      }
      if (holes > 0)
        entries.push(
          "<" + holes + " empty item" + (holes === 1 ? "" : "s") + ">",
        );
      if (value.length > limit)
        entries.push("... " + (value.length - limit) + " more items");
    } else if (value instanceof Map) {
      open = "Map(" + value.size + ") {";
      for (const [key, item] of value)
        entries.push(
          inspectValue(key, ctx, depth - 1) +
            " => " +
            inspectValue(item, ctx, depth - 1),
        );
    } else if (value instanceof Set) {
      open = "Set(" + value.size + ") {";
      for (const item of value)
        entries.push(inspectValue(item, ctx, depth - 1));
    } else if (Object.getPrototypeOf(value) === null) {
      open = "[Object: null prototype] {";
    }
    const keys = Reflect.ownKeys(value);
    if (ctx.options.sorted)
      keys.sort((a: PropertyKey, b: PropertyKey) =>
        String(a) < String(b) ? -1 : String(a) === String(b) ? 0 : 1,
      );
    for (const key of keys) {
      if (
        skipArrayIndices &&
        typeof key === "string" &&
        /^(0|[1-9][0-9]*)$/u.test(key) &&
        Number(key) < 4294967295
      )
        continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        (!ctx.options.showHidden && !descriptor.enumerable)
      )
        continue;
      const name =
        descriptor.enumerable || typeof key === "symbol"
          ? label(key)
          : "[" + String(key) + "]";
      let rendered: string;
      if ("value" in descriptor)
        rendered = inspectValue(descriptor.value, ctx, depth - 1);
      else if (descriptor.get !== undefined && ctx.options.getters)
        rendered =
          "[Getter: " +
          inspectValue(
            Reflect.apply(descriptor.get, value, []),
            ctx,
            depth - 1,
          ) +
          "]";
      else
        rendered =
          descriptor.get !== undefined
            ? descriptor.set !== undefined
              ? "[Getter/Setter]"
              : "[Getter]"
            : "[Setter]";
      entries.push(name + ": " + rendered);
    }
    const cycle = ctx.cycles.get(value);
    return (
      (cycle === undefined ? "" : "<ref *" + cycle + "> ") +
      open +
      (entries.length === 0 ? "" : " " + entries.join(", ") + " ") +
      close
    );
  } finally {
    ctx.stack.pop();
  }
}

function inspectObject(
  value: unknown,
  options?: InspectOptions | boolean,
  depth?: number | null,
  colors?: boolean,
): string {
  const selected = Object.assign(
    {},
    defaultOptions,
    typeof options === "boolean"
      ? {
          showHidden: options,
          depth: depth === undefined ? 2 : depth,
          colors: colors === true,
        }
      : options,
  );
  return inspectValue(
    value,
    { options: selected, stack: [], cycles: new Map<object, number>() },
    selected.depth === null ? Infinity : (selected.depth ?? 2),
  );
}

export const inspect = Object.assign(inspectObject, {
  custom: inspectSymbol,
  defaultOptions,
});

export function formatWithOptions(
  options: InspectOptions,
  first?: unknown,
  ...args: unknown[]
): string {
  if (options === null || typeof options !== "object")
    throw invalidArgument("inspectOptions", "of type object", options);
  if (arguments.length < 2) return "";
  if (typeof first !== "string")
    return [first, ...args]
      .map((item: unknown) =>
        typeof item === "string" ? item : inspect(item, options),
      )
      .join(" ");
  if (args.length === 0) return first;
  let text = "",
    index = 0;
  for (let i = 0; i < first.length; i++) {
    const char = first.charAt(i),
      directive = first.charAt(i + 1);
    if (char !== "%" || directive === "") {
      text += char;
      continue;
    }
    if (directive === "%") {
      text += "%";
      i++;
      continue;
    }
    if (index >= args.length || !"sdifjoOc".includes(directive)) {
      text += char;
      continue;
    }
    const value = args[index++];
    i++;
    if (directive === "c") continue;
    if (directive === "s") {
      text +=
        typeof value === "object" && value !== null
          ? inspect(
              value,
              Object.assign({}, options, { depth: 0, colors: false }),
            )
          : typeof value === "bigint"
            ? String(value) + "n"
            : String(value);
    } else if (directive === "j") {
      try {
        text += String(JSON.stringify(value));
      } catch (error) {
        if (
          error instanceof TypeError &&
          error.message.toLowerCase().includes("circular")
        )
          text += "[Circular]";
        else throw error;
      }
    } else if (directive === "O") text += inspect(value, options);
    else if (directive === "o")
      text += inspect(
        value,
        Object.assign({}, options, { showHidden: true, depth: 4 }),
      );
    else if (typeof value === "symbol") text += "NaN";
    else if (typeof value === "bigint" && directive !== "f")
      text += String(value) + "n";
    else {
      const number =
        directive === "i"
          ? parseInt(String(value), 10)
          : directive === "f"
            ? parseFloat(String(value))
            : Number(value);
      text += Object.is(number, -0) ? "-0" : String(number);
    }
  }
  for (; index < args.length; index++) {
    const value = args[index];
    text += " " + (typeof value === "string" ? value : inspect(value, options));
  }
  return text;
}

export function format(first?: unknown, ...args: unknown[]): string {
  if (arguments.length === 0) return "";
  return formatWithOptions({}, first, ...args);
}
