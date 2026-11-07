import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  linkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import {
  compileNativeServiceUnit,
  selectManagedIdentityBindings,
  type NativeServiceUnit,
  type ManagedSurfaceEntryRequest,
  type ManagedIdentityBinding,
} from "@tint/compiler/native";

export interface NativeServiceCacheInputs {
  readonly toolchainSha256: string;
  readonly sourceSnapshotSha256: string;
  readonly request: ManagedSurfaceEntryRequest;
  readonly data: readonly {
    readonly name: string;
    readonly bytes: Uint8Array;
  }[];
}
export interface CachedNativeServiceUnit {
  readonly key: string;
  readonly digest: string;
  readonly hit: boolean;
  readonly unit: NativeServiceUnit;
}
export interface NativeServiceUnitIndex {
  readonly version: 1;
  readonly linkingMode: "aot-native-services-v1";
  readonly units: readonly {
    readonly bind: { readonly module: string; readonly name: string };
    readonly key: string;
    readonly digest: string;
  }[];
}
/** Construct a run-owned copy and a deterministic index for manifests, journals
 * and resume identity. Verify the artifact again before copying mutable bytes. */
export function createNativeServiceUnitIndex(
  entries: readonly {
    readonly cached: CachedNativeServiceUnit;
    readonly bind: { readonly module: string; readonly name: string };
  }[],
) {
  if (entries.length === 0) fail("a unit index requires at least one artifact");
  const names = new Set<string>();
  const units: NativeServiceUnitIndex["units"][number][] = [],
    services: {
      readonly unit: NativeServiceUnit;
      readonly bind: { readonly module: string; readonly name: string };
    }[] = [];
  for (const entry of entries) {
    const { cached, bind } = entry;
    if (
      !/^[a-f0-9]{64}$/.test(cached.key) ||
      digest(JSON.stringify(encode(cached.unit))) !== cached.digest
    )
      fail("unit artifact content differs");
    const name = bind.module + ":" + bind.name;
    if (!bind.module || !bind.name || names.has(name))
      fail("invalid or duplicate unit binding");
    names.add(name);
    units.push({ bind: { ...bind }, key: cached.key, digest: cached.digest });
    services.push({ bind: { ...bind }, unit: structuredClone(cached.unit) });
  }
  const index: NativeServiceUnitIndex = {
    version: 1,
    linkingMode: "aot-native-services-v1",
    units,
  };
  return {
    index,
    services,
    identity: {
      nativeLinkingMode: index.linkingMode,
      nativeServiceUnitIndexSha256: digest(JSON.stringify(encode(index))),
    },
  };
}
function fail(message: string): never {
  throw Error("native service cache: " + message);
}
function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function fields(value: object, allowed: readonly string[]): void {
  for (const name of Object.keys(value))
    if (!allowed.includes(name)) fail("unknown field " + name);
}
/** Lossless tagged data, with explicit undefined, -0 and UTF-16 text. Unknown
 * host objects and functions cannot silently disappear from a cache identity. */
function encode(value: unknown, seen: Set<object> = new Set()): unknown {
  if (value === undefined) return ["undefined"];
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return ["value", value];
  if (typeof value === "number")
    return ["number", Object.is(value, -0) ? "-0" : String(value)];
  if (typeof value !== "object") return fail("unkeyable input " + typeof value);
  if (seen.has(value)) return fail("cyclic input");
  seen.add(value);
  try {
    if (value instanceof Uint8Array)
      return ["bytes", Buffer.from(value).toString("base64")];
    if (Array.isArray(value))
      return ["array", value.map((item) => encode(item, seen))];
    if (value instanceof Map)
      return [
        "map",
        [...value].map(([key, item]) => [
          encode(key, seen),
          encode(item, seen),
        ]),
      ];
    if (value instanceof Set)
      return ["set", [...value].map((item) => encode(item, seen))];
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return fail("unkeyable host object");
    return [
      "object",
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          encode((value as Record<string, unknown>)[key], seen),
        ]),
    ];
  } finally {
    seen.delete(value);
  }
}
function decode(value: unknown): unknown {
  if (!Array.isArray(value) || typeof value[0] !== "string")
    return fail("invalid encoded payload");
  const [tag, body] = value;
  if (tag === "undefined" && value.length === 1) return undefined;
  if (value.length !== 2) return fail("invalid encoded tuple");
  if (
    tag === "value" &&
    (body === null || typeof body === "string" || typeof body === "boolean")
  )
    return body;
  if (tag === "number" && typeof body === "string") {
    const number = body === "-0" ? -0 : Number(body);
    if ((Object.is(number, -0) ? "-0" : String(number)) !== body)
      return fail("invalid number");
    return number;
  }
  if (tag === "bytes" && typeof body === "string") {
    const bytes = Buffer.from(body, "base64");
    if (bytes.toString("base64") !== body) return fail("invalid byte encoding");
    return new Uint8Array(bytes);
  }
  if (!Array.isArray(body)) return fail("invalid encoded collection");
  if (tag === "array") return body.map(decode);
  if (tag === "set") return new Set(body.map(decode));
  if (tag === "map")
    return new Map(
      body.map((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2)
          return fail("invalid map pair");
        return [decode(pair[0]), decode(pair[1])];
      }),
    );
  if (tag === "object") {
    const names = new Set<string>();
    return Object.fromEntries(
      body.map((pair) => {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          typeof pair[0] !== "string" ||
          names.has(pair[0])
        )
          return fail("invalid object pair");
        names.add(pair[0]);
        return [pair[0], decode(pair[1])];
      }),
    );
  }
  return fail("unknown payload tag");
}
function shape(binding: ManagedIdentityBinding): unknown {
  return {
    name: binding.name,
    contract: binding.contract,
    role: binding.role,
    parameters: binding.parameters,
    returnType: binding.returnType,
    recordLayout: binding.recordLayout,
  };
}
function capture(input: NativeServiceCacheInputs): unknown {
  fields(input, ["toolchainSha256", "sourceSnapshotSha256", "request", "data"]);
  for (const hash of [input.toolchainSha256, input.sourceSnapshotSha256])
    if (!/^[a-f0-9]{64}$/.test(hash)) fail("invalid frozen digest");
  const request = input.request,
    runtime = request.runtime,
    read = request.read;
  fields(request, [
    "module",
    "entry",
    "specifiers",
    "instantiations",
    "read",
    "runtime",
    "target",
    "initialization",
    "linearAllocation",
    "generationalBarriers",
  ]);
  fields(runtime, [
    "modules",
    "runtimes",
    "globals",
    "target",
    "maxSpecializations",
  ]);
  if (
    request.initialization !== undefined &&
    request.initialization !== "factory"
  )
    fail("unknown initialization policy");
  const names = new Set<string>();
  for (const item of input.data) {
    fields(item, ["name", "bytes"]);
    if (
      !item.name ||
      names.has(item.name) ||
      !(item.bytes instanceof Uint8Array)
    )
      fail("invalid data input");
    names.add(item.name);
  }
  return {
    version: 1,
    profile: "managed-factory-v1",
    host: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    toolchain: input.toolchainSha256,
    snapshot: input.sourceSnapshotSha256,
    data: input.data,
    request: {
      module: request.module,
      entry: request.entry,
      specifiers: request.specifiers,
      instantiations: request.instantiations,
      target: request.target ?? runtime.target,
      initialization: "factory",
      linearAllocation: request.linearAllocation ?? false,
      generationalBarriers: request.generationalBarriers ?? false,
      directory: read.directory,
      surface: read.contracts.surface,
      identities: [
        shape(read.brand),
        ...read.signatures.map(shape),
        ...read.records.map(shape),
        ...read.runtimes.map(shape),
      ],
      runtime: {
        ...runtime,
        maxSpecializations: runtime.maxSpecializations ?? 4096,
        modules: runtime.modules.map((source) => {
          fields(source, ["id", "module", "dependencies", "sourcePosition"]);
          // Managed entry emission does not consume sourcePosition callbacks or emit
          // debug spans. Its parsed spans and logical source identities remain keyed.
          return {
            id: source.id,
            module: source.module,
            dependencies: source.dependencies,
          };
        }),
      },
    },
  };
}
export function nativeServiceCacheKey(input: NativeServiceCacheInputs): string {
  return digest(JSON.stringify(encode(capture(input))));
}
function validateUnit(
  unit: NativeServiceUnit,
  input: NativeServiceCacheInputs,
): void {
  const directory = input.request.read.directory;
  if (
    unit.factoryContract !==
      "tint.service.factory.v1/" + directory.name + "/" + directory.digest ||
    unit.surface.name !== directory.name ||
    unit.surface.digest !== directory.digest ||
    unit.surface.frame !== directory.frame
  )
    fail("factory surface contract differs");
  if (
    unit.version !== 1 ||
    unit.profile !== "managed-factory-v1" ||
    !(unit.native.code instanceof Uint8Array) ||
    !Number.isInteger(unit.entryOffset) ||
    unit.entryOffset < 0 ||
    unit.entryOffset >= unit.native.code.length ||
    !unit.native.functions.some(
      (fn) => fn.import !== true && fn.offset === unit.entryOffset,
    )
  )
    fail("invalid unit profile or entry");
  const selected = selectManagedIdentityBindings(
    input.request.read,
    unit.native.managedImports,
  );
  if (!selected.ok) fail(selected.error);
}
/** The caller supplies a verified frozen toolchain digest. The key captures the
 * actual compiler request as well as its source/grant snapshot and data, rather
 * than trusting a manually assembled list of dependencies. Artifacts contain
 * no context domains or addresses; current authority is checked on every hit. */
export function prepareCachedNativeServiceUnit(
  directory: string,
  input: NativeServiceCacheInputs,
): CachedNativeServiceUnit {
  const key = nativeServiceCacheKey(input),
    path = join(directory, key + ".json");
  function read(): CachedNativeServiceUnit | undefined {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const stored = JSON.parse(bytes.toString()) as {
        version: number;
        key: string;
        digest: string;
        payload: string;
      };
      fields(stored, ["version", "key", "digest", "payload"]);
      if (
        stored.version !== 1 ||
        stored.key !== key ||
        typeof stored.payload !== "string" ||
        stored.digest !== digest(stored.payload)
      )
        return fail("artifact key, version or content differs");
      const unit = decode(JSON.parse(stored.payload)) as NativeServiceUnit;
      validateUnit(unit, input);
      return { key, digest: stored.digest, unit, hit: true };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("native service cache:")
      )
        throw error;
      return fail("invalid artifact: " + String(error));
    }
  }
  const cached = read();
  if (cached !== undefined) return cached;
  const compiled = compileNativeServiceUnit(input.request);
  if (!compiled.ok)
    return fail(compiled.error.stage + ": " + compiled.error.message);
  validateUnit(compiled.value, input);
  const payload = JSON.stringify(encode(compiled.value)),
    hash = digest(payload),
    stored = JSON.stringify({ version: 1, key, digest: hash, payload }) + "\n";
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, "." + key + "." + randomUUID() + ".tmp");
  try {
    writeFileSync(temporary, stored, { flag: "wx", mode: 0o600 });
    try {
      linkSync(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const winner = read();
      if (winner === undefined || winner.digest !== hash)
        return fail("concurrent artifact differs");
      return winner;
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { key, digest: hash, unit: compiled.value, hit: false };
}
