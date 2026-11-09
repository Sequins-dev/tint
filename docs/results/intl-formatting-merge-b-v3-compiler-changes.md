# Intl formatting engine merge: non-Intl compiler and runtime changes

This is a review aid for `feat/intl-formatting-b-next` (base `b45b4a1f`). It lists every change outside the Intl/Temporal-formatting code itself, with the reason the engine needs it. The engine comes from H's parked `park/intl-formatting-service-h` (`1a0d439e`). H's commits carry subjects only, so each rationale below was reconstructed from the code and its regression test.

The engine is linked into every Script image. Two things grow with it: the managed runtime surface (DateTimeFormat/DurationFormat formatter slots on `OrdinaryObject`, about 25k lines of formatter code) and the number of generic collection instantiations. Most of the compiler-side changes deal with the effects of that growth, which are hash collisions, specialization exhaustion and duplicate specializations. None of them changes source semantics.

## Compiler side

### 1. `packages/typescript/src/syntax/rewrite.ts`: `syntaxHash` mixes in the source range (H `d94dbaba`)
- **Before:** `(node.nodeHash ?? node.start) >>> 0`.
- **After:** a multiplicative mix of `nodeHash ^ start` and then `end`.
- **Why:** `nodeHash` is a per-traversal ordinal. When several independently rewritten modules (runtime surface, service units, Script) share one checker or lowering index, their ordinals repeat. Nodes then land in the same `KeyIndex` bucket and lookups degrade to long equality chains. The engine adds enough surface modules to make this a measurable checking cost.
- **Semantics:** `syntaxHash` stays a *hint*. Identity is still decided by the index's equality function, so collisions only cost time and can't change results.
- **Test:** `packages/typescript/test/syntax-hash-cost.test.ts` covers 16,384 nodes with repeated ordinals and needs fewer than 12 equality checks per node. It also checks that the hash is stable, 32-bit, and leaves the node unchanged.

### 2. `packages/ts-native/src/modules/specialization.ts`: rehash completed output and clearer limit errors (H `9ba2fac3`, `9640cc74`)
- **Rehash:** local generic specializations are inserted by the post-order block callback *after* that traversal has already hashed the existing children. Generated declarations therefore had missing or duplicate `nodeHash` values, which defeats change 1 and the hash-indexed checker and lowering. The completed module is now passed through `rewriteModule(..., { hashes: true })` before rebinding.
- **Test:** `modules-specialization.test.ts` ("local specialization output assigns fresh hashes after generated declarations are inserted") requires zero missing and zero duplicate hashes, and the result must still type-check.
- **Error text:** "generic specialization limit exceeded" now names the limit and the template. This is diagnostic only; it was used to find which runtime collection exhausted the budget with the larger surface.

### 3. `packages/ts-native/src/runtime/index.ts` and `packages/compiler/src/native/index.ts`: share collection specializations across exact type contracts (H `907e46dc`, merged with main's reified plans)
- **Problem:** collection helpers (sparse-list, linked-set/map, list-sort) are specialized once per *type id*. Managed surfaces introduce many type ids that are distinct in the graph but structurally identical contracts (the same record imported through different surface paths). With the engine, the duplicates exhausted the specialization budget and inflated images.
- **Change:**
  - `prepareCollectionRuntimes` takes an optional `RuntimeTypeEquivalenceFactory`.
  - `compileArm64Program` supplies one only when managed surfaces are present. It is backed by the existing compiler-issued `createManagedTypeContractIndex(...).matches`, which is exact contract equality, not structural similarity. Any failure of the index means "not equal".
  - Requests with the same helper name and pairwise-equivalent type arguments then share a reified root.
- **Merge with main's `CollectionRuntimePlan`:** main had since moved preparation to reified, seedable plans (P's eval work). Equivalence is applied *before* `reifyCheckedRoots`, so only the shared requests are reified. The plan is then expanded back to **one root per request**, and aliases reuse the same reified `TypeNode`s. `specializeModule` keys instances structurally (`identity = template:key(args)`), so aliased roots resolve to the same instance automatically.
  - Each request keeps its own root and `listStarts`/`setStarts`/`mapStarts`/`sortStarts` indices, so seeded plans (`prepareCollectionRuntimesFromPlan`) keep their layout and validation unchanged.
  - Seeded passes don't use equivalence: `checked === undefined` means no type graph exists to compare.
  - Without managed surfaces the factory is `undefined`, so behaviour is identical to main.
- **What it doesn't change:** source type identities, per-type runtime bindings, or ABI. Only the set of generated helper copies shrinks.
- **Tests:**
  - `tools/runtime-specialization-sharing.test.ts`
  - `packages/ts-native/test/runtime-index.test.ts`
  - native `tools/verify-hosted-runtime-specialization-sharing.ts` and `verify-hosted-runtime-shared-collections.ts` (exact collection aliases under native mutation and copying GC).

### 4. `packages/compiler/src/catalog.ts`
Lists the new js-runtime source files in the compiler's project catalog, so self-hosting snapshots and frozen toolchains include them. It is data only.

## Runtime and host (non-formatter)

- **`packages/foundation/src/chrono/tzif/{zone,posix-offset}.ts`:** exposes daylight-saving state for an instant from TZif and POSIX-TZ footers. DateTimeFormat needs it to pick standard versus daylight time-zone names (`timeZoneName: "short"/"long"`). Test: `packages/foundation/test/tzif-daylight-saving.test.ts`.
- **`js-runtime/src/objects/{errors,operations,functions}.ts`:** new realm prototypes (`dateTimeFormatPrototype`, `durationFormatPrototype`), `internalDateTimeFormatData`/`internalDurationFormatData` slots on `OrdinaryObject`, and the matching `intrinsicPrototype` names for newTarget prototype selection. Their growth is accounted for in `tools/script-runtime-surface.test.ts`: main's counts plus exactly +8 anchors, +3 collections/lists/providers and +24 operations.
- **`js-runtime/src/objects/date-intrinsics.ts`:** `Date.prototype.toLocale{,Date,Time}String` now delegate to Intl.DateTimeFormat (ECMA-402), replacing fixed non-Intl text.
- **Temporal `toLocaleString`:** the ECMA-402 method installed by `temporal-locale-string.ts` now always applies. B's commit removes the core (non-Intl) fallbacks on PlainDate, ZonedDateTime, PlainYearMonth and PlainMonthDay, which were already overwritten and dead. Tests and native verifiers were updated accordingly. The built-ins regression guard covering every `toLocale*String`/`Intl.` built-ins test passes 326/326.
- **`tools/test262-native-run.ts`, `tools/test262-native.ts`, `tools/native-service-*.ts`, `tools/date-time-native-service.ts`:** compose the cached AOT DateTimeFormat native service unit into Test262 images.
  - `TINT_TEST262_NATIVE_SERVICES=aot|monolithic` selects the mode. When the captured runtime contains the service, the default is `aot`, which requires a frozen toolchain (the runner throws otherwise). `monolithic` links everything into one image.
  - The service-unit identity is recorded in `nativeLinkingMode`/`nativeServiceUnitIndexSha256`.
  - The service mechanism itself (`nativeServices` in `CompileRequest`) was already on main.
- **`tools/script-runtime-surface.test.ts`:** apart from the counts, `assert.ok(prepared.ok, JSON.stringify(prepared))` now serializes only on failure. The successful prepared module exceeds V8's maximum string length, which made the success path throw `RangeError`.
