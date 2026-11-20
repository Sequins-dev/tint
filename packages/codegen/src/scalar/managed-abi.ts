import type { ModuleIR, RecordLayout, ScalarType } from "@tint/ir/scalar";

export interface ManagedIdentityImport {
  readonly name: string;
  readonly contract: string;
}
export interface ManagedSignatureBinding extends ManagedIdentityImport {
  /** Explicit compiler-authorized local members of this semantic function-type
   * contract. Equal machine signatures alone never grant membership. */
  readonly localFunctions?: readonly number[];
  readonly witness?: number;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ScalarType | "void";
}
export interface ManagedRecordBinding extends ManagedIdentityImport {
  /** Record ID in this verified IR module; semantic identity is the contract. */
  readonly witness: number;
}
export interface ManagedFunctionEntryBinding extends ManagedIdentityImport {
  readonly function: number;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ScalarType | "void";
}
export interface ManagedABIRequest {
  readonly version: 1;
  readonly functions?: readonly ManagedFunctionEntryBinding[];
  readonly functionBrand?: ManagedIdentityImport;
  readonly signatures: readonly ManagedSignatureBinding[];
  readonly records?: readonly ManagedRecordBinding[];
}
export interface NativeManagedPointerImport extends ManagedIdentityImport {
  readonly role: "function-brand" | "signature" | "record" | "function-entry";
  readonly recordLayout?: RecordLayout | undefined;
  readonly offset: number;
  readonly byteLength: 8;
  /** Role-specific ABI representative (function/record ID), never authority. */
  readonly witness: number | undefined;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ScalarType | "void" | undefined;
}

export interface ManagedBindingPlan {
  readonly requests: NativeManagedPointerImport[];
  readonly entries: Map<number, number>;
  readonly signatures: Map<number, number>;
  readonly records: Map<number, number>;
}

/** Validate the compiler-issued contracts and index the IR witnesses. The
 * native emitters consume the same authority and place their own relocations. */
export function bindManagedABI(
  module: ModuleIR,
  managedABI: ManagedABIRequest,
  witnesses: Uint8Array,
  plan: ManagedBindingPlan,
  fail: (code: "UNSUPPORTED" | "INVALID_IR", message: string) => never,
): number | undefined {
  const managedRequests = plan.requests,
    entryImports = plan.entries,
    signatureImports = plan.signatures,
    recordImports = plan.records;
  const managedSignatureRequests: number[] = [];
  let brandImport: number | undefined;
  if (managedABI.version !== 1)
    fail("UNSUPPORTED", "unsupported managed ABI version");
  const names = new Set<string>();
  function validName(value: string): boolean {
    return value.length > 0 && value.indexOf("\0") < 0;
  }
  function identity(name: string, contract: string): void {
    if (!validName(name) || !validName(contract) || names.has(name))
      fail("INVALID_IR", "invalid or duplicate managed import name/contract");
    names.add(name);
  }
  const brand = managedABI.functionBrand;
  if (brand === undefined) {
    if (managedABI.signatures.length > 0)
      fail("INVALID_IR", "managed signature imports require a function brand");
  } else {
    identity(brand.name, brand.contract);
    brandImport = managedRequests.length;
    managedRequests.push({
      role: "function-brand",
      name: brand.name,
      contract: brand.contract,
      offset: 0,
      byteLength: 8,
      witness: undefined,
      parameters: [],
      returnType: undefined,
    });
  }
  for (const binding of managedABI.signatures) {
    if (binding === undefined) throw "managed signature binding invariant";
    identity(binding.name, binding.contract);
    const witness = binding.witness;
    if (witness === undefined) {
      if ((binding.localFunctions?.length ?? 0) === 0)
        fail(
          "INVALID_IR",
          "managed signature binding requires a witness or local members",
        );
    } else {
      const target = module.functions[witness];
      if (
        !Number.isInteger(witness) ||
        witness < 0 ||
        target === undefined ||
        signatureImports.has(witness)
      )
        fail("INVALID_IR", "invalid or duplicate managed signature witness");
      if (
        target.returnType !== binding.returnType ||
        target.parameters.length !== binding.parameters.length
      )
        fail("INVALID_IR", "managed signature contract does not match witness");
      for (let index = 0; index < target.parameters.length; index++) {
        const slot = target.parameters[index];
        if (
          slot === undefined ||
          target.slots[slot] !== binding.parameters[index]
        )
          fail(
            "INVALID_IR",
            "managed signature parameter contract does not match witness",
          );
      }
      const uses = witnesses[witness] ?? 0;
      if ((uses & 1) !== 0)
        fail(
          "INVALID_IR",
          "cannot create a local function using an imported signature witness",
        );
      if ((uses & 2) === 0)
        fail(
          "INVALID_IR",
          "managed signature binding has no indirect-call witness",
        );
      signatureImports.set(witness, managedRequests.length);
    }
    managedSignatureRequests.push(managedRequests.length);
    managedRequests.push({
      role: "signature",
      name: binding.name,
      contract: binding.contract,
      offset: 0,
      byteLength: 8,
      // Permanent link metadata keeps an ABI representative even when this
      // contract has members but no indirect-call placeholder.
      witness: binding.witness ?? binding.localFunctions?.[0],
      parameters: binding.parameters.slice(),
      returnType: binding.returnType,
    });
  }
  // Imported witnesses remain non-callable local placeholders. Only explicit
  // type-contract membership lets a real local body share their identity.
  for (let index = 0; index < managedABI.signatures.length; index++) {
    const binding = managedABI.signatures[index];
    if (binding === undefined) throw "managed signature binding invariant";
    const request = managedSignatureRequests[index];
    if (request === undefined) throw "managed signature request invariant";
    for (const id of binding.localFunctions ?? []) {
      if (id === undefined) throw "managed signature member invariant";
      const target = module.functions[id];
      if (
        !Number.isInteger(id) ||
        id < 0 ||
        target === undefined ||
        signatureImports.has(id) ||
        target.import === true
      )
        fail("INVALID_IR", "invalid or duplicate local signature member");
      if (
        target.returnType !== binding.returnType ||
        target.parameters.length !== binding.parameters.length
      )
        fail("INVALID_IR", "local signature member contract does not match");
      for (let index = 0; index < target.parameters.length; index++) {
        const slot = target.parameters[index];
        if (
          slot === undefined ||
          target.slots[slot] !== binding.parameters[index]
        )
          fail(
            "INVALID_IR",
            "local signature member parameter contract does not match",
          );
      }
      signatureImports.set(id, request);
    }
  }
  for (const binding of managedABI.records ?? []) {
    if (binding === undefined) throw "managed record binding invariant";
    const layout = module.records?.[binding.witness];
    if (
      !Number.isInteger(binding.witness) ||
      binding.witness < 0 ||
      layout === undefined ||
      recordImports.has(binding.witness)
    )
      fail("INVALID_IR", "invalid or duplicate managed record witness");
    identity(binding.name, binding.contract);
    recordImports.set(binding.witness, managedRequests.length);
    managedRequests.push({
      role: "record",
      name: binding.name,
      contract: binding.contract,
      offset: 0,
      byteLength: 8,
      witness: binding.witness,
      parameters: [],
      returnType: undefined,
      recordLayout: {
        byteLength: layout.byteLength,
        fields: layout.fields.map((field) => ({ ...field })),
      },
    });
  }
  for (const binding of managedABI.functions ?? []) {
    if (binding === undefined) throw "managed entry binding invariant";
    const target = module.functions[binding.function];
    if (
      !Number.isInteger(binding.function) ||
      binding.function < 0 ||
      target === undefined ||
      target.import !== true
    )
      fail(
        "INVALID_IR",
        "function-entry binding requires an imported function",
      );
    if (entryImports.has(binding.function))
      fail("INVALID_IR", "duplicate imported function-entry binding");
    if (
      target.returnType !== binding.returnType ||
      target.parameters.length !== binding.parameters.length
    )
      fail("INVALID_IR", "imported function ABI mismatch");
    for (let i = 0; i < target.parameters.length; i++) {
      const slot = target.parameters[i];
      if (slot === undefined || target.slots[slot] !== binding.parameters[i])
        fail("INVALID_IR", "imported function ABI mismatch");
    }
    identity(binding.name, binding.contract);
    entryImports.set(binding.function, managedRequests.length);
    managedRequests.push({
      role: "function-entry",
      name: binding.name,
      contract: binding.contract,
      offset: 0,
      byteLength: 8,
      witness: binding.function,
      parameters: binding.parameters.slice(),
      returnType: binding.returnType,
    });
  }
  return brandImport;
}
