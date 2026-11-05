import type { FunctionIR } from "@tint/ir/scalar";
/** Compiler-issued semantic membership. Matching machine encodings alone never
 * makes a function a member; the producer verifies the source type contract. */
export interface LocalSignatureBinding {
  readonly name: string;
  readonly contract: string;
  readonly functions: readonly number[];
}
export function planLocalSignatures(
  functions: readonly FunctionIR[],
  bindings: readonly LocalSignatureBinding[],
  imported: ReadonlyMap<number, number>,
  importedNames: readonly string[],
  importedContracts: readonly string[],
):
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly groups: readonly LocalSignatureBinding[];
      readonly byFunction: Uint32Array;
    } {
  const names = new Set<string>(),
    contracts = new Set<string>();
  for (const name of importedNames) {
    if (name === undefined) throw "managed identity name invariant";
    names.add(name);
  }
  for (const contract of importedContracts) {
    if (contract === undefined) throw "managed identity contract invariant";
    contracts.add(contract);
  }
  const groups: LocalSignatureBinding[] = [];
  const byFunction = new Uint32Array(functions.length);
  const reject = (
    error: string,
  ): { readonly ok: false; readonly error: string } => ({ ok: false, error });
  for (const binding of bindings) {
    if (
      binding === undefined ||
      binding.name.length === 0 ||
      binding.name.includes("\0") ||
      binding.contract.length === 0 ||
      binding.contract.includes("\0") ||
      names.has(binding.name) ||
      contracts.has(binding.contract) ||
      binding.functions.length === 0
    )
      return reject("invalid or duplicate local signature identity");
    names.add(binding.name);
    contracts.add(binding.contract);
    const first = functions[binding.functions[0] ?? -1];
    if (first === undefined) return reject("local signature member is missing");
    const members: number[] = [];
    for (const id of binding.functions) {
      if (
        id === undefined ||
        !Number.isInteger(id) ||
        id < 0 ||
        id >= functions.length ||
        byFunction[id] !== 0 ||
        imported.has(id)
      )
        return reject("invalid, duplicate or imported local signature member");
      const member = functions[id];
      if (
        member === undefined ||
        member.import === true ||
        member.returnType !== first.returnType ||
        member.parameters.length !== first.parameters.length
      )
        return reject("local signature member contract does not match");
      for (let index = 0; index < first.parameters.length; index++) {
        const a = first.parameters[index],
          b = member.parameters[index];
        if (
          a === undefined ||
          b === undefined ||
          first.slots[a] !== member.slots[b]
        )
          return reject(
            "local signature member parameter contract does not match",
          );
      }
      byFunction[id] = groups.length + 1;
      members.push(id);
    }
    groups.push({
      name: binding.name,
      contract: binding.contract,
      functions: members,
    });
  }
  return { ok: true, groups, byFunction };
}
