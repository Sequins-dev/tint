import type { NativeRecordViewField } from "@tint/typescript/checker";
import type {
  Expression,
  ObjectProperty,
  Parameter,
  PropertySignature,
  Statement,
  SwitchClause,
  TypeNode,
} from "@tint/typescript/syntax";

/** Evaluate the value once and close the realm view over that exact record. */
export function projectRecordExpression(
  record: Expression,
  fields: readonly NativeRecordViewField[],
  helper: string,
): Expression {
  const span = { start: record.start, end: record.end };
  function identifier(name: string): Expression {
    return { ...span, kind: "identifier", name };
  }
  function named(name: string): TypeNode {
    return { ...span, kind: "named", name };
  }
  function property(name: string, value: Expression): ObjectProperty {
    return { ...span, name, value, shorthand: false };
  }
  function parameter(name: string, type: TypeNode): Parameter {
    return { ...span, name, type, initializer: undefined };
  }
  const declarations: PropertySignature[] = [];
  const keys: Expression[] = [],
    writable: Expression[] = [];
  const reads: SwitchClause[] = [],
    writes: SwitchClause[] = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (field === undefined) throw "native record view field invariant";
    const type = named(field.type);
    declarations.push({
      ...span,
      name: field.name,
      optional: field.optional,
      readonly: field.readonly,
      type,
    });
    const key: Expression = { ...span, kind: "string", value: field.name };
    keys.push(key);
    writable.push({ ...span, kind: "boolean", value: !field.readonly });
    const slot: Expression = {
      ...span,
      kind: "member",
      object: identifier("$record"),
      property: field.name,
    };
    const test: Expression = {
      ...span,
      kind: "number",
      value: index,
      raw: String(index),
    };
    reads.push({
      ...span,
      test,
      statements: [{ ...span, kind: "return", expression: slot }],
    });
    if (!field.readonly) {
      const value = identifier("$value");
      const checked: Expression =
        field.type === "unknown"
          ? value
          : {
              ...span,
              kind: "satisfies",
              assertion: "as",
              expression: value,
              type: field.optional
                ? {
                    ...span,
                    kind: "union",
                    members: [type, named("undefined")],
                  }
                : type,
            };
      writes.push({
        ...span,
        test,
        statements: [
          {
            ...span,
            kind: "expression",
            expression: {
              ...span,
              kind: "assignment",
              target: slot,
              value: checked,
            },
          },
          { ...span, kind: "return", expression: undefined },
        ],
      });
    }
  }
  function dispatch(clauses: readonly SwitchClause[]): Statement {
    return {
      ...span,
      kind: "switch",
      expression: identifier("$field"),
      clauses,
    };
  }
  const invalid: Statement = {
    ...span,
    kind: "throw",
    expression: { ...span, kind: "string", value: "NATIVE_RECORD_VIEW_FIELD" },
  };
  const access: Expression = {
    ...span,
    kind: "object",
    properties: [
      property("keys", { ...span, kind: "array", elements: keys }),
      property("writable", { ...span, kind: "array", elements: writable }),
      property("read", {
        ...span,
        kind: "arrow",
        parameters: [parameter("$field", named("number"))],
        returnType: named("unknown"),
        body: {
          ...span,
          kind: "block",
          statements: [dispatch(reads), invalid],
        },
      }),
      property("write", {
        ...span,
        kind: "arrow",
        parameters: [
          parameter("$field", named("number")),
          parameter("$value", named("unknown")),
        ],
        returnType: named("void"),
        body: {
          ...span,
          kind: "block",
          statements: [dispatch(writes), invalid],
        },
      }),
    ],
  };
  const project: Expression = {
    ...span,
    kind: "call",
    callee: identifier(helper),
    typeArguments: [],
    arguments: [
      identifier("$record"),
      {
        ...span,
        kind: "arrow",
        parameters: [],
        returnType: undefined,
        body: access,
      },
    ],
  };
  return {
    ...span,
    kind: "call",
    callee: {
      ...span,
      kind: "arrow",
      parameters: [
        parameter("$record", {
          ...span,
          kind: "object",
          properties: declarations,
        }),
      ],
      returnType: named("unknown"),
      body: project,
    },
    arguments: [record],
    typeArguments: [],
  };
}
