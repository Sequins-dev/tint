import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeCallablePropertySource } from "./slice2b-view-fixtures.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("callable fixture requires TINT_BUILD_ONLY=1");
process.env.TINT_GENERAL_FALLBACK = "0";

verifyHostedFixture(nativeCallablePropertySource, "slice2b-callable-property");

const views = "packages/native-runtime/src/intrinsics/value-views.ts";
const weak = "packages/native-runtime/src/intrinsics/weak.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
verifyHostedFixture(
  `import { projectUnaryNumber, nativeUnaryNumber } from "views";
import { callGeneralValue, createNativeCallableView, programRealmCore } from "objects";
export function run(): number {
  let total = 0;
  const kernel = (increment: number): number => { total += increment; return total; };
  const first = projectUnaryNumber(kernel, "kernel");
  const second = projectUnaryNumber(kernel, "kernel");
  if (first !== second || nativeUnaryNumber(first) !== kernel) return 1;
  const table: Record<string, unknown> = {};
  table.call = first;
  const result = callGeneralValue(table.call, undefined, [41]);
  if (result !== 41 || kernel(1) !== 42) return 2;
  const realm = programRealmCore();
  const general = createNativeCallableView(undefined, (_receiver: unknown, args: readonly unknown[]): unknown => args[0], undefined, "identity", 1, realm.realm, realm.hooks);
  const typed = nativeUnaryNumber(general);
  return typed(42) === 42 && typed === nativeUnaryNumber(general) && projectUnaryNumber(typed, "typed") === general ? 42 : 3;
}`,
  "slice2b-callable-projection",
  [
    ["views", views],
    ["objects", objects],
  ],
  [],
  [
    { module: views, name: "viewUnaryNumberClosure", operation: "view" },
    { module: objects, name: "viewObjectValue", operation: "view" },
    { module: objects, name: "viewTypeofObject", operation: "view" },
    { module: objects, name: "viewSymbolValue", operation: "view" },
    { module: objects, name: "viewBigIntValue", operation: "view" },
  ],
  [
    {
      module: views,
      namespace: "native-value-views",
      retainedExports: ["viewUnaryNumberClosure"],
    },
    { module: weak, namespace: "native-view-weak" },
    {
      module: objects,
      namespace: "native-value-witness",
      retainedExports: [
        "viewObjectValue",
        "viewTypeofObject",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    weakBindings: [
      { module: weak, name: "createWeakSlot", operation: "new" },
      { module: weak, name: "weakSlotKey", operation: "key" },
      { module: weak, name: "weakSlotValue", operation: "value" },
      { module: weak, name: "setWeakSlotValue", operation: "set-value" },
      { module: weak, name: "clearWeakSlot", operation: "clear" },
    ],
  },
);
