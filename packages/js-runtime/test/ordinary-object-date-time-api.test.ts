import { after, test } from "node:test";
import assert from "node:assert/strict";
import type {
  OrdinaryObject,
  ScriptPropertyKey,
  ObjectHooks,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
const o = await import("../src/objects/index.ts");
type Obj = OrdinaryObject<ScriptPropertyKey, unknown>;
function setup() {
  const root = o.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (fn, receiver, args) => {
      const r = o.callObjectValue(fn, receiver, args, root);
      assert.equal(r.error, "none");
      return r.value;
    },
  };
  const realm = o.createErrorRealm(root, hooks);
  realm.systemTimeZoneIdentifier = () => "UTC";
  realm.wallClockMilliseconds = () => 0;
  o.installIntlIntrinsics(root, realm, hooks);
  const intl = o.getOwnProperty(root, "Intl")!.value as Obj;
  const constructor = o.getOwnProperty(intl, "DateTimeFormat")?.value as Obj;
  assert.ok(constructor, "DateTimeFormat is installed");
  const prototype = o.getOwnProperty(constructor, "prototype")!.value as Obj;
  const get = (object: Obj, key: string) =>
    o.getProperty(object, key, object, hooks);
  const call = (name: string, receiver: unknown, args: unknown[] = []) =>
    (get(prototype, name) as Obj).internalRareSlots!.internalCall!(
      receiver,
      args,
    );
  const options = (fields: Record<string, unknown>) => {
    const result = o.createObject<ScriptPropertyKey, unknown>(undefined);
    for (const [k, v] of Object.entries(fields))
      o.createDataProperty(result, k, v, hooks);
    return result;
  };
  const make = (locale: unknown = "en", input: unknown = undefined) => {
    return constructor.internalRareSlots!.internalConstruct!(
      [locale, input],
      constructor,
    ) as Obj;
  };
  const type = (run: () => unknown, kind: string) =>
    assert.throws(
      run,
      (e) => (e as Obj).prototype === realm.prototypes.get(kind),
    );
  return {
    root,
    realm,
    hooks,
    intl,
    constructor,
    prototype,
    get,
    call,
    options,
    make,
    type,
  };
}

function formatted(
  r: ReturnType<typeof setup>,
  formatter: Obj,
  value: unknown = 0,
): string {
  const bound = r.get(formatter, "format") as Obj;
  return bound.internalRareSlots!.internalCall!(undefined, [value]) as string;
}
function records(
  r: ReturnType<typeof setup>,
  array: Obj,
): Record<string, unknown>[] {
  return Array.from({ length: Number(r.get(array, "length")) }, (_, index) => {
    const item = r.get(array, String(index)) as Obj;
    const result: Record<string, unknown> = {
      type: r.get(item, "type"),
      value: r.get(item, "value"),
    };
    if (o.getOwnProperty(item, "source")) result.source = r.get(item, "source");
    return result;
  });
}
test("DateTimeFormat installs metadata, a cached bound format and usable defaults", () => {
  const r = setup(),
    f = r.make();
  assert.equal(r.get(r.constructor, "name"), "DateTimeFormat");
  assert.equal(r.get(r.constructor, "length"), 0);
  const bound = r.get(f, "format") as Obj;
  assert.equal(bound, r.get(f, "format"));
  assert.equal(r.get(bound, "name"), "");
  assert.equal(r.get(bound, "length"), 1);
  assert.equal(bound.internalRareSlots?.internalConstruct, undefined);
  assert.equal(formatted(r, f), "1/1/1970");
  assert.equal(
    bound.internalRareSlots!.internalCall!(r.options({}), []),
    "1/1/1970",
  );
  const plain = r.constructor.internalRareSlots!.internalCall!(
    undefined,
    [],
  ) as Obj;
  assert.equal(formatted(r, plain), "1/1/1970");
});
test("parts and resolved options are fresh records from the method realm", () => {
  const r = setup(),
    foreign = setup(),
    f = foreign.make(
      "en",
      foreign.options({
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    );
  const parts = r.call("formatToParts", f, [Date.UTC(2019, 0, 3)]) as Obj;
  assert.equal(parts.prototype, r.realm.arrayPrototype);
  assert.equal((r.get(parts, "0") as Obj).prototype, r.realm.objectPrototype);
  assert.equal(
    records(r, parts)
      .map((x) => x.value)
      .join(""),
    "Jan 3, 2019",
  );
  assert.notEqual(parts, r.call("formatToParts", f, [Date.UTC(2019, 0, 3)]));
  const options = r.call("resolvedOptions", f) as Obj;
  assert.equal(options.prototype, r.realm.objectPrototype);
  assert.equal(r.get(options, "timeZone"), "UTC");
  assert.equal(r.get(options, "calendar"), "gregory");
  assert.equal(r.get(options, "hourCycle"), undefined);
});
test("styles suppress component metadata and choose the requested clock cycle", () => {
  const r = setup(),
    f = r.make(
      "en",
      r.options({ dateStyle: "long", timeStyle: "short", hourCycle: "h24" }),
    );
  assert.equal(formatted(r, f), "January 1, 1970 at 24:00");
  const options = r.call("resolvedOptions", f) as Obj;
  assert.equal(r.get(options, "dateStyle"), "long");
  assert.equal(r.get(options, "hourCycle"), "h24");
  assert.equal(r.get(options, "hour12"), false);
  assert.equal(o.getOwnProperty(options, "year"), undefined);
  r.type(
    () => r.make("en", r.options({ dateStyle: "long", era: "short" })),
    "type",
  );
});
test("calendar and numbering options negotiate independently of Unicode extensions", () => {
  const r = setup(),
    f = r.make(
      "en-u-ca-hebrew-hc-h24-nu-arab",
      r.options({
        calendar: "invalid",
        numberingSystem: "latn",
        hour: "numeric",
      }),
    );
  const resolved = r.call("resolvedOptions", f) as Obj;
  assert.equal(r.get(resolved, "locale"), "en-u-ca-hebrew-hc-h24");
  assert.equal(r.get(resolved, "calendar"), "hebrew");
  assert.equal(r.get(resolved, "numberingSystem"), "latn");
  assert.equal(r.get(resolved, "hourCycle"), "h24");
  for (const calendar of ["", "a", "gregory-nu-latn", "gregoryé"])
    r.type(() => r.make("en", r.options({ calendar })), "range");
  r.type(() => r.make("en", r.options({ hourCycle: "H23" })), "range");
  r.type(() => r.make("en", r.options({ fractionalSecondDigits: 0 })), "range");
  r.type(() => r.make("en", null), "type");
});
test("range validation rejects missing endpoints before coercion and preserves reverse order", () => {
  const r = setup(),
    f = r.make(
      "en",
      r.options({ year: "numeric", month: "short", day: "numeric" }),
    );
  let touched = 0;
  const poison = r.options({
    valueOf: o.createCallableObject<ScriptPropertyKey, unknown>(
      r.realm.functionPrototype,
      () => {
        touched++;
        throw "poison";
      },
    ),
  });
  r.type(() => r.call("formatRange", f, [undefined, poison]), "type");
  r.type(() => r.call("formatRange", f, [poison, undefined]), "type");
  assert.equal(touched, 0);
  const a = Date.UTC(2019, 0, 3),
    b = Date.UTC(2019, 0, 5);
  assert.equal(r.call("formatRange", f, [b, a]), "Jan 5\u2009–\u20093, 2019");
  const parts = records(r, r.call("formatRangeToParts", f, [a, b]) as Obj);
  assert.equal(parts.find((x) => x.type === "month")?.source, "shared");
  assert.equal(parts.find((x) => x.type === "day")?.source, "startRange");
  r.type(() => r.call("formatRange", f, [NaN, b]), "range");
  r.type(() => r.call("formatToParts", r.options({}), [poison]), "type");
  assert.equal(touched, 0);
});
test("legacy chaining unwraps only the format getter and resolvedOptions", () => {
  const r = setup(),
    receiver = o.createObject<ScriptPropertyKey, unknown>(r.prototype);
  assert.equal(
    r.constructor.internalRareSlots!.internalCall!(receiver, ["en"]),
    receiver,
  );
  assert.equal(formatted(r, receiver), "1/1/1970");
  assert.equal(
    r.get(r.call("resolvedOptions", receiver) as Obj, "calendar"),
    "gregory",
  );
  r.type(() => r.call("formatToParts", receiver, [0]), "type");
  r.type(() => r.call("formatRange", receiver, [0, 1]), "type");
  r.type(
    () => r.constructor.internalRareSlots!.internalCall!(receiver, ["en"]),
    "type",
  );
});
test("options are read once in specification order, including overridden hourCycle", () => {
  const r = setup(),
    options = r.options({}),
    seen: string[] = [];
  const names = [
    "localeMatcher",
    "calendar",
    "numberingSystem",
    "hour12",
    "hourCycle",
    "timeZone",
    "weekday",
    "era",
    "year",
    "month",
    "day",
    "dayPeriod",
    "hour",
    "minute",
    "second",
    "fractionalSecondDigits",
    "timeZoneName",
    "formatMatcher",
    "dateStyle",
    "timeStyle",
  ];
  for (const key of names) {
    const getter = o.createCallableObject<ScriptPropertyKey, unknown>(
      r.realm.functionPrototype,
      () => {
        seen.push(key);
        return key === "hour12" ? true : undefined;
      },
    );
    o.defineOwnProperty(
      options,
      key,
      {
        fields: 60,
        value: undefined,
        writable: false,
        get: getter,
        set: undefined,
        enumerable: true,
        configurable: true,
      },
      r.hooks,
    );
  }
  r.make("en", options);
  assert.deepEqual(seen, names);
});
test("coercions and time clipping preserve abrupt completion and exact bounds", () => {
  const r = setup(),
    f = r.make(
      "en",
      r.options({
        timeZone: "+01:00",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        hourCycle: "h23",
      }),
    );
  assert.equal(formatted(r, f, -1.9), "01/01/1970, 00:59:59.999");
  r.type(() => formatted(r, f, Infinity), "range");
  r.type(() => formatted(r, f, 8640000000000001), "range");
  assert.ok(formatted(r, f, 8640000000000000).includes("275760"));
  const poison = r.options({
    valueOf: o.createCallableObject<ScriptPropertyKey, unknown>(
      r.realm.functionPrototype,
      () => {
        throw "coercion";
      },
    ),
  });
  assert.throws(
    () => formatted(r, f, poison),
    (e) => e === "coercion",
  );
});
test("two-digit time components retain requested minimum padding with a twelve-hour locale", () => {
  const r = setup(),
    f = r.make(
      "en-US",
      r.options({ hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    );
  assert.ok(
    formatted(r, f, Date.UTC(2024, 0, 1, 2, 35, 6)).includes("02:35:06"),
  );
});
test("flexible periods use the containing night at midnight and retain exact noon", () => {
  const r = setup(),
    f = r.make("en", r.options({ dayPeriod: "long" }));
  assert.equal(formatted(r, f, Date.UTC(2024, 0, 1)), "at night");
  assert.equal(formatted(r, f, Date.UTC(2024, 0, 1, 12)), "noon");
});
test("named time-zone identifiers preserve available alias identity and canonical casing", () => {
  const r = setup();
  r.realm.namedTimeZones = {
    lookup(value) {
      const identifier =
        value.toLowerCase() === "australia/canberra"
          ? "Australia/Canberra"
          : value.toLowerCase() === "etc/utc"
            ? "Etc/UTC"
            : undefined;
      if (identifier === undefined) return { status: "unknown" };
      return {
        status: "available",
        identifier: {
          identifier,
          dataIdentifier: identifier,
          primaryIdentifier:
            identifier === "Etc/UTC" ? "UTC" : "Australia/Sydney",
        },
        zone: {
          data: {
            version: 0,
            transitions: [],
            types: [
              {
                offsetSeconds: 0,
                daylightSaving: false,
                designation: [],
                standard: false,
                universal: false,
              },
            ],
            footer: undefined,
          },
          transitionSeconds: [],
          future: undefined,
          futureStatus: "absent",
          unspecifiedOffsetPolicy: "stored",
        },
      };
    },
  };
  for (const [input, expected] of [
    ["AUSTRALIA/CANBERRA", "Australia/Canberra"],
    ["Etc/UTC", "Etc/UTC"],
  ]) {
    const f = r.make("en", r.options({ timeZone: input }));
    assert.equal(
      r.get(r.call("resolvedOptions", f) as Obj, "timeZone"),
      expected,
    );
  }
});
test("two-digit clock matching uses available CLDR ASCII alternates independently of numbering digits", () => {
  const r = setup(),
    f = r.make(
      "en-US-u-nu-hanidec",
      r.options({ hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    );
  assert.equal(
    formatted(r, f, Date.UTC(2024, 0, 1, 2, 35, 6)),
    "〇二:三五:〇六 AM",
  );
});
test("supportedLocalesOf uses shipped lookup data without consulting clock or time-zone capabilities", () => {
  const r = setup();
  r.realm.systemTimeZoneIdentifier = undefined;
  r.realm.wallClockMilliseconds = undefined;
  const method = r.get(r.constructor, "supportedLocalesOf") as Obj;
  const requested = r.options({
    0: "qaa",
    1: "fr-CA-u-ca-hebrew",
    2: "en",
    length: 3,
  });
  const result = method.internalRareSlots!.internalCall!(undefined, [
    requested,
  ]) as Obj;
  assert.equal(r.get(result, "length"), 2);
  assert.equal(r.get(result, "0"), "fr-CA-u-ca-hebrew");
  assert.equal(r.get(result, "1"), "en");
  r.type(
    () =>
      method.internalRareSlots!.internalCall!(undefined, [
        requested,
        r.options({ localeMatcher: "invalid" }),
      ]),
    "range",
  );
});
test("newTarget prototype is selected before locale list access", () => {
  const r = setup(),
    seen: string[] = [],
    prototype = r.options({}),
    target = o.createConstructorObject<ScriptPropertyKey, unknown>(
      r.realm.functionPrototype,
      () => undefined,
      () => prototype,
    ),
    locales = r.options({});
  const getter = (name: string, result: unknown) =>
    o.createCallableObject<ScriptPropertyKey, unknown>(
      r.realm.functionPrototype,
      () => {
        seen.push(name);
        return result;
      },
    );
  for (const [object, key, name, value] of [
    [target, "prototype", "prototype", prototype],
    [locales, "length", "locales", 0],
  ] as const)
    o.defineOwnProperty(
      object,
      key,
      {
        fields: 60,
        value: undefined,
        writable: false,
        get: getter(name, value),
        set: undefined,
        enumerable: false,
        configurable: true,
      },
      r.hooks,
    );
  const result = r.constructor.internalRareSlots!.internalConstruct!(
    [locales],
    target,
  ) as Obj;
  assert.equal(result.prototype, prototype);
  assert.deepEqual(seen, ["prototype", "locales"]);
});
test("part records create own data properties without invoking inherited setters", () => {
  const r = setup(),
    f = r.make();
  let writes = 0;
  const setter = o.createCallableObject<ScriptPropertyKey, unknown>(
    r.realm.functionPrototype,
    () => {
      writes++;
      throw "setter";
    },
  );
  o.defineOwnProperty(
    r.realm.objectPrototype,
    "type",
    {
      fields: 60,
      value: undefined,
      writable: false,
      get: undefined,
      set: setter,
      enumerable: false,
      configurable: true,
    },
    r.hooks,
  );
  const parts = r.call("formatToParts", f, [0]) as Obj,
    first = r.get(parts, "0") as Obj;
  assert.equal(r.get(first, "type"), "month");
  assert.equal(writes, 0);
  assert.equal(o.getOwnProperty(first, "type")?.writable, true);
  assert.equal(o.getOwnProperty(first, "type")?.enumerable, true);
});
