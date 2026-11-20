import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("x86-64 scalar emitter fixture requires TINT_BUILD_ONLY=1");

verifyHostedFixture(
  `import { emitModule } from "@tint/codegen/x86_64/scalar";
import { type ModuleIR } from "@tint/ir/scalar";
export function run(): number {
  const module: ModuleIR = { functions: [{
    id: 0, name: "probe", exported: true, parameters: [], slots: [],
    returnType: "number", entry: 0,
    blocks: [{ id: 0, instructions: [
      { kind: "constant", id: 1, value: 42, start: 0, end: 0 },
    ], terminator: { kind: "return", value: 1, start: 0, end: 0 } }],
  }] };
  const emission = emitModule(module);
  if (!emission.ok) return 1;
  if (emission.value.functions.length !== 1) return 2;
  if (emission.value.addressFixups.length !== 1) return 3;
  if (emission.value.data.length !== 8) return 4;
  const code = emission.value.code;
  return code.length > 0 && code[0] === 0x55 ? 42 : 5;
}`,
  "x64-scalar-emitter",
  [
    [
      "@tint/codegen/x86_64/scalar",
      "packages/codegen/src/x86_64/scalar/index.ts",
    ],
    ["@tint/ir/scalar", "packages/ir/src/scalar/index.ts"],
  ],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576, requireTyped: true },
);
