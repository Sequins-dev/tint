# Native TypeScript adaptation

`@tint/ts-native` adapts checked TypeScript to native IR and composes native
modules. It preserves explicit native feasibility restrictions separately from
the portable TypeScript frontend.

Import the capability needed:

- `@tint/ts-native/closure/layout`: closure storage layout.
- `@tint/ts-native/closure/lowering`: closure-aware lowering.
- `@tint/ts-native/closure/class-construction`: class construction lowering.
- `@tint/ts-native/closure/class-definition`: class definition lowering.
- `@tint/ts-native/closure/records`: record contracts.
- `@tint/ts-native/scalar`: scalar lowering.
- `@tint/ts-native/runtime`: runtime composition.
- `@tint/ts-native/modules`: native module linking and specialization.

There is no root entrypoint. Internal modules remain private. Dependencies are
TypeScript analysis, foundation algorithms, IR and generic storage layout;
execution runtime providers and platform policy belong to their respective owners.
