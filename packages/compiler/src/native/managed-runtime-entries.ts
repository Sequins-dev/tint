import type { ScalarType, ReturnType } from "@tint/ir/scalar";
import type { CheckedClosures } from "@tint/typescript/checker";
import type { Statement } from "@tint/typescript/syntax";
import type { FunctionAddressBinding } from "@tint/ts-native/closure/lowering";
import { generatedIdentifier } from "./managed-surfaces.ts";

export interface RuntimeEntryABI {
  readonly parameters: readonly ScalarType[];
  readonly returnType: ReturnType;
}
export interface RuntimeEntryStub {
  readonly target: string;
  readonly entry: string;
  readonly signature: string;
}
export interface RuntimeEntryPlan {
  readonly declarations: readonly Statement[];
  readonly entries: readonly RuntimeEntryStub[];
}
export type RuntimeEntryPlanResult =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: RuntimeEntryPlan };

function addressStub(name: string): Statement & { readonly kind: "function" } {
  return {
    start: 0,
    end: 0,
    kind: "function",
    name,
    exported: false,
    parameters: [],
    returnType: { start: 0, end: 0, kind: "named", name: "number" },
    body: {
      start: 0,
      end: 0,
      kind: "block",
      statements: [
        {
          start: 0,
          end: 0,
          kind: "throw",
          expression: {
            start: 0,
            end: 0,
            kind: "string",
            value: "MANAGED_RUNTIME_ENTRY_UNBOUND",
          },
        },
      ],
    },
  };
}

/** Construct inside each runtime transform pass: specialization names are local
 * to that pass. Callers retain these declarations explicitly, never by spans. */
export function createRuntimeEntryStubs(
  names: readonly string[],
  prefix: string,
  abis?: readonly RuntimeEntryABI[],
): RuntimeEntryPlanResult {
  if (!generatedIdentifier(prefix))
    return {
      ok: false,
      error: "runtime entry prefix must be a generated identifier",
    };
  if (abis !== undefined && abis.length !== names.length)
    return { ok: false, error: "runtime entry ABI count differs" };
  const signatures = new Map<string, number>(),
    emittedSignatures = new Set<string>();
  const targets = new Set<string>(),
    declarations: Statement[] = [],
    entries: RuntimeEntryStub[] = [];
  for (const name of names) {
    if (
      name === undefined ||
      name.length === 0 ||
      name.includes("\0") ||
      targets.has(name)
    )
      return {
        ok: false,
        error: "runtime entry targets must have unique nonempty names",
      };
    targets.add(name);
  }
  for (let index = 0; index < names.length; index++) {
    const target = names[index];
    if (target === undefined) throw "runtime entry target invariant";
    let group = index;
    if (abis !== undefined) {
      const abi = abis[index];
      if (abi === undefined)
        return { ok: false, error: "runtime entry ABI is missing" };
      const key = abi.returnType + "/" + abi.parameters.join(",");
      const existing = signatures.get(key);
      if (existing === undefined) {
        group = signatures.size;
        signatures.set(key, group);
      } else group = existing;
    }
    const entry = prefix + "_entry_" + index,
      signature = prefix + "_signature_" + group;
    if (targets.has(entry) || targets.has(signature))
      return { ok: false, error: "runtime entry stub collides with a target" };
    entries.push({ target, entry, signature });
    const stubNames = emittedSignatures.has(signature)
      ? [entry]
      : [entry, signature];
    emittedSignatures.add(signature);
    for (const name of stubNames) {
      if (name === undefined) throw "runtime entry stub name invariant";
      declarations.push(addressStub(name));
    }
  }
  return { ok: true, value: { declarations, entries } };
}

/** Names locate declarations; only checked declaration identity authorizes the
 * lowering binding. ABI and host-operation checks still belong to integration. */
export function resolveRuntimeEntryBindings(
  checked: CheckedClosures,
  plan: RuntimeEntryPlan,
):
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: readonly FunctionAddressBinding[] } {
  const functions = new Map<string, number>();
  for (const declaration of checked.module.statements) {
    if (declaration === undefined || declaration.kind !== "function") continue;
    const fn = checked.bindings.functions.find(
      (candidate) =>
        candidate !== undefined &&
        candidate.parent === undefined &&
        candidate.node === declaration,
    );
    if (fn !== undefined) functions.set(declaration.name, fn.id);
  }
  const bindings: FunctionAddressBinding[] = [],
    signatures = new Set<number>();
  for (const entry of plan.entries) {
    if (entry === undefined) throw "runtime entry plan invariant";
    const target = functions.get(entry.target),
      code = functions.get(entry.entry),
      signature = functions.get(entry.signature);
    if (target === undefined)
      return {
        ok: false,
        error: "runtime entry target is missing: " + entry.target,
      };
    if (code === undefined || signature === undefined)
      return {
        ok: false,
        error: "runtime entry stub is missing: " + entry.target,
      };
    bindings.push({ function: code, target, part: "entry" });
    if (!signatures.has(signature)) {
      signatures.add(signature);
      bindings.push({ function: signature, target, part: "signature" });
    }
  }
  return { ok: true, value: bindings };
}

/** Host/weak declarations are capabilities, not public runtime entrypoints.
 * Native indices must be translated back to checked identities before matching. */
export function rejectHostRuntimeEntries(
  addresses: readonly { readonly target: number }[],
  entries: readonly number[],
  host: readonly { readonly function: number }[],
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (addresses.length === 0) return { ok: true };
  const excluded = new Set<number>();
  for (const binding of host) {
    if (binding === undefined) throw "host capability invariant";
    const source = entries[binding.function];
    if (source === undefined)
      return { ok: false, error: "host target checked identity missing" };
    excluded.add(source);
  }
  for (const binding of addresses) {
    if (binding === undefined) throw "runtime address binding invariant";
    if (excluded.has(binding.target))
      return { ok: false, error: "runtime entry targets a host operation" };
  }
  return { ok: true };
}
