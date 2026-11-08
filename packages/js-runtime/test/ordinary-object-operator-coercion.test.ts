import type {
  ObjectHooks,
  OrdinaryObject,
  ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = {
  ...(await import("../src/objects/index.ts")),
  ...(await import("../src/objects/coercion.ts")),
};

type Key = ScriptPropertyKey;
const objectPrototype = objects.createObject<Key, unknown>(undefined);
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (callee, receiver, args) => {
    const result = objects.callObjectValue(
      callee,
      receiver,
      args,
      objectPrototype,
    );
    assert.equal(result.error, "none");
    return result.value;
  },
};
const realm = objects.createErrorRealm(objectPrototype, hooks);
const toPrimitive = objects.wellKnownSymbol(
  realm.symbolRegistry,
  "toPrimitive",
);
const big = (text: string) => objects.createBigIntLiteral(text);
const bigText = (value: unknown) => {
  const view = objects.viewBigIntValue(value);
  assert.ok(view, "expected a BigInt primitive");
  return objects.bigIntToString(view, 10);
};
const symbol = objects.createSymbolValue("s");

class Abrupt {
  readonly label: string;
  constructor(label: string) {
    this.label = label;
  }
}
function fn(
  implementation: (receiver: unknown, args: readonly unknown[]) => unknown,
) {
  return objects.createCallableObject<Key, unknown>(
    objectPrototype,
    implementation,
  );
}
function data(object: OrdinaryObject<Key, unknown>, key: Key, value: unknown) {
  assert.ok(objects.createDataProperty(object, key, value, hooks));
}
/** An object whose conversion methods append to a shared trace. */
function convertible(
  trace: string[],
  label: string,
  methods: {
    readonly exotic?: unknown;
    readonly valueOf?: unknown;
    readonly toString?: unknown;
  },
) {
  const object = objects.createObject<Key, unknown>(objectPrototype);
  const install = (key: Key, name: string, outcome: unknown) => {
    if (outcome === undefined) return;
    if (typeof outcome === "function" || outcome instanceof Abrupt) {
      data(
        object,
        key,
        fn((receiver, args) => {
          trace.push(`${label}.${name}`);
          if (outcome instanceof Abrupt) throw outcome;
          return (outcome as (r: unknown, a: readonly unknown[]) => unknown)(
            receiver,
            args,
          );
        }),
      );
      return;
    }
    data(object, key, outcome);
  };
  install(toPrimitive, "toPrimitive", methods.exotic);
  install("valueOf", "valueOf", methods.valueOf);
  install("toString", "toString", methods.toString);
  return object;
}
const returns = (value: unknown) => () => value;
function binary(operator: string, left: unknown, right: unknown) {
  return objects.binaryObjectValueOperation(
    operator,
    left,
    right,
    hooks,
    realm,
  );
}

test("ToPrimitive passes the hint and receiver to @@toPrimitive exactly once", () => {
  const seen: [string, unknown, number][] = [];
  const object = objects.createObject<Key, unknown>(objectPrototype);
  data(
    object,
    toPrimitive,
    fn((receiver, args) => {
      seen.push([String(args[0]), receiver, args.length]);
      return 7;
    }),
  );
  for (const hint of ["default", "number", "string"] as const)
    assert.deepEqual(objects.primitiveValue(object, hint, hooks, realm), {
      error: "none",
      value: 7,
    });
  assert.deepEqual(binary("+", object, 1), { error: "none", value: 8 });
  assert.deepEqual(binary("<", object, 8), { error: "none", value: true });
  assert.deepEqual(binary("*", 2, object), { error: "none", value: 14 });
  assert.deepEqual(objects.looselyEqual(object, 7, hooks, realm), {
    error: "none",
    value: true,
  });
  assert.deepEqual(
    seen.map(([hint, receiver, count]) => [hint, receiver === object, count]),
    [
      ["default", true, 1],
      ["number", true, 1],
      ["string", true, 1],
      ["default", true, 1],
      ["number", true, 1],
      ["number", true, 1],
      ["default", true, 1],
    ],
  );
});

test("ToPrimitive validates @@toPrimitive before OrdinaryToPrimitive", () => {
  for (const nullish of [undefined, null]) {
    const trace: string[] = [];
    const object = convertible(trace, "o", { valueOf: returns(3) });
    data(object, toPrimitive, nullish);
    assert.deepEqual(objects.primitiveValue(object, "number", hooks, realm), {
      error: "none",
      value: 3,
    });
    assert.deepEqual(trace, ["o.valueOf"]);
  }
  for (const invalid of [1, "f", true, objects.createObject(objectPrototype)]) {
    const trace: string[] = [];
    const object = convertible(trace, "o", { valueOf: returns(3) });
    data(object, toPrimitive, invalid);
    assert.equal(
      objects.primitiveValue(object, "number", hooks, realm).error,
      "type",
    );
    assert.deepEqual(trace, [], "GetMethod rejects before OrdinaryToPrimitive");
  }
  const trace: string[] = [];
  const object = convertible(trace, "o", {
    exotic: () => objects.createObject(objectPrototype),
    valueOf: returns(3),
  });
  assert.equal(
    objects.primitiveValue(object, "number", hooks, realm).error,
    "type",
  );
  assert.deepEqual(trace, ["o.toPrimitive"]);
  // The @@toPrimitive getter's abrupt completion propagates unchanged.
  const failure = new Abrupt("getter");
  const getterObject = objects.createObject<Key, unknown>(objectPrototype);
  assert.ok(
    objects.createAccessorProperty(
      getterObject,
      toPrimitive,
      fn(() => {
        throw failure;
      }),
      false,
      hooks,
    ),
  );
  assert.throws(
    () => binary("+", getterObject, 1),
    (e) => e === failure,
  );
});

test("OrdinaryToPrimitive orders methods by hint and skips non-callables", () => {
  const cases: [
    "default" | "number" | "string",
    { valueOf?: unknown; toString?: unknown },
    unknown,
    string[],
  ][] = [
    [
      "number",
      { valueOf: returns(1), toString: returns("t") },
      1,
      ["o.valueOf"],
    ],
    [
      "default",
      { valueOf: returns(1), toString: returns("t") },
      1,
      ["o.valueOf"],
    ],
    [
      "string",
      { valueOf: returns(1), toString: returns("t") },
      "t",
      ["o.toString"],
    ],
    ["number", { valueOf: 5, toString: returns("t") }, "t", ["o.toString"]],
    [
      "number",
      {
        valueOf: () => objects.createObject(objectPrototype),
        toString: returns(-0),
      },
      -0,
      ["o.valueOf", "o.toString"],
    ],
    ["string", { valueOf: returns(null), toString: null }, null, ["o.valueOf"]],
  ];
  for (const [hint, methods, expected, order] of cases) {
    const trace: string[] = [];
    const result = objects.primitiveValue(
      convertible(trace, "o", methods),
      hint,
      hooks,
      realm,
    );
    assert.equal(result.error, "none");
    assert.ok(Object.is(result.value, expected), `${hint} ${String(expected)}`);
    assert.deepEqual(trace, order);
  }
  const trace: string[] = [];
  const object = convertible(trace, "o", {
    valueOf: () => objects.createObject(objectPrototype),
    toString: () => objects.createObject(objectPrototype),
  });
  assert.equal(
    objects.primitiveValue(object, "string", hooks, realm).error,
    "type",
  );
  assert.deepEqual(trace, ["o.toString", "o.valueOf"]);
});

test("addition converts both operands to primitives before ToString or ToNumeric", () => {
  // ECMA-262 ApplyStringOrNumericBinaryOperator steps 1.a-1.d.
  let trace: string[] = [];
  const failure = new Abrupt("rhs");
  assert.throws(
    () =>
      binary(
        "+",
        convertible(trace, "l", { valueOf: returns(symbol) }),
        convertible(trace, "r", { valueOf: failure }),
      ),
    (e) => e === failure,
  );
  assert.deepEqual(trace, ["l.valueOf", "r.valueOf"]);
  trace = [];
  assert.equal(
    binary(
      "+",
      convertible(trace, "l", { valueOf: returns(1) }),
      convertible(trace, "r", { valueOf: returns(symbol) }),
    ).error,
    "type",
  );
  assert.deepEqual(trace, ["l.valueOf", "r.valueOf"]);
  // A string primitive selects concatenation; the other operand is not reconverted.
  trace = [];
  assert.deepEqual(
    binary(
      "+",
      convertible(trace, "l", { valueOf: returns(1), toString: returns("x") }),
      convertible(trace, "r", { valueOf: returns("2") }),
    ),
    { error: "none", value: "12" },
  );
  assert.deepEqual(trace, ["l.valueOf", "r.valueOf"]);
  assert.deepEqual(binary("+", big("10"), "!"), {
    error: "none",
    value: "10!",
  });
  assert.deepEqual(binary("+", "-", big("-0")), { error: "none", value: "-0" });
  assert.equal(binary("+", symbol, "x").error, "type");
  assert.equal(binary("+", "x", symbol).error, "type");
});

test("other binary operators finish ToNumeric(lhs) before converting rhs", () => {
  // ECMA-262 ApplyStringOrNumericBinaryOperator steps 3-4.
  for (const operator of [
    "-",
    "*",
    "/",
    "%",
    "**",
    "&",
    "|",
    "^",
    "<<",
    ">>",
    ">>>",
  ]) {
    const trace: string[] = [];
    assert.equal(
      binary(
        operator,
        convertible(trace, "l", { valueOf: returns(symbol) }),
        convertible(trace, "r", { valueOf: new Abrupt("rhs") }),
      ).error,
      "type",
      operator,
    );
    assert.deepEqual(trace, ["l.valueOf"], operator);
    const mixed: string[] = [];
    assert.equal(
      binary(
        operator,
        convertible(mixed, "l", { valueOf: returns(big("1")) }),
        convertible(mixed, "r", { valueOf: returns(1) }),
      ).error,
      "type",
      operator,
    );
    assert.deepEqual(mixed, ["l.valueOf", "r.valueOf"], operator);
  }
});

test("relational operators convert left then right with the number hint", () => {
  for (const operator of ["<", ">", "<=", ">="]) {
    const trace: string[] = [];
    const failure = new Abrupt("rhs");
    assert.throws(
      () =>
        binary(
          operator,
          convertible(trace, "l", { valueOf: returns(symbol) }),
          convertible(trace, "r", { valueOf: failure }),
        ),
      (e) => e === failure,
      operator,
    );
    assert.deepEqual(trace, ["l.valueOf", "r.valueOf"], operator);
    assert.equal(binary(operator, symbol, 1).error, "type", operator);
    assert.equal(binary(operator, big("1"), symbol).error, "type", operator);
  }
});

test("relational BigInt comparisons are exact and treat invalid strings as unordered", () => {
  const cases: [
    unknown,
    string,
    unknown,
    boolean,
    boolean,
    boolean,
    boolean,
  ][] = [
    // left, op-set results for <, >, <=, >=
    [big("9007199254740993"), "n", 9007199254740992, false, true, false, true],
    [9007199254740992, "n", big("9007199254740993"), true, false, true, false],
    [big("1"), "n", 1.5, true, false, true, false],
    [big("-1"), "n", -0, true, false, true, false],
    [big("0"), "n", -0, false, false, true, true],
    [big("1"), "n", NaN, false, false, false, false],
    [big("1"), "n", Infinity, true, false, true, false],
    [-Infinity, "n", big("-1"), true, false, true, false],
    [big("16"), "s", "0x10", false, false, true, true],
    [" 2 ", "s", big("1"), false, true, false, true],
    [big("1"), "s", "1.5", false, false, false, false],
    ["1n", "s", big("1"), false, false, false, false],
    [big("0"), "s", "", false, false, true, true],
    [big("1"), "b", true, false, false, true, true],
    [big("0"), "u", undefined, false, false, false, false],
    [null, "u", big("0"), false, false, true, true],
  ];
  for (const [left, , right, lt, gt, le, ge] of cases)
    for (const [operator, expected] of [
      ["<", lt],
      [">", gt],
      ["<=", le],
      [">=", ge],
    ] as const)
      assert.deepEqual(
        binary(operator, left, right),
        { error: "none", value: expected },
        `${String(left)} ${operator} ${String(right)}`,
      );
});

test("unary and update operators preserve ToNumber and ToNumeric distinctions", () => {
  assert.equal(
    objects.unaryObjectValueOperation("+", big("1"), hooks, realm).error,
    "type",
  );
  const negated = objects.unaryObjectValueOperation(
    "-",
    big("0"),
    hooks,
    realm,
  );
  assert.equal(negated.error, "none");
  assert.equal(bigText(negated.value), "0");
  const inverted = objects.unaryObjectValueOperation(
    "~",
    big("-1"),
    hooks,
    realm,
  );
  assert.equal(bigText(inverted.value), "0");
  assert.ok(
    Object.is(
      objects.unaryObjectValueOperation("-", "", hooks, realm).value,
      -0,
    ),
  );
  assert.equal(
    objects.unaryObjectValueOperation("~", symbol, hooks, realm).error,
    "type",
  );
  const trace: string[] = [];
  const previous = objects.updateObjectValue(
    "++",
    convertible(trace, "o", { valueOf: returns("41") }),
    hooks,
    realm,
  );
  assert.deepEqual(previous, { error: "none", previous: 41, value: 42 });
  assert.deepEqual(trace, ["o.valueOf"]);
  const decremented = objects.updateObjectValue("--", big("0"), hooks, realm);
  assert.equal(bigText(decremented.previous), "0");
  assert.equal(bigText(decremented.value), "-1");
  assert.deepEqual(objects.updateObjectValue("++", null, hooks, realm), {
    error: "none",
    previous: 0,
    value: 1,
  });
  assert.equal(
    objects.updateObjectValue("++", symbol, hooks, realm).error,
    "type",
  );
});

test("ToString, ToNumber and ToPropertyKey reject symbols only after ToPrimitive", () => {
  const trace: string[] = [];
  const wrapped = convertible(trace, "o", { toString: returns(symbol) });
  assert.equal(objects.stringValue(wrapped, hooks, realm).error, "type");
  assert.deepEqual(objects.propertyKeyValue(wrapped, hooks, realm), {
    error: "none",
    value: symbol,
  });
  assert.equal(objects.numberValue(big("1"), hooks, realm).error, "type");
  assert.deepEqual(objects.stringValue(big("-12"), hooks, realm), {
    error: "none",
    value: "-12",
  });
  assert.deepEqual(objects.propertyKeyValue(-0, hooks, realm), {
    error: "none",
    value: "0",
  });
  assert.deepEqual(objects.propertyKeyValue(big("7"), hooks, realm), {
    error: "none",
    value: "7",
  });
  for (const [input, expected] of [
    ["  0x1F\n", 31],
    ["-0", -0],
    [" ﻿", 0],
    ["1_0", NaN],
    ["-0x1", NaN],
    ["Infinity", Infinity],
    ["infinity", NaN],
  ] as const)
    assert.ok(
      Object.is(objects.numberValue(input, hooks, realm).value, expected),
      JSON.stringify(input),
    );
  assert.equal(objects.integerOrInfinity("-0.9", hooks, realm), 0);
  assert.ok(Object.is(objects.integerOrInfinity(-0.5, hooks, realm), 0));
  assert.equal(objects.integerOrInfinity("-Infinity", hooks, realm), -Infinity);
});

test("loose equality converts objects with the default hint across Symbol and BigInt", () => {
  const equal = (left: unknown, right: unknown) =>
    objects.looselyEqual(left, right, hooks, realm);
  const trace: string[] = [];
  const symbolBox = convertible(trace, "s", { exotic: returns(symbol) });
  assert.deepEqual(equal(symbol, symbolBox), { error: "none", value: true });
  assert.deepEqual(equal(symbolBox, symbol), { error: "none", value: true });
  assert.deepEqual(equal(symbol, objects.createSymbolValue("s")), {
    error: "none",
    value: false,
  });
  for (const other of [null, undefined, "s", 0, true])
    assert.deepEqual(equal(symbol, other), { error: "none", value: false });
  const bigBox = convertible(trace, "b", { valueOf: returns(big("2")) });
  assert.deepEqual(equal(bigBox, 2), { error: "none", value: true });
  assert.deepEqual(equal(big("2"), bigBox), { error: "none", value: true });
  assert.deepEqual(trace, [
    "s.toPrimitive",
    "s.toPrimitive",
    "b.valueOf",
    "b.valueOf",
  ]);
  for (const [left, right, expected] of [
    [big("1"), "0x1", true],
    [big("1"), "1n", false],
    [big("0"), "", true],
    [big("-1"), "-1", true],
    [big("1"), "1.0", false],
    [big("1"), true, true],
    [big("0"), false, true],
    [big("0"), -0, true],
    [big("9007199254740993"), 9007199254740992, false],
    [big("1"), NaN, false],
    [big("1"), Infinity, false],
    [big("0"), null, false],
    [big("0"), undefined, false],
    [big("2"), big("2"), true],
  ] as const) {
    assert.deepEqual(equal(left, right), { error: "none", value: expected });
    assert.deepEqual(equal(right, left), { error: "none", value: expected });
  }
  const failure = new Abrupt("toPrimitive");
  assert.throws(
    () => equal(symbol, convertible([], "t", { exotic: failure })),
    (e) => e === failure,
  );
  // Objects never convert when compared with null or undefined.
  const untouched: string[] = [];
  assert.deepEqual(
    equal(null, convertible(untouched, "n", { valueOf: returns(null) })),
    { error: "none", value: false },
  );
  assert.deepEqual(untouched, []);
});

const numberOperands = [
  0,
  -0,
  1,
  -1,
  2.5,
  -7,
  3,
  65536,
  2 ** 31,
  -(2 ** 31),
  2 ** 53,
  NaN,
  Infinity,
  -Infinity,
];
const numberOperators: readonly [string, (a: number, b: number) => unknown][] =
  [
    ["+", (a, b) => a + b],
    ["-", (a, b) => a - b],
    ["*", (a, b) => a * b],
    ["/", (a, b) => a / b],
    ["%", (a, b) => a % b],
    ["<", (a, b) => a < b],
    [">", (a, b) => a > b],
    ["<=", (a, b) => a <= b],
    [">=", (a, b) => a >= b],
    ["&", (a, b) => a & b],
    ["|", (a, b) => a | b],
    ["^", (a, b) => a ^ b],
    ["<<", (a, b) => a << b],
    [">>", (a, b) => a >> b],
    [">>>", (a, b) => a >>> b],
  ];
// `**` is implementation-approximated (Number::exponentiate), so it is excluded
// from this exact grid; the untouched-realm test below checks an exact power.
test("Number operands follow JavaScript results for every binary operator", () => {
  for (const [operator, expected] of numberOperators)
    for (const left of numberOperands)
      for (const right of numberOperands) {
        const result = binary(operator, left, right);
        assert.equal(result.error, "none");
        assert.ok(
          Object.is(result.value, expected(left, right)),
          `${left} ${operator} ${right}`,
        );
      }
  for (const value of numberOperands) {
    const increment = objects.updateObjectValue("++", value, hooks, realm);
    assert.equal(increment.error, "none");
    assert.ok(Object.is(increment.previous, value));
    assert.ok(Object.is(increment.value, value + 1));
    const decrement = objects.updateObjectValue("--", value, hooks, realm);
    assert.ok(Object.is(decrement.value, value - 1));
  }
});
test("Number operands need no coercion hooks or realm intrinsics", () => {
  const untouchable = new Proxy(
    {},
    {
      get(_target, key) {
        throw new Error("number operation read " + String(key));
      },
    },
  ) as never;
  for (const [operator, expected] of [
    ...numberOperators,
    ["**", (a: number, b: number) => a ** b] as const,
  ]) {
    const result = objects.binaryObjectValueOperation(
      operator,
      6,
      4,
      untouchable,
      untouchable,
    );
    assert.equal(result.error, "none");
    assert.ok(Object.is(result.value, expected(6, 4)), operator);
  }
  const update = objects.updateObjectValue("++", 41, untouchable, untouchable);
  assert.deepEqual(update, { error: "none", previous: 41, value: 42 });
});
