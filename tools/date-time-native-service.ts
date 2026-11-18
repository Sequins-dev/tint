import assert from "node:assert/strict";
import type { SourceModule } from "@tint/typescript/modules/model";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, type Statement } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { checkClosureModule } from "@tint/typescript/checker";
import { linkModules, specializeModule } from "@tint/ts-native/modules";
import { runtimeSources } from "@tint/compiler/cli";
import * as compiler from "@tint/compiler/native";
import { prepareNativeServiceSource } from "./native-service-source.ts";
import {
  prepareCachedNativeServiceUnit,
  createNativeServiceUnitIndex,
} from "./native-service-cache.ts";
import {
  workspaceModules,
  workspaceSourceIdentity,
  type WorkspaceSourceSnapshot,
} from "./workspace-sources.ts";
import { scriptRuntimeGlobals } from "./script-runtime-request.ts";
import type {
  NativeServiceImageSource,
  NativeServiceImagePlan,
} from "./native-service-image.ts";

const prefix = "packages/js-runtime/src/objects/",
  contracts = prefix + "date-time-service-contracts.ts",
  instance = prefix + "date-time-service-instance.ts",
  entry = prefix + "date-time-service-factory.ts",
  bindings = "date-time-service-host",
  facade = "date-time-service-facade";
const helpers = [
  [
    prefix + "date-time-service-helpers.ts",
    ["decodeUTF8", "createUTF8Decoder", "createDecimalNumberFormatter"],
  ],
  [
    prefix + "number-format-profile.ts",
    [
      "lookupNumberFormatLocale",
      "numberFormatLocaleKey",
      "numberFormatLocaleData",
    ],
  ],
  [prefix + "locale-canonicalization.ts", ["localeTableValue"]],
  [prefix + "decimal-number-format.ts", ["decimalNumberParts"]],
  [
    "packages/foundation/src/numeric/number-text/index.ts",
    ["decimalFromNumber"],
  ],
  [
    prefix + "calendar-query.ts",
    ["calendarMonthCode", "calendarInLeapYear", "calendarFieldsFromISO"],
  ],
  [
    "packages/foundation/src/chrono/gregorian-calendar/index.ts",
    ["epochDayFromGregorianCoordinate", "gregorianCoordinateFromEpochDay"],
  ],
  [prefix + "calendar.ts", ["canonicalCalendarIdentifier"]],
  [
    "packages/foundation/src/chrono/tzif/zone.ts",
    ["tzifOffsetSecondsAt", "tzifDaylightSavingAt"],
  ],
  [
    "packages/foundation/src/chrono/tzif/posix-offset.ts",
    ["posixTransitionEpochSeconds"],
  ],
  [prefix + "date-values.ts", ["dateFields", "clipDateTime"]],
  [prefix + "locale-id.ts", ["parseLocaleId"]],
  [prefix + "locale-info.ts", ["localeCalendars", "localeHourCycles"]],
  [prefix + "locale-likely.ts", ["maximizeLocaleId"]],
] as const;
const owned = new Set(
  [
    "date-time-format",
    "date-time-locale",
    "date-time-parts",
    "date-time-range",
    "date-time-calendar",
    "date-time-zone-data",
    "date-time-zone-name",
    "date-time-skeleton",
    "date-time-pattern",
    "date-time-format-options",
    "date-time-format-data",
    "date-time-zone-format-data",
    "locale-data-pack",
    "date-time-service-factory",
  ].map((name) => prefix + name + ".ts"),
);
// Pattern syntax and option validation are also used by the observable host adapter.
const removed = new Set(
  [...owned].filter(
    (id) =>
      id !== prefix + "date-time-pattern.ts" &&
      id !== prefix + "date-time-format-options.ts",
  ),
);
function parse(text: string) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
export function dateTimeNativeServiceSource(
  snapshot: WorkspaceSourceSnapshot,
): NativeServiceImageSource {
  const host: SourceModule = {
    id: bindings,
    module: parse(
      'import type {ManagedSurfaceExport} from "compiler";import type {DateTimeService} from "contracts";export interface Frame{readonly $imports:unknown;}export function bind():ManagedSurfaceExport{throw "MANAGED_SURFACE_UNBOUND";}export function view(value:unknown):DateTimeService|undefined{throw "DATE_TIME_SERVICE_VIEW_UNBOUND";}',
    ),
    dependencies: new Map([
      ["compiler", "packages/compiler/src/native/index.ts"],
      ["contracts", contracts],
    ]),
  };
  const factory: SourceModule = {
    id: facade,
    module: parse(
      'interface Frame{readonly $imports:unknown;}export function instantiate(frame:Frame):unknown{throw "DATE_TIME_SERVICE_FACTORY_UNBOUND";}',
    ),
    dependencies: new Map(),
  };
  const adapter: SourceModule = {
    id: instance,
    module: parse(
      'import type {DateTimeService} from "contracts";import {bind,view} from "host";import {instantiate} from "factory";let service:DateTimeService|undefined=undefined;export function getDateTimeService():DateTimeService{if(service===undefined){const value=view(instantiate({$imports:bind().table}));if(value===undefined)throw "DATE_TIME_SERVICE_FACTORY_CONTRACT";service=value;}return service;}',
    ),
    dependencies: new Map([
      ["contracts", contracts],
      ["host", bindings],
      ["factory", facade],
    ]),
  };
  return {
    transformModules<T extends { readonly id: string }>(modules: readonly T[]) {
      const result = new Map<string, T | SourceModule>();
      for (const module of modules)
        if (!removed.has(module.id))
          result.set(module.id, module.id === instance ? adapter : module);
      result.set(bindings, host);
      result.set(facade, factory);
      return [...result.values()];
    },
    surface: {
      name: "dateTime",
      values: helpers.flatMap(([module, names]) =>
        names.map((name) => ({ module, name, typeArguments: [] })),
      ),
      types: [
        { module: bindings, name: "Frame", typeArguments: [] },
        { module: contracts, name: "DateTimeService", typeArguments: [] },
        {
          module: contracts,
          name: "DateTimeServiceStorage",
          typeArguments: [],
        },
      ],
      frame: "Frame",
      bind: { module: bindings, name: "bind" },
    },
    runtimes: [
      {
        module: bindings,
        namespace: "date-time-service-view",
        retainedExports: ["view"],
      },
      { module: facade, namespace: "date-time-service-factory" },
    ],
    recordBindings: [{ module: bindings, name: "view", operation: "view" }],
  };
}

/** Prepare once per frozen toolchain; every batch reuses the same verified unit.
 * Signature-only syntax below derives exact contracts and never reaches native
 * lowering. The actual host functions are independently checked at composition. */
export function prepareDateTimeNativeService(
  snapshot: WorkspaceSourceSnapshot,
  toolchainSha256: string,
  cacheDirectory: string,
  options: {
    readonly linearAllocation?: boolean;
    readonly generationalBarriers?: boolean;
  } = {},
): NativeServiceImagePlan & {
  readonly hit: boolean;
  readonly unitBytes: number;
} {
  const modules = workspaceModules([entry], snapshot),
    hostImports = helpers.flatMap(([module, names]) =>
      names.map((name) => ({ module, name, imported: name })),
    ),
    source = prepareNativeServiceSource({
      modules,
      entry,
      factory: "createDateTimeService",
      ownedModules: owned,
      globals: scriptRuntimeGlobals,
      specifier: "date-time-host",
      hostImports,
      hostConstants: [
        { module: prefix + "locale-objects.ts", name: "runtimeDefaultLocale" },
      ],
    });
  assert.ok(source.ok, JSON.stringify(source));
  const linked = linkModules(modules, entry, scriptRuntimeGlobals, {
    evaluation: "instance",
  });
  assert.ok(linked.ok, JSON.stringify(linked));
  const linkedProgram = linked.value;
  function exported(module: string, name: string, namespace: "value" | "type") {
    const item = linkedProgram.exports.find(
      (item) =>
        item.module === module &&
        item.name === name &&
        item.namespace === namespace,
    );
    assert.ok(item, module + ":" + name);
    return item.linkedName;
  }
  const selected = hostImports.map((item) => ({
      name: item.imported,
      local: exported(item.module, item.name, "value"),
    })),
    names = new Set(selected.map((item) => item.local));
  const statements: Statement[] = linked.value.module.statements
    .filter(
      (statement) =>
        statement.kind === "interface" ||
        statement.kind === "type-alias" ||
        (statement.kind === "function" && names.has(statement.name)),
    )
    .map((statement) =>
      statement.kind !== "function"
        ? statement
        : {
            ...statement,
            body: {
              kind: "block",
              start: 0,
              end: 0,
              statements: [
                {
                  kind: "throw",
                  start: 0,
                  end: 0,
                  expression: {
                    kind: "string",
                    start: 0,
                    end: 0,
                    value: "DECLARATION_ONLY_HOST_SCHEMA",
                  },
                },
              ],
            },
          },
    );
  statements.push(
    ...parse("interface $DateTimeFrame{readonly $imports:unknown;}").statements,
  );
  const schema = { ...linked.value.module, statements, imports: [] },
    bound = bindModule(schema, scriptRuntimeGlobals);
  assert.ok(bound.ok, JSON.stringify(bound));
  const specialized = specializeModule(schema, bound.value, {
    maxSpecializations: 8192,
  });
  assert.ok(specialized.ok, JSON.stringify(specialized));
  const checked = checkClosureModule(specialized.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const described = compiler.reifyManagedSurfaceTypes(
    checked.value,
    selected,
    "$DateTimeServiceHost",
    [
      { name: "Frame", local: "$DateTimeFrame" },
      {
        name: "DateTimeService",
        local: exported(contracts, "DateTimeService", "type"),
      },
      {
        name: "DateTimeServiceStorage",
        local: exported(contracts, "DateTimeServiceStorage", "type"),
      },
    ],
  );
  assert.ok(described.ok, JSON.stringify(described));
  const canonical = compiler.canonicalizeManagedSurfaceTypes(described.value);
  assert.ok(canonical.ok, JSON.stringify(canonical));
  const runtimes = runtimeSources(),
    runtime = {
      modules: workspaceModules(
        runtimes.map((item) => item.module),
        snapshot,
      ),
      runtimes,
      globals: scriptRuntimeGlobals,
      maxSpecializations: 8192,
    },
    facts = compiler.deriveManagedSurfacePhysicalFacts(
      canonical.value,
      runtime,
    );
  assert.ok(facts.ok, JSON.stringify(facts));
  const directory = compiler.createManagedSurfaceDirectory(
    "dateTime",
    canonical.value,
    facts.value,
    "Frame",
  );
  assert.ok(directory.ok, JSON.stringify(directory));
  const functions: unknown[] = Array.from(
    {
      length: canonical.value.entries.length + directory.value.witnesses.length,
    },
    () => () => 42,
  );
  const read = compiler.readManagedSurfaceDirectory(
    {
      directory: directory.value.directory,
      table: undefined,
      functions,
      records: Float64Array.from(
        directory.value.directory.records,
        (_, i) => 0x100000 + i * 1024,
      ),
      entries: Float64Array.from(
        directory.value.directory.runtimes.flatMap((provider) =>
          provider.operations.flatMap((_, i) => [
            0x400004 + i * 4,
            0x500000 + i * 128,
          ]),
        ),
      ),
    },
    "dateTime",
    {
      domain: () => 17,
      descriptor: () => 0x200000,
      signature: (fn) => 0x300000 + functions.indexOf(fn) * 128,
    },
  );
  assert.ok(read.ok, JSON.stringify(read));
  const cached = prepareCachedNativeServiceUnit(cacheDirectory, {
    toolchainSha256,
    sourceSnapshotSha256: workspaceSourceIdentity(snapshot).sha256,
    request: {
      linearAllocation: options.linearAllocation ?? false,
      generationalBarriers: options.generationalBarriers ?? false,
      module: source.value.module,
      entry: source.value.entry,
      specifiers: new Set(["date-time-host"]),
      instantiations: new Map(),
      read: read.value,
      runtime,
    },
    data: [],
  });
  const index = createNativeServiceUnitIndex([
    { cached, bind: { module: facade, name: "instantiate" } },
  ]);
  return {
    ...dateTimeNativeServiceSource(snapshot),
    services: index.services,
    identity: index.identity,
    hit: cached.hit,
    unitBytes: cached.unit.native.code.length,
  };
}
