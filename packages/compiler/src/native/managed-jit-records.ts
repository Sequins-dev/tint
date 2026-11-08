import type { CheckedClosures } from "@tint/typescript/checker";
import type { ManagedRecordBinding } from "@tint/codegen/aarch64/scalar";
import type { RecordLayout } from "@tint/ir/scalar";
import type { LoweredManagedJitProgram } from "./managed-jit-program.ts";
import {
  managedTypeContracts,
  type ManagedTypeContractCache,
} from "./managed-contracts.ts";
import { sameManagedRecordLayout } from "./managed-imports.ts";
import { managedSurfaceContract } from "./managed-directory-reader.ts";
export interface ManagedJitRecordSurface {
  readonly name: string;
  readonly digest: string;
  readonly records: readonly {
    readonly alias: string;
    readonly aliases: readonly string[];
    readonly layout: RecordLayout;
  }[];
}
export interface ManagedJitRecordTypes {
  readonly typeContracts?: ManagedTypeContractCache;
  readonly checked: CheckedClosures;
  readonly aliasTypes: ReadonlyMap<string, number>;
}
export type ManagedJitRecordBindings =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: readonly ManagedRecordBinding[] };
/** Equal storage is only a compatibility check. Exact checked types select the
 * semantic class; no native address or physical layout grants membership. */
export function bindManagedJitRecords(
  program: ManagedJitRecordTypes,
  lowered: LoweredManagedJitProgram,
  surface: ManagedJitRecordSurface,
  requiredAliases: readonly string[],
): ManagedJitRecordBindings {
  const reject = (error: string): ManagedJitRecordBindings => ({
    ok: false,
    error: "profile: " + error,
  });
  const types = lowered.recordTypes;
  if (types === undefined) return reject("record type identities are missing");
  const records = lowered.module.records ?? [];
  const compare = managedTypeContracts(program.checked, program.typeContracts);
  if (!compare.ok) return reject(compare.error);
  function retained(id: number | undefined): number | undefined {
    if (id === undefined) return undefined;
    let current = id;
    for (const map of lowered.recordMaps) {
      if (map === undefined) return undefined;
      const next = map[current] ?? 0;
      if (next === 0) return undefined;
      current = next - 1;
    }
    return current;
  }
  const classTypes: number[][] = [];
  for (const record of surface.records) {
    if (record === undefined) return reject("missing surface record class");
    const aliases: number[] = [];
    for (const alias of [record.alias, ...record.aliases]) {
      if (alias === undefined) return reject("missing surface record alias");
      const type = program.aliasTypes.get(alias);
      if (type === undefined)
        return reject("surface record alias is missing: " + alias);
      aliases.push(type);
    }
    classTypes.push(aliases);
  }
  const value: ManagedRecordBinding[] = [],
    bound = new Set<number>();
  for (let recordId = 0; recordId < records.length; recordId++) {
    const layout = records[recordId];
    if (layout === undefined) return reject("missing record layout");
    const sources: number[] = [];
    for (let type = 0; type < types.length; type++)
      if (retained(types[type]) === recordId) sources.push(type);
    const matches: number[] = [];
    for (let classId = 0; classId < classTypes.length; classId++) {
      const aliases = classTypes[classId];
      if (aliases === undefined) return reject("missing record class types");
      let matched = false;
      for (const type of sources) {
        if (type === undefined) return reject("missing record source type");
        for (const alias of aliases) {
          if (alias === undefined) return reject("missing record class type");
          const match = compare.value.matches(type, alias);
          if (!match.ok) return reject(match.error);
          if (match.value) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (matched) matches.push(classId);
    }
    if (matches.length === 0) {
      // Structural readonly assignability does not adapt a private descriptor.
      // Until record-view adapters exist, reject near-matches conservatively;
      // this relaxed check diagnoses a missing contract and never binds one.
      for (let classId = 0; classId < classTypes.length; classId++) {
        const aliases = classTypes[classId],
          surfaceRecord = surface.records[classId];
        if (aliases === undefined || surfaceRecord === undefined)
          return reject("missing record class types");
        for (const type of sources) {
          if (type === undefined) return reject("missing record source type");
          for (const alias of aliases) {
            if (alias === undefined) return reject("missing record class type");
            const near = compare.value.matchesIgnoringReadonly(type, alias);
            if (!near.ok) return reject(near.error);
            if (near.value)
              return reject(
                "record differs from surface mutability contract: " +
                  surfaceRecord.alias,
              );
          }
        }
      }
      continue;
    }
    for (const classId of matches) {
      if (classId === undefined) return reject("missing matched class");
      const record = surface.records[classId];
      if (record === undefined) return reject("missing matched record");
      if (!sameManagedRecordLayout(layout, record.layout))
        return reject("record layout skew " + record.alias);
    }
    if (matches.length > 1)
      return reject("record serves several surface classes");
    const classId = matches[0];
    if (classId === undefined) return reject("missing record contract");
    value.push({
      witness: recordId,
      name: "$record" + String(recordId),
      contract: managedSurfaceContract(
        surface.name,
        surface.digest,
        "record",
        classId,
      ),
    });
    bound.add(recordId);
  }
  for (const alias of requiredAliases) {
    if (alias === undefined) return reject("missing required record alias");
    const type = program.aliasTypes.get(alias),
      record = type === undefined ? undefined : retained(types[type]);
    if (record === undefined || !bound.has(record))
      return reject("surface frame record is not bound: " + alias);
  }
  return { ok: true, value };
}
