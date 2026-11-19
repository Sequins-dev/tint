import { createSourceTextView } from "@tint/source/text";
import { typeParameterCount, parseModule } from "../syntax/index.ts";
import type { Statement, TypeNode } from "../syntax/index.ts";
export type PrintedReifiedTypes =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };
/** Canonical declaration-only interchange for reifyTypes, not a source printer.
 * Names are generated identifiers; quoted text is ASCII escaped to preserve all
 * UTF-16 code units through UTF-8 storage, including unpaired surrogates. */
export function printReifiedTypes(
  declarations: readonly Statement[],
): PrintedReifiedTypes {
  const aliases = new Map<string, TypeNode>();
  let error = "";
  function reject(message: string): undefined {
    if (error.length === 0) error = message;
    return undefined;
  }
  function identifier(name: string): boolean {
    if (name.length === 0) return false;
    for (let i = 0; i < name.length; i++) {
      const c = name.charCodeAt(i);
      if (!(
        c === 36 ||
        c === 95 ||
        (c >= 65 && c <= 90) ||
        (c >= 97 && c <= 122) ||
        (i > 0 && c >= 48 && c <= 57)
      ))
        return false;
    }
    return true;
  }
  function quote(text: string): string {
    const parts: string[] = ['"'],
      hex = "0123456789abcdef";
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 34) parts.push('\\"');
      else if (c === 92) parts.push("\\\\");
      else if (c < 32 || c >= 127)
        parts.push(
          "\\u" +
            hex.charAt((c >>> 12) & 15) +
            hex.charAt((c >>> 8) & 15) +
            hex.charAt((c >>> 4) & 15) +
            hex.charAt(c & 15),
        );
      else parts.push(text.charAt(i));
    }
    parts.push('"');
    return parts.join("");
  }
  for (const declaration of declarations) {
    if (
      declaration === undefined ||
      declaration.kind !== "type-alias" ||
      typeParameterCount(declaration.typeParameters) !== 0 ||
      !identifier(declaration.name) ||
      aliases.has(declaration.name)
    )
      return {
        ok: false,
        error: "serialization requires unique concrete generated type aliases",
      };
    aliases.set(declaration.name, declaration.type);
  }
  function signature(node: TypeNode): TypeNode | undefined {
    const seen = new Set<string>();
    let current = node;
    while (current.kind === "named") {
      if ((current.arguments?.length ?? 0) !== 0 || seen.has(current.name))
        return reject("callable alias must resolve to a concrete function");
      seen.add(current.name);
      const next = aliases.get(current.name);
      if (next === undefined) return reject("missing callable alias");
      current = next;
    }
    return current.kind === "function"
      ? current
      : reject("callable alias requires a function");
  }
  function parameters(node: TypeNode, depth: number): string | undefined {
    if (node.kind !== "function" || node.async)
      return reject("serialization requires synchronous function types");
    const parts: string[] = [];
    if (node.receiver !== undefined) {
      const receiver = render(node.receiver, depth + 1);
      if (receiver === undefined) return undefined;
      parts.push("this:" + receiver);
    }
    for (const parameter of node.parameters) {
      if (
        parameter === undefined ||
        parameter.kind === "pattern-parameter" ||
        parameter.type === undefined ||
        parameter.initializer !== undefined ||
        !identifier(parameter.name) ||
        (parameter.rest && parameter.optional)
      )
        return reject("unsupported reified function parameter");
      const annotation = parameter.type;
      if (annotation === undefined)
        return reject("missing function parameter type");
      const type = render(annotation, depth + 1);
      if (type === undefined) return undefined;
      parts.push(
        (parameter.rest ? "..." : "") +
          parameter.name +
          (parameter.optional ? "?" : "") +
          ":" +
          type,
      );
    }
    return "(" + parts.join(",") + ")";
  }
  function render(node: TypeNode, depth: number): string | undefined {
    if (depth > 256)
      return reject("reified type syntax exceeds serialization depth");
    if (node.kind === "named") {
      if (!identifier(node.name))
        return reject("invalid generated type reference");
      const args: string[] = [];
      for (const argument of node.arguments ?? []) {
        if (argument === undefined) return reject("missing type argument");
        const value = render(argument, depth + 1);
        if (value === undefined) return undefined;
        args.push(value);
      }
      return node.name + (args.length === 0 ? "" : "<" + args.join(",") + ">");
    }
    if (node.kind === "literal") {
      const value = node.value;
      if (typeof value === "string") return quote(value);
      if (typeof value === "boolean") return value ? "true" : "false";
      if (!Number.isFinite(value))
        return reject("nonfinite numeric type literal");
      return value === 0 && 1 / value === -Infinity ? "-0" : String(value);
    }
    if (node.kind === "function") {
      const args = parameters(node, depth),
        result = render(node.returnType, depth + 1);
      return args === undefined || result === undefined
        ? undefined
        : "(" + args + "=>" + result + ")";
    }
    if (node.kind === "object") {
      const parts: string[] = [];
      const index = node.indexSignature;
      if (index !== undefined) {
        if (!identifier(index.name))
          return reject("invalid generated index parameter");
        const key = render(index.keyType, depth + 1),
          value = render(index.valueType, depth + 1);
        if (key === undefined || value === undefined) return undefined;
        parts.push(
          (index.readonly ? "readonly " : "") +
            "[" +
            index.name +
            ":" +
            key +
            "]:" +
            value +
            ";",
        );
      }
      for (const property of node.properties) {
        if (property === undefined) return reject("missing type property");
        const value = render(property.type, depth + 1);
        if (value === undefined) return undefined;
        parts.push(
          (property.readonly ? "readonly " : "") +
            quote(property.name) +
            (property.optional ? "?" : "") +
            ":" +
            value +
            ";",
        );
      }
      for (let i = 0; i < 2; i++) {
        const callable = i === 0 ? node.call : node.construct;
        if (callable === undefined) continue;
        const type = signature(callable);
        if (type === undefined || type.kind !== "function") return undefined;
        if (i === 1 && type.receiver !== undefined)
          return reject("construct signature cannot have a receiver");
        const args = parameters(type, depth),
          result = render(type.returnType, depth + 1);
        if (args === undefined || result === undefined) return undefined;
        parts.push((i === 1 ? "new " : "") + args + ":" + result + ";");
      }
      return "{" + parts.join("") + "}";
    }
    if (node.kind === "tuple") {
      const parts: string[] = [];
      for (const element of node.elements) {
        if (element === undefined)
          return reject("missing reified tuple element");
        const value = render(element, depth + 1);
        if (value === undefined) return undefined;
        parts.push(value);
      }
      return (node.readonly ? "readonly " : "") + "[" + parts.join(",") + "]";
    }
    if (node.kind === "array") {
      const element = render(node.element, depth + 1);
      return element === undefined
        ? undefined
        : (node.readonly ? "readonly " : "") + "(" + element + ")[]";
    }
    if (node.kind === "union" || node.kind === "intersection") {
      if (node.members.length === 0)
        return reject("empty reified type combination");
      const members: string[] = [];
      for (const member of node.members) {
        if (member === undefined) return reject("missing type member");
        const value = render(member, depth + 1);
        if (value === undefined) return undefined;
        members.push(value);
      }
      return "(" + members.join(node.kind === "union" ? "|" : "&") + ")";
    }
    if (node.kind === "group") {
      const value = render(node.type, depth + 1);
      return value;
    }
    if (node.kind === "indexed-access") {
      const object = render(node.object, depth + 1),
        index = render(node.index, depth + 1);
      return object === undefined || index === undefined
        ? undefined
        : "(" + object + ")[" + index + "]";
    }
    return reject("unsupported reified type syntax");
  }
  const output: string[] = [];
  for (const declaration of declarations) {
    if (declaration === undefined || declaration.kind !== "type-alias")
      return { ok: false, error: "serialization requires type aliases" };
    const type = render(declaration.type, 0);
    if (type === undefined) return { ok: false, error };
    output.push(
      (declaration.exported ? "export " : "") +
        "type " +
        declaration.name +
        "=" +
        type +
        ";\n",
    );
  }
  const value = output.join("");
  const parsed = parseModule(createSourceTextView(value));
  if (!parsed.ok)
    return {
      ok: false,
      error:
        "serialized type declarations are invalid: " + parsed.error.message,
    };
  return { ok: true, value };
}
