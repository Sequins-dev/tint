// Annotated record bindings get run-time property contracts on the general
// path (explicit annotations are contracts from any path). A literal field
// type, such as a union member's discriminant, admits exactly its value; it
// used to have no contract rule, which dropped the whole record's contract,
// so writes outside the declared field types went unchecked.
import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import {
  eraseTypeSyntax,
  parseModule,
  rewriteModule,
  type Module,
} from "@tint/typescript/syntax";
import * as lowering from "../src/lowering/index.ts";

/** Lowers a source-validated module and returns, for each
 * projectPropertyContract call, its schema's rule kinds (a literal rule with
 * its value). */
function contractRules(source: string): string[][] {
  const parsed = parseModule(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const lowered = lowering.lowerSourceTextModule(
    eraseTypeSyntax(parsed.value, { typeExport: () => false }),
    undefined,
    undefined,
    true,
    false,
    parsed.value,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const contracts: string[][] = [];
  rewriteModule(lowered.value as Module, {
    expression(node) {
      if (
        node.kind === "call" &&
        node.callee.kind === "identifier" &&
        node.callee.name === "projectPropertyContract"
      ) {
        const schema = node.arguments[1] as unknown as SchemaNode;
        const types = field(schema, "types");
        contracts.push(
          (types?.elements ?? []).map((rule) => {
            const kind = field(rule, "kind")?.value;
            const value = field(rule, "value")?.value;
            return kind === "literal"
              ? "literal:" + String(value)
              : String(kind);
          }),
        );
      }
      return node;
    },
  });
  return contracts;
}
interface SchemaNode {
  readonly kind: string;
  readonly value?: string | number | boolean;
  readonly elements?: readonly SchemaNode[];
  readonly properties?: readonly {
    readonly name: string;
    readonly value: SchemaNode;
  }[];
}
function field(
  node: SchemaNode | undefined,
  name: string,
): SchemaNode | undefined {
  return node?.properties?.find((property) => property.name === name)?.value;
}

test("literal field types keep the record contract and admit exactly their value", () => {
  const [tagged] = contractRules(
    'interface Tagged { readonly kind: "tagged"; x: string; level: 1 | 2; on: true } const t: Tagged = { kind: "tagged", x: "a", level: 1, on: true }; export function f(): string { return t.x; }',
  );
  assert.ok(tagged !== undefined, "the record has a contract");
  for (const rule of [
    "literal:tagged",
    "string",
    "literal:1",
    "literal:2",
    "literal:true",
  ])
    assert.ok(tagged.includes(rule), rule + " in " + JSON.stringify(tagged));
  assert.ok(tagged.includes("union"));
});

test("records without literal fields keep their contracts", () => {
  const [plain] = contractRules(
    'interface Plain { x: string; n: number | undefined } const p: Plain = { x: "a", n: 1 }; export function f(): string { return p.x; }',
  );
  assert.ok(plain !== undefined);
  assert.ok(plain.includes("string") && plain.includes("number"));
});
