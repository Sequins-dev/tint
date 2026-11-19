import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  generalCallEntrySource,
  generalCallTypedSource,
} from "./typed-general-call-fixture-source.ts";

export function buildMixedGeneralCallFixture(
  entry: string,
  typed: string,
  name: string,
): string {
  if (process.env.TINT_BUILD_ONLY !== "1")
    throw Error("general call fixtures require TINT_BUILD_ONLY=1");
  const id = "trusted:general-call";
  const bytes = new TextEncoder().encode(typed);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  let partition: readonly string[] | undefined;
  const path = verifyHostedFixture(
    entry,
    name,
    [["trusted", id]],
    [{ id, module: parsed.value, dependencies: new Map() }],
    [],
    [{ module: id, namespace: "trusted-general-call" }],
    {
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      onGeneralFallback(modules) {
        partition = modules;
      },
    },
  );
  assert.deepEqual(partition, ["fixture"]);
  return path;
}

if (import.meta.main)
  console.log(
    buildMixedGeneralCallFixture(
      generalCallEntrySource,
      generalCallTypedSource,
      "typed-general-call",
    ),
  );
