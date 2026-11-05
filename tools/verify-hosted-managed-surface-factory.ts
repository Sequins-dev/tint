import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { linkModules, specializeModule } from "@tint/ts-native/modules";
import {
  resolveManagedSurfaceSelections,
  prepareManagedSurfaceTable,
  createManagedSurfaceAnchors,
  materializeManagedSurfaceTable,
  createManagedSurfaceReflectors,
  createManagedSurfaceWitnessFactory,
} from "@tint/compiler/native";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const parsed = parseModule(
  createSourceTextView(
    "interface Link{readonly value:number;readonly next:Link|undefined;}export function visit(value:Link,callback:(node:Link)=>number):number{return callback(value);}let calls:number=0;export function identity<T>(value:T):T{calls++;return value;}export function count():number{return calls;}",
  ),
);
assert.ok(parsed.ok, JSON.stringify(parsed));
const linked = linkModules(
  [{ id: "helpers", module: parsed.value, dependencies: new Map() }],
  "helpers",
  ["undefined"],
  { evaluation: "instance" },
);
assert.ok(linked.ok, JSON.stringify(linked));
const bound = bindModule(linked.value.module, ["undefined"]);
assert.ok(bound.ok);
const selections = resolveManagedSurfaceSelections(
  linked.value,
  bound.value,
  [
    {
      module: "helpers",
      name: "identity",
      typeArguments: [{ kind: "keyword", name: "number" }],
    },
    { module: "helpers", name: "count", typeArguments: [] },
    { module: "helpers", name: "visit", typeArguments: [] },
  ],
  [],
);
assert.ok(selections.ok, JSON.stringify(selections));
const initial = specializeModule(linked.value.module, bound.value, {
  roots: selections.value.roots,
});
assert.ok(initial.ok);
const prepared = prepareManagedSurfaceTable(
  initial.value.module,
  selections.value,
  initial.value.roots,
  "$Surface",
  "$InitialTable",
);
assert.ok(prepared.ok, JSON.stringify(prepared));
const anchors = createManagedSurfaceAnchors(
  linked.value.module,
  selections.value,
  prepared.value.surface,
  "$Demand",
);
assert.ok(anchors.ok);
const anchorBound = bindModule(anchors.value.module, ["undefined"]);
assert.ok(anchorBound.ok);
const specialized = specializeModule(anchors.value.module, anchorBound.value);
assert.ok(specialized.ok);
const factory = materializeManagedSurfaceTable(
  specialized.value.module,
  anchors.value.entries,
  prepared.value.surface,
  "createSurface",
);
assert.ok(factory.ok, JSON.stringify(factory));
const reflectors = createManagedSurfaceReflectors(
  prepared.value.surface,
  "$Reflect",
);
assert.ok(reflectors.ok, JSON.stringify(reflectors));
const witnesses = createManagedSurfaceWitnessFactory(
  prepared.value.surface,
  "$Witness",
);
assert.ok(witnesses.ok, JSON.stringify(witnesses));
const typeSignatures = reflectors.value.typeSignatures;
const witnessChecks = typeSignatures
  .map((signature, index) => {
    const witness = witnesses.value.entries.find(
      (entry) => entry.name === signature.name,
    );
    assert.ok(witness, signature.name);
    return `if($type${index}(metadata.${witness.name})<=0)return 10;`;
  })
  .join("\n");
assert.ok(reflectors.value.functionBrand);
const signatures = reflectors.value.signatures;
const identitySignature = signatures.find((entry) => entry.name === "identity");
const countSignature = signatures.find((entry) => entry.name === "count");
assert.ok(identitySignature && countSignature);
const identityEntry = prepared.value.surface.entries.find(
  (entry) => entry.name === "identity",
);
assert.ok(identityEntry?.type.kind === "named");
const identityWitness = identityEntry.type.name;
assert.ok(prepared.value.surface.table.kind === "named");
const linkDescriptor = reflectors.value.recordDescriptors.find((entry) => {
  const id = reflectors.value.checked.typeNames.get(entry.name);
  const type =
    id === undefined ? undefined : reflectors.value.checked.types[id];
  return (
    type?.kind === "object" &&
    type.properties.some((property) => property.name === "next")
  );
});
assert.ok(linkDescriptor);
const tableAlias = prepared.value.surface.table.name;
const tableIdentity = reflectors.value.recordIdentities.find(
  (entry) => entry.name === tableAlias,
);
const linkIdentity = reflectors.value.recordIdentities.find(
  (entry) => entry.name === linkDescriptor.name,
);
assert.ok(tableIdentity && linkIdentity);
const callbackSignature = reflectors.value.typeSignatures.find((entry) => {
  const id = reflectors.value.checked.typeNames.get(entry.name);
  const type =
    id === undefined ? undefined : reflectors.value.checked.types[id];
  if (type?.kind !== "function" || type.parameters.length !== 1) return false;
  const parameter = reflectors.value.checked.types[type.parameters[0]!];
  return parameter?.kind === "object";
});
assert.ok(callbackSignature);
const predicate = parseModule(
  createSourceTextView(
    `export function testSurface(value:unknown,witness:${prepared.value.surface.table.name}):boolean{throw "UNBOUND_TEST";}`,
  ),
);
assert.ok(predicate.ok, JSON.stringify(predicate));
// Generated zero-span declarations are owned by AST identity, not source extent.
const reflectionModule = {
  ...reflectors.value.checked.module,
  end: Math.max(reflectors.value.checked.module.end, predicate.value.end),
  statements: [
    ...reflectors.value.checked.module.statements,
    ...predicate.value.statements,
  ],
};
verifyHostedFixture(
  `import {createSurface} from "surface";
import {${reflectors.value.tableDescriptor} as describe,${reflectors.value.functionBrand} as brand,${identitySignature.function} as identitySignature,${countSignature.function} as countSignature,${linkDescriptor.function} as describeLink,${callbackSignature.function} as callbackSignature,${tableIdentity.function} as tableIdentity,${linkIdentity.function} as linkIdentity,testSurface,${typeSignatures.map((signature, index) => signature.function + " as $type" + index).join(",")}} from "reflectors";
import {${witnesses.value.factory} as createMetadata} from "witnesses";
interface LocalLink{readonly value:number;readonly next:LocalLink|undefined;}
export function run():number{
 const expectedTable=tableIdentity(undefined),expectedLink=linkIdentity(undefined);
 if(expectedTable<=0||expectedLink<=0)return 15;
 const first=createSurface(),second=createSurface();
 const flags=new Map<string,boolean>(),booleans=new Set<boolean|undefined>();
 flags.set("false",false);flags.set("true",true);booleans.add(false);booleans.add(true);booleans.add(undefined);
 if(flags.get("false")!==false||flags.get("true")!==true||flags.get("absent")!==undefined||!booleans.has(false)||!booleans.has(true)||!booleans.has(undefined))return 13;
 const metadata=createMetadata(),otherMetadata=createMetadata();
 if(metadata===otherMetadata||metadata.${identityWitness}!==otherMetadata.${identityWitness})return 12;
 let witnessThrew=false;try{metadata.${identityWitness}(0);}catch(error){witnessThrew=error==="MANAGED_SIGNATURE_WITNESS";}
 if(!witnessThrew)return 11;
 ${witnessChecks}
 const link:LocalLink={value:19,next:undefined};
 const read=(node:LocalLink):number=>node.value;
 if(describeLink(link,link)!==expectedLink||callbackSignature(read)<=0||first.visit(link,read)!==19)return 9;
 const descriptor=describe(first,first),functionBrand=brand(first.identity),identity=identitySignature(first.identity),count=countSignature(first.count);
 if(!testSurface(first,first)||!testSurface(second,second))return 8;
 if(descriptor!==expectedTable||functionBrand<=0||identity<=0||count<=0||identity===count)return 6;
 if(first===second)return 1;
 if(first.identity!==second.identity||first.count!==second.count)return 2;
 if(first.identity(19)!==19||second.count()!==1)return 3;
 for(let i=0;i<640;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)return 4;}
 ${witnessChecks}
 if(flags.get("false")!==false||!booleans.has(false)||!booleans.delete(undefined)||booleans.has(undefined))return 14;
 if(second.identity(42)!==42||first.count()!==2)return 5;
 if(tableIdentity(undefined)!==expectedTable||linkIdentity(undefined)!==expectedLink||describe(second,second)!==descriptor||brand(second.identity)!==functionBrand||identitySignature(second.identity)!==identity||countSignature(second.count)!==count)return 7;
 return 42;
}`,
  "managed-surface-factory",
  [
    ["surface", "surface-lib"],
    ["reflectors", "surface-reflection"],
    ["witnesses", "surface-witnesses"],
  ],
  [
    {
      id: "surface-lib",
      module: factory.value.module,
      dependencies: new Map(),
    },
    {
      id: "surface-witnesses",
      module: witnesses.value.checked.module,
      dependencies: new Map(),
    },
    {
      id: "surface-reflection",
      module: reflectionModule,
      dependencies: new Map(),
    },
  ],
  [
    {
      module: "surface-reflection",
      name: tableIdentity.function,
      operation: "identity",
    },
    {
      module: "surface-reflection",
      name: linkIdentity.function,
      operation: "identity",
    },
    {
      module: "surface-reflection",
      name: reflectors.value.tableDescriptor,
      operation: "descriptor",
    },
    { module: "surface-reflection", name: "testSurface", operation: "test" },
    {
      module: "surface-reflection",
      name: linkDescriptor.function,
      operation: "descriptor",
    },
  ],
  [{ module: "surface-reflection", namespace: "managed-surface-reflection" }],
  {
    hostBindings: [
      {
        module: "surface-reflection",
        name: reflectors.value.functionBrand,
        operation: "native-function-descriptor",
      },
      ...typeSignatures.map((entry) => ({
        module: "surface-reflection",
        name: entry.function,
        operation: "native-function-signature" as const,
      })),
      ...signatures.map((entry) => ({
        module: "surface-reflection",
        name: entry.function,
        operation: "native-function-signature" as const,
      })),
    ],
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 8388608,
    allocationCapacity: 262144,
    rootCapacity: 4096,
    stackBytes: 8388608,
  },
);
