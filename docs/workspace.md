# Workspace and module contracts

Tint is a self-hosted TypeScript compiler/runtime with direct native output.
Node hosts bootstrap builds and development tools; native fixtures and frozen
self-builds validate execution. [Bootstrap](bootstrap.md) owns current evidence.

## Tooling

Use the pinned pnpm workspace, TypeScript project-reference builds and Node's
built-in test runner. Node executes tool/test TypeScript through type stripping;
upstream tsc separately checks types and emits development package JS/declarations.
It is not Tint's production frontend or an intermediate native compilation stage.

- `pnpm build`: build the reference graph.
- `pnpm typecheck`: build and check tests/tools.
- `pnpm test`: package and tool tests.
- `pnpm boundaries`: dependency/public-entrypoint/source-discipline checks.
- `pnpm format:check`: formatting gate.
- `pnpm check`: all workspace gates.

Equivalent direct Node CLI commands are useful when a launcher is unavailable.
Package dependencies, project references and workspace-contracts.json must agree.
Portable source has no Node ambient types; host adapters and development oracles
belong in explicit entrypoints or tools.

## Architecture migration

[Framework consolidation](framework-consolidation.md) owns the target framework
map, resolved ownership choices, migration order and current ledger. Prefer
cohesive frameworks with layered internal modules and narrow public entrypoints.
Do not create a new package for each small implementation detail.

Exports are explicit compiled entrypoints. A consumer declares the owning package
and imports only a public exported subpath. Internal relative imports remain
inside that framework. Preserve package acyclicity and the public contract checks.
Framework-wide barrels are inappropriate when they expand native reachability.

Native builtin labels, generated Script imports, capability metadata and heap/ABI
formats are explicit contracts, independent of physical package/file locations.
A package move must migrate all consumers and remove the old implementation;
these private APIs do not need transitional compatibility packages.

## Validation and records

Follow [AGENTS.md](../AGENTS.md). Upstream types and Node tests do not prove native
compatibility. Use focused semantic checks, relevant native fixtures, frozen
same-source self-builds and complete conformance selections as appropriate.
[Test262](test262.md) owns current conformance counts; design documents do not
accumulate chronological progress logs.

The earlier workspace diary is retained in the [historical archive](archive/workspace-before-framework-consolidation.md)
for targeted reference. Its capability claims are historical and are not current
status.
