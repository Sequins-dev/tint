import { codedError, invalidArgument } from "./coded-errors.ts";

function token(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(value);
}
function parameterValue(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c < 32 && c !== 9) || c === 127 || c > 255) return false;
  }
  return true;
}
function checkedToken(value: unknown, field: string): string {
  if (typeof value === "symbol")
    throw new TypeError("Cannot convert a Symbol value to a string");
  const text = String(value);
  if (!token(text))
    throw codedError(
      new TypeError("Invalid MIME " + field + ": " + text),
      "ERR_INVALID_ARG_VALUE",
    );
  return text.toLowerCase();
}
function trimHTTP(input: string): string {
  return input.replace(/^[\t\n\r ]+|[\t\n\r ]+$/gu, "");
}

export class MIMEParams {
  readonly #values = new Map<string, string>();
  delete(name: string): void {
    this.#values.delete(String(name));
  }
  get(name: string): string | null {
    return this.#values.get(String(name)) ?? null;
  }
  has(name: string): boolean {
    return this.#values.has(String(name));
  }
  set(name: string, value: string): void {
    const key = checkedToken(name, "parameter name");
    if (typeof value === "symbol")
      throw new TypeError("Cannot convert a Symbol value to a string");
    const text = String(value);
    if (!parameterValue(text))
      throw codedError(
        new TypeError("Invalid MIME parameter value"),
        "ERR_INVALID_ARG_VALUE",
      );
    this.#values.set(key, text);
  }
  entries(): IterableIterator<[string, string]> {
    return this.#values.entries();
  }
  keys(): IterableIterator<string> {
    return this.#values.keys();
  }
  values(): IterableIterator<string> {
    return this.#values.values();
  }
  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }
  toString(): string {
    const fields: string[] = [];
    for (const [key, value] of this.#values) {
      fields.push(
        key +
          "=" +
          (token(value)
            ? value
            : '"' +
              value.split("\\").join("\\\\").split('"').join('\\"') +
              '"'),
      );
    }
    return fields.join(";");
  }
}

export class MIMEType {
  #type: string;
  #subtype: string;
  readonly #params = new MIMEParams();
  constructor(input: string) {
    if (arguments.length === 0)
      throw invalidArgument("input", "of type string", input);
    if (typeof input === "symbol")
      throw new TypeError("Cannot convert a Symbol value to a string");
    const text = trimHTTP(String(input));
    const semi = text.indexOf(";");
    const essence = semi < 0 ? text : text.slice(0, semi);
    const slash = essence.indexOf("/");
    this.#type = checkedToken(slash < 0 ? "" : essence.slice(0, slash), "type");
    this.#subtype = checkedToken(trimHTTP(essence.slice(slash + 1)), "subtype");
    if (semi < 0) return;
    let index = semi + 1;
    while (index < text.length) {
      while ("\t ".includes(text.charAt(index)) && index < text.length) index++;
      const start = index;
      while (
        index < text.length &&
        text.charAt(index) !== "=" &&
        text.charAt(index) !== ";"
      )
        index++;
      const name = text.slice(start, index).toLowerCase();
      if (text.charAt(index++) !== "=") continue;
      let value = "";
      if (text.charAt(index) === '"') {
        index++;
        while (index < text.length) {
          const char = text.charAt(index++);
          if (char === '"') break;
          value +=
            char === "\\" && index < text.length ? text.charAt(index++) : char;
        }
        while (index < text.length && text.charAt(index) !== ";") index++;
      } else {
        const valueStart = index;
        while (index < text.length && text.charAt(index) !== ";") index++;
        value = text.slice(valueStart, index).replace(/[\t\n\r ]+$/u, "");
        if (value === "") {
          index++;
          continue;
        }
      }
      if (token(name) && parameterValue(value) && !this.#params.has(name))
        this.#params.set(name, value);
      index++;
    }
  }
  get type(): string {
    return this.#type;
  }
  set type(value: string) {
    this.#type = checkedToken(value, "type");
  }
  get subtype(): string {
    return this.#subtype;
  }
  set subtype(value: string) {
    this.#subtype = checkedToken(value, "subtype");
  }
  get essence(): string {
    return this.#type + "/" + this.#subtype;
  }
  get params(): MIMEParams {
    return this.#params;
  }
  toString(): string {
    const parameters = this.#params.toString();
    return this.essence + (parameters === "" ? "" : ";" + parameters);
  }
  toJSON(): string {
    return this.toString();
  }
  static parse(input: string): MIMEType | null {
    if (typeof input === "symbol")
      throw new TypeError("Cannot convert a Symbol value to a string");
    const text = String(input);
    try {
      return new MIMEType(text);
    } catch {
      return null;
    }
  }
}
