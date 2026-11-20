# Slice 3 nested fallback checks

Both the compiler pipeline and the general engine lowering passed their
native subset checks. Node 24.12.0 passed the TypeScript test-project check
and all 23 focused fallback, source validation, direct-eval and corpus tests.

Each hosted Linux arm64 fixture stopped at entry under LLDB on `dev` and
exited 42. The three nested fixtures report one selected function named
`general` in their build manifests.

| Fixture                           | Image SHA-256                                                      |
| --------------------------------- | ------------------------------------------------------------------ |
| `slice3-nested-captures`          | `84fb48782ff9f3a24504f1a8f0b8ac8970e7d93633ed2f273b925eeca3dd5801` |
| `slice3-nested-contract`          | `c2634709fb0cd354cf3a5183d145279f83ff6081079abd935944304cd72f48bd` |
| `slice3-nested-iterations`        | `9047da29240e5e70649c6c47db306f6a35a7b091615f65bb5d066090b194eb14` |
| `explicit-field-contract` (typed) | `116eceb0f6f1505af3f3e101ff5008a581361f6e2eda861f0d73c1b290b4be19` |

The first two nested fixtures and the field contract captured source
snapshot `a1212e469ff904e77db1beda369090245f5ae5bdd08bf84d45fb75be229f0ba4`.
The iterations fixture captured
`cd3a078196a8e49553fcdcb4d764df11e52c855eaca36f40afbf2fb55e09160d`.

The cases exercise callables escaped from separate activations, sibling
mutations, alias identity, a rejected write that keeps its old value, object
exception identity, and uninitialized cells reached through the typed
entry. The iterations case then uses the same closures after initialization
and checks their per-iteration bindings.
