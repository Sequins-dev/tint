import { reifyTypes } from "@tint/typescript/reify";
import type { Type } from "@tint/typescript/types";
import { bindModule } from "@tint/typescript/binding";
import type { Module, Statement, TypeNode } from "@tint/typescript/syntax";
import {
  specializeModule,
  type SpecializationResult,
} from "./specialization.ts";
export interface CheckedSpecializationRoot {
  readonly name: string;
  readonly arguments: readonly number[];
}
/** The module is already linked. Type IDs belong only to the supplied finite graph. */
export function specializeCheckedRoots(
  module: Module,
  types: readonly Type[],
  requests: readonly CheckedSpecializationRoot[],
  globals: readonly string[],
  maxSpecializations: number = 4096,
): SpecializationResult {
  function failure(message: string): SpecializationResult {
    return {
      ok: false,
      error: { message, start: module.start, end: module.end },
    };
  }
  const names: string[] = [];
  for (const statement of module.statements) {
    if (statement === undefined)
      return failure("module statement contains a hole");
    if (
      statement.kind === "function" ||
      statement.kind === "interface" ||
      statement.kind === "type-alias"
    )
      names.push(statement.name);
  }
  let prefix = "__tint_contract_";
  while (names.some((name) => name !== undefined && name.startsWith(prefix)))
    prefix += "_";
  const arguments_: number[] = [];
  for (const request of requests) {
    if (request === undefined)
      return failure("specialization request contains a hole");
    for (const argument of request.arguments) {
      if (argument === undefined)
        return failure("specialization arguments contain a hole");
      arguments_.push(argument);
    }
  }
  const reified = reifyTypes(types, arguments_, prefix);
  if (!reified.ok) return failure(reified.error);
  const statements: Statement[] = [];
  for (const statement of module.statements) {
    if (statement === undefined)
      return failure("module statement contains a hole");
    statements.push(statement);
  }
  for (const declaration of reified.value.declarations) {
    if (declaration === undefined) throw "reified declaration invariant";
    statements.push(declaration);
  }
  const prepared: Module = { ...module, statements };
  const bound = bindModule(prepared, globals);
  if (!bound.ok) return { ok: false, error: bound.error };
  const roots: { function: number; arguments: readonly TypeNode[] }[] = [];
  let cursor = 0;
  for (const request of requests) {
    if (request === undefined) throw "validated request invariant";
    const declaration = statements.find(
      (statement) =>
        statement !== undefined &&
        statement.kind === "function" &&
        statement.name === request.name,
    );
    if (declaration === undefined)
      return failure("missing specialization function: " + request.name);
    const fn = bound.value.functions.find(
      (fn) => fn !== undefined && fn.node === declaration,
    );
    if (fn === undefined)
      return failure("specialization function binding missing");
    const args: TypeNode[] = [];
    for (let i = 0; i < request.arguments.length; i++) {
      const argument = reified.value.roots[cursor++];
      if (argument === undefined) throw "reified argument invariant";
      args.push(argument);
    }
    roots.push({ function: fn.id, arguments: args });
  }
  return specializeModule(prepared, bound.value, { roots, maxSpecializations });
}
