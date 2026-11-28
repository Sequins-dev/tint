import { argv } from "./process.ts";
import { codedError, invalidArgument } from "./coded-errors.ts";

interface Option {
  readonly type: "boolean" | "string";
  readonly short?: string;
  readonly multiple?: boolean;
  readonly default?: string | boolean | string[] | boolean[];
}
interface ArgsConfig {
  readonly args?: readonly string[];
  readonly options?: Record<string, Option>;
  readonly strict?: boolean;
  readonly allowPositionals?: boolean;
  readonly allowNegative?: boolean;
  readonly tokens?: boolean;
}
type OptionValue = boolean | string | (boolean | string)[];
interface ArgsToken {
  readonly kind: "option" | "positional" | "option-terminator";
  readonly index: number;
  readonly value?: string | undefined;
  readonly name?: string;
  readonly rawName?: string;
  readonly inlineValue?: boolean | undefined;
}
interface ParsedArgs {
  readonly values: Record<string, OptionValue | undefined>;
  readonly positionals: string[];
  readonly tokens?: ArgsToken[];
}

function invalidValue(label: string, value: unknown): never {
  throw codedError(
    new TypeError(
      "Option '" +
        label +
        "' argument is ambiguous or invalid: " +
        String(value),
    ),
    "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
  );
}
export function parseArgs(config: ArgsConfig = {}): ParsedArgs {
  if (config === null || typeof config !== "object" || Array.isArray(config))
    throw invalidArgument("config", "of type object", config);
  const args = config.args === undefined ? argv.slice(1) : config.args;
  if (!Array.isArray(args))
    throw invalidArgument("args", "an instance of Array", args);
  const options = config.options ?? {};
  if (typeof options !== "object" || Array.isArray(options))
    throw invalidArgument("options", "of type object", options);
  const strict = config.strict ?? true;
  const allowPositionals = config.allowPositionals ?? !strict;
  for (const name of [
    "strict",
    "allowPositionals",
    "allowNegative",
    "tokens",
  ]) {
    if (name === undefined) continue;
    const value: unknown = Reflect.get(config, name);
    if (value !== undefined && typeof value !== "boolean")
      throw invalidArgument(name, "of type boolean", value);
  }
  const shortNames: Record<string, string | undefined> = Object.create(null);
  const values: Record<string, OptionValue | undefined> = Object.create(null);
  const positionals: string[] = [],
    tokens: ArgsToken[] = [];
  for (const name of Object.keys(options)) {
    if (name === undefined) continue;
    const option = options[name];
    if (option === undefined || option === null || typeof option !== "object")
      throw invalidArgument("options." + name, "of type object", option);
    if (option.type !== "string" && option.type !== "boolean")
      throw codedError(
        new TypeError(
          "Option '" + name + "' type must be 'string' or 'boolean'",
        ),
        "ERR_INVALID_ARG_VALUE",
      );
    const short = option.short;
    if (short !== undefined) {
      if (typeof short !== "string")
        throw invalidArgument(
          "options." + name + ".short",
          "of type string",
          short,
        );
      if (short.length !== 1)
        throw codedError(
          new TypeError("Short option must have one character"),
          "ERR_INVALID_ARG_VALUE",
        );
      if (shortNames[short] === undefined) shortNames[short] = name;
    }
    if (option.multiple !== undefined && typeof option.multiple !== "boolean")
      throw invalidArgument(
        "options." + name + ".multiple",
        "of type boolean",
        option.multiple,
      );
  }
  function find(name: string): Option | undefined {
    return Object.hasOwn(options, name) ? options[name] : undefined;
  }
  function store(
    name: string,
    raw: string,
    index: number,
    argument: string | undefined,
    inline: boolean | undefined,
    negative: boolean,
  ): void {
    const option = find(name);
    if (strict) {
      if (option === undefined)
        throw codedError(
          new TypeError("Unknown option '" + raw + "'"),
          "ERR_PARSE_ARGS_UNKNOWN_OPTION",
        );
      if (
        option.type === "string" &&
        (argument === undefined ||
          (inline === false && argument.length > 1 && argument.startsWith("-")))
      )
        invalidValue(raw, argument);
      if (option.type === "boolean" && argument !== undefined)
        invalidValue(raw, argument);
    }
    const value = argument === undefined ? !negative : argument;
    if (option?.multiple === true) {
      const existing = values[name];
      if (Array.isArray(existing)) existing.push(value);
      else values[name] = [value];
    } else values[name] = value;
    tokens.push({
      kind: "option",
      name,
      rawName: raw,
      index,
      value: argument,
      inlineValue: inline,
    });
  }

  let positionalOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== "string")
      throw invalidArgument("args[" + i + "]", "of type string", arg);
    if (!positionalOnly && arg === "--") {
      positionalOnly = true;
      tokens.push({ kind: "option-terminator", index: i });
    } else if (!positionalOnly && arg.startsWith("--")) {
      const index = i;
      const separator = arg.indexOf("=", 2);
      const raw = separator < 0 ? arg : arg.slice(0, separator);
      let name = raw.slice(2);
      let negative = false;
      if (
        config.allowNegative === true &&
        name.startsWith("no-") &&
        find(name) === undefined &&
        find(name.slice(3))?.type === "boolean"
      ) {
        name = name.slice(3);
        negative = true;
      }
      if (separator >= 0)
        store(name, raw, index, arg.slice(separator + 1), true, negative);
      else if (find(name)?.type === "string" && i + 1 < args.length)
        store(name, raw, index, args[++i], false, negative);
      else store(name, raw, index, undefined, undefined, negative);
    } else if (!positionalOnly && arg.length > 1 && arg.startsWith("-")) {
      const index = i;
      for (let j = 1; j < arg.length; j++) {
        const short = arg.charAt(j);
        const name = shortNames[short] ?? short,
          raw = "-" + short;
        if (find(name)?.type === "string") {
          if (j + 1 < arg.length)
            store(name, raw, index, arg.slice(j + 1), true, false);
          else if (i + 1 < args.length)
            store(name, raw, index, args[++i], false, false);
          else store(name, raw, index, undefined, undefined, false);
          break;
        }
        store(name, raw, index, undefined, undefined, false);
      }
    } else {
      if (!allowPositionals)
        throw codedError(
          new TypeError(
            "Unexpected argument '" +
              arg +
              "'. This command does not take positional arguments",
          ),
          "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL",
        );
      positionals.push(arg);
      tokens.push({ kind: "positional", index: i, value: arg });
    }
  }
  for (const name of Object.keys(options)) {
    if (name === undefined) continue;
    const option = options[name];
    const value = option?.default;
    if (value === undefined || option === undefined) continue;
    if (option.multiple === true) {
      if (
        !Array.isArray(value) ||
        value.some((item: unknown) => typeof item !== option.type)
      )
        throw invalidArgument(
          "options." + name + ".default",
          "an array of " + option.type,
          value,
        );
    } else if (typeof value !== option.type)
      throw invalidArgument(
        "options." + name + ".default",
        "of type " + option.type,
        value,
      );
    if (!Object.hasOwn(values, name)) values[name] = value;
  }
  return config.tokens === true
    ? { values, positionals, tokens }
    : { values, positionals };
}

export function parseEnv(content: string): Record<string, string> {
  if (typeof content !== "string")
    throw invalidArgument("content", "of type string", content);
  const result: Record<string, string> = {};
  const source = content.split("\r\n").join("\n");
  let offset = 0;
  while (offset < source.length) {
    const lineEnd = source.indexOf("\n", offset);
    const end = lineEnd < 0 ? source.length : lineEnd;
    const line = source.slice(offset, end);
    offset = end + 1;
    const equals = line.indexOf("=");
    if (equals < 0 || line.trimStart().startsWith("#")) continue;
    let key = line.slice(0, equals).trim();
    if (key.startsWith("export ")) key = key.slice(7).trimStart();
    if (key === "") continue;
    let start = end - line.length + equals + 1;
    while (
      start < end &&
      (source.charAt(start) === " " || source.charAt(start) === "\t")
    )
      start++;
    const mark = source.charAt(start);
    let value: string;
    if (mark === "'" || mark === '"' || mark === "`") {
      const close = source.indexOf(mark, start + 1);
      if (close < 0) continue;
      value = source.slice(start + 1, close);
      if (mark === '"') value = value.split("\\n").join("\n");
      if (close > end) {
        const newline = source.indexOf("\n", close + 1);
        offset = newline < 0 ? source.length : newline + 1;
      }
    } else {
      const hash = source.indexOf("#", start);
      value = source.slice(start, hash < 0 || hash > end ? end : hash).trim();
    }
    Object.defineProperty(result, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}
