import { syntaxHash, bindingIdentifiers } from "@tint/typescript/syntax";
import {
  createKeyIndex,
  type KeyIndex,
} from "@tint/foundation/collections/key-index";
import { nativeTypedArray, type ScalarType } from "@tint/ir/scalar";
import type { CheckedClosures } from "@tint/typescript/checker";
import type { Binding as BoundBinding } from "@tint/typescript/binding";
import type { Expression, Span, Statement } from "@tint/typescript/syntax";
import {
  planClosures,
  type ClosureLayouts,
  type BindingStorage,
  type TargetDataLayout,
} from "../layout.ts";
export type PlanResult =
  | { readonly ok: true; readonly value: ClosureLayouts }
  | { readonly ok: false; readonly error: string };
/** Simple strict parameters are initialized before body-created closures. A
 * binding with no syntactic writes, including in descendants, needs no shared
 * cell, nor does a `let` that only its owner writes, before every closure
 * capturing it exists (see addInitializedCaptures). The owner selects only
 * single-word payload representations. Defaults, sloppy code and dynamic
 * binding exposure retain cells. This binding/dataflow proof is independent
 * of readonly type assertions. */
export interface CapturePlan {
  /** Bindings captured by value (no shared cell). */
  readonly values: Uint8Array;
  /** Hoisted declarations created after a statement of their scope instead
   * of at scope entry: declaration node to that statement. */
  readonly sinks: KeyIndex<Span, Span>;
}
export function planCaptures(checked: CheckedClosures): CapturePlan {
  const values = new Uint8Array(checked.bindings.bindings.length),
    sinks = createKeyIndex<Span, Span>(syntaxHash);
  const functionReferences: number[][] = [];
  const writes = capturedWrites(checked, functionReferences);
  if (writes === undefined) return { values, sinks };
  addParameterCaptures(checked, writes.written, values);
  addInitializedCaptures(checked, writes, values, sinks, functionReferences);
  return { values, sinks };
}
interface CapturedWrites {
  /** Bindings with a syntactic write anywhere. */
  readonly written: Uint8Array;
  /** Per binding, the writes made by its owner's own code (not by nested
   * functions); `foreign` marks bindings with any other write (a nested
   * function's, or an alias). */
  readonly ownerSites: (Span[] | undefined)[];
  readonly foreign: Uint8Array;
}
/** Bindings with a syntactic write anywhere (assignment, alias or checked
 * cell write), or undefined when sloppy code, direct eval or `arguments`
 * could expose bindings dynamically. */
function capturedWrites(
  checked: CheckedClosures,
  functionReferences: number[][],
): CapturedWrites | undefined {
  const writes = new Uint8Array(checked.bindings.bindings.length),
    foreign = new Uint8Array(checked.bindings.bindings.length),
    ownerSites: (Span[] | undefined)[] = [];
  function write(binding: number, node: Span, owner: number | undefined): void {
    writes[binding] = 1;
    const declared = checked.bindings.bindings[binding];
    if (
      declared === undefined ||
      declared.owner === undefined ||
      owner !== declared.owner
    ) {
      foreign[binding] = 1;
      return;
    }
    let list = ownerSites[binding];
    if (list === undefined) {
      list = [];
      ownerSites[binding] = list;
    }
    list.push(node);
  }
  if (
    checked.module.strict === false ||
    (checked.bindings.directEvalOwners?.length ?? 0) !== 0
  )
    return undefined;
  for (const reference of checked.bindings.references) {
    if (reference === undefined) throw "capture reference invariant";
    if (reference.global === "arguments" || reference.global === "eval")
      return undefined;
    const binding = reference.binding;
    if (binding === undefined) continue;
    if (reference.access !== "read")
      write(
        binding,
        reference.node,
        checked.bindings.scopes[reference.scope]?.owner,
      );
    // Source offsets of references to function declarations (hoisting).
    if (checked.bindings.bindings[binding]?.kind === "function") {
      let list = functionReferences[binding];
      if (list === undefined) {
        list = [];
        functionReferences[binding] = list;
      }
      list.push(reference.node.start);
    }
  }
  // Redeclaration initializers are binding operations, not identifier
  // references. Treat every alias conservatively, even a bare var redeclaration.
  for (const alias of checked.bindings.aliases ?? []) {
    if (alias === undefined) throw "capture alias invariant";
    writes[alias.binding] = 1;
    foreign[alias.binding] = 1;
  }
  for (const operation of checked.operations) {
    if (operation === undefined) throw "capture operation invariant";
    if (operation.operation.kind === "write")
      write(operation.binding, operation.node, operation.function);
  }
  return { written: writes, ownerSites, foreign };
}
/** A function body's statements in source order (nested functions' bodies
 * excluded: they are bodies of their own) and its loop statements. */
interface BodyStatements {
  readonly statements: readonly Span[];
  readonly loops: readonly Span[];
}
function bodyStatements(body: Statement): BodyStatements {
  const all: Span[] = [],
    loops: Span[] = [];
  function statement(node: Statement): void {
    all.push(node);
    switch (node.kind) {
      case "block":
        statements(node.statements);
        return;
      case "if":
        statement(node.consequent);
        if (node.alternate !== undefined) statement(node.alternate);
        return;
      case "try":
        statement(node.body);
        if (node.handler !== undefined) statement(node.handler.body);
        if (node.finalizer !== undefined) statement(node.finalizer);
        return;
      case "switch":
        for (const clause of node.clauses) {
          if (clause === undefined) throw "switch clause invariant";
          statements(clause.statements);
        }
        return;
      case "label":
      case "with":
        statement(node.body);
        return;
      case "for":
        loops.push(node);
        if (node.initializer !== undefined) statement(node.initializer);
        statement(node.body);
        return;
      case "while":
      case "do-while":
      case "for-of":
      case "for-in":
      case "for-of-assignment":
      case "for-in-assignment":
        loops.push(node);
        statement(node.body);
        return;
      default:
        // Function and class declarations' code belongs to their own
        // functions; other statements contain no statements.
        return;
    }
  }
  function statements(list: readonly Statement[]): void {
    for (const node of list) {
      if (node === undefined) throw "statement invariant";
      statement(node);
    }
  }
  statement(body);
  return { statements: all, loops };
}
function addParameterCaptures(
  checked: CheckedClosures,
  writes: Uint8Array,
  result: Uint8Array,
): void {
  for (const binding of checked.bindings.bindings) {
    if (binding === undefined) throw "capture binding invariant";
    const owner = binding.owner;
    if (
      binding.kind !== "parameter" ||
      !binding.captured ||
      owner === undefined ||
      writes[binding.id] === 1
    )
      continue;
    const fn = checked.bindings.functions[owner],
      body = checked.bodies.get(owner),
      type = checked.bindingTypes[binding.id];
    if (
      fn === undefined ||
      checked.bindings.scopes[fn.scope]?.strict !== true ||
      body === undefined ||
      (fn.parameterCopies?.length ?? 0) !== 0 ||
      body.parameters.some(
        (parameter) =>
          parameter.kind === "pattern-parameter" ||
          parameter.initializer !== undefined ||
          parameter.rest === true,
      ) ||
      type === undefined
    )
      continue;
    result[binding.id] = 1;
  }
}
/** Assignment conversion (as in Chez Scheme): a never-written `const` or
 * `let` needs no shared cell when every closure the owner creates that
 * captures it is created after the binding is initialized, so each closure
 * copies an initialized value. Closures nested in such a captor inherit the
 * copy. Conservative order proof: each direct captor is a function
 * expression, arrow or method that starts after the binding's whole
 * declarator (initializer included) in source order. Hoisted declarations
 * (created at scope entry), destructured declarations and switch-case scopes
 * keep their cells, as do closures inside the initializer itself.
 *
 * A written `let` qualifies the same way when only its owner's own code
 * writes it and every write also ends before each direct captor is created:
 * the owner's code runs in source order except around loops, so no write can
 * follow a captor's creation unless a loop contains both while the binding
 * is declared outside it (a binding declared inside the loop is a fresh one
 * each iteration). Such a loop keeps the cell. Each captor then copies the
 * final value, which the owner's own slot keeps. */
function addInitializedCaptures(
  checked: CheckedClosures,
  writes: CapturedWrites,
  result: Uint8Array,
  sinks: KeyIndex<Span, Span>,
  references: readonly (readonly number[] | undefined)[],
): void {
  const directCaptors: number[][] = [];
  // Owner bodies' statements, collected when a written binding needs them.
  const ownerBodies = new Map<number, BodyStatements>();
  function ownerStatements(owner: number): BodyStatements | undefined {
    const known = ownerBodies.get(owner);
    if (known !== undefined) return known;
    const body = checked.bodies.get(owner)?.body;
    // An expression body has no statements: its writes keep their cells.
    if (body === undefined || body.kind !== "block") return undefined;
    const shape = bodyStatements(body);
    ownerBodies.set(owner, shape);
    return shape;
  }
  for (const fn of checked.bindings.functions) {
    if (fn === undefined) throw "capture function invariant";
    for (const capture of fn.captures) {
      if (capture === undefined) throw "capture invariant";
      const binding = checked.bindings.bindings[capture.binding];
      if (binding === undefined || binding.owner !== fn.parent) continue;
      let list = directCaptors[capture.binding];
      if (list === undefined) {
        list = [];
        directCaptors[capture.binding] = list;
      }
      list.push(fn.id);
    }
  }
  // Function declaration statements (hoisted: created at scope entry) and
  // the offset after which each simple declarator's binding is initialized.
  const hoistedDeclarations = createKeyIndex<Span, number>(syntaxHash),
    initializedAt = createKeyIndex<Span, number>(syntaxHash),
    bindingByNode = createKeyIndex<Span, number>(syntaxHash),
    functionByNode = createKeyIndex<Span, number>(syntaxHash);
  for (const binding of checked.bindings.bindings) {
    if (binding === undefined) throw "capture binding invariant";
    bindingByNode.set(binding.node, binding.id);
  }
  for (const fn of checked.bindings.functions) {
    if (fn === undefined) throw "capture function invariant";
    functionByNode.set(fn.node, fn.id);
  }
  /** Sink each of a statement list's hoisted declarations past the last
   * lexical declaration it needs: the bindings it captures, and those its
   * reachable sibling declarations need (a sibling it calls must already
   * exist). A declaration referred to before its point by code outside the
   * hoisted bodies stays at scope entry, as does every sibling it can reach
   * (it may run early). Otherwise nothing can call or observe it before it is
   * created, so creating it later is unobservable and lets it capture
   * initialized values. */
  function sinkHoisted(list: readonly Statement[]): void {
    const hoisted: Span[] = [],
      bindings: number[] = [],
      captures: (readonly number[])[] = [];
    for (const node of list) {
      if (node === undefined) throw "statement invariant";
      if (node.kind !== "function") continue;
      const declaration: Span = node;
      const fn =
        checked.bindings.functions[functionByNode.get(declaration) ?? -1];
      const binding = bindingByNode.get(declaration);
      if (fn === undefined || binding === undefined) return;
      const captured: number[] = [];
      for (const capture of fn.captures) {
        if (capture === undefined) throw "capture invariant";
        captured.push(capture.binding);
      }
      hoisted.push(declaration);
      bindings.push(binding);
      captures.push(captured);
    }
    const count = hoisted.length;
    if (count === 0) return;
    // Statement index declaring each lexical binding of this list.
    const declaredAt: number[] = [];
    for (let index = 0; index < list.length; index++) {
      const node = list[index];
      if (node === undefined) throw "statement invariant";
      if (node.kind !== "variable" || node.mode === "var") continue;
      for (const declaration of node.declarations) {
        if (declaration === undefined) throw "declarator invariant";
        for (const identifier of bindingIdentifiers(declaration)) {
          if (identifier === undefined) throw "identifier invariant";
          const named: Span = identifier;
          const id = bindingByNode.get(named);
          if (id !== undefined) declaredAt[id] = index;
        }
      }
    }
    const sibling: number[] = [],
      points = new Float64Array(count),
      early = new Uint8Array(count);
    for (let h = 0; h < count; h++) {
      const binding = bindings[h];
      if (binding === undefined) throw "hoisted binding invariant";
      sibling[binding] = h;
    }
    for (let h = 0; h < count; h++) {
      let need = -1;
      for (const id of captures[h] ?? []) {
        if (id === undefined) throw "capture invariant";
        need = Math.max(need, declaredAt[id] ?? -1);
      }
      points[h] = need;
    }
    // A declaration's point covers every sibling it reaches.
    for (let changed = true; changed;) {
      changed = false;
      for (let h = 0; h < count; h++)
        for (const id of captures[h] ?? []) {
          const g = id === undefined ? undefined : sibling[id];
          if (g === undefined) continue;
          const reach = points[g] ?? -1;
          if (reach > (points[h] ?? -1)) {
            points[h] = reach;
            changed = true;
          }
        }
    }
    const first = list[0];
    if (first === undefined) return;
    for (let h = 0; h < count; h++) {
      const index = points[h] ?? -1,
        binding = bindings[h];
      if (index < 0 || binding === undefined) continue;
      const point = list[index];
      if (point === undefined) continue;
      for (const at of references[binding] ?? []) {
        if (at === undefined) throw "reference invariant";
        if (at < first.start || at >= point.end) continue;
        let inside = false;
        for (const own of hoisted) {
          if (own === undefined) throw "hoisted invariant";
          if (at >= own.start && at < own.end) inside = true;
        }
        if (!inside) early[h] = 1;
      }
    }
    // An early declaration may run before any point: what it reaches stays
    // at scope entry too.
    for (let changed = true; changed;) {
      changed = false;
      for (let h = 0; h < count; h++) {
        if (early[h] !== 1) continue;
        for (const id of captures[h] ?? []) {
          const g = id === undefined ? undefined : sibling[id];
          if (g === undefined || early[g] === 1) continue;
          early[g] = 1;
          changed = true;
        }
      }
    }
    for (let h = 0; h < count; h++) {
      const declaration = hoisted[h],
        index = points[h] ?? -1;
      if (declaration === undefined || index < 0 || early[h] === 1) continue;
      const point = list[index];
      if (point !== undefined) sinks.set(declaration, point);
    }
  }
  function statement(node: Statement): void {
    switch (node.kind) {
      case "variable":
        if (node.mode === "var") return;
        for (const declaration of node.declarations) {
          if (declaration === undefined) throw "declarator invariant";
          // A destructured declarator's initializer belongs to its pattern.
          if (
            declaration.kind === "object-binding" ||
            declaration.kind === "array-binding"
          )
            continue;
          const initializer = declaration.initializer;
          if (initializer === undefined && node.mode === "const") continue;
          const declared: Span = declaration;
          initializedAt.set(
            declared,
            initializer === undefined
              ? declaration.end
              : Math.max(declaration.end, initializer.end),
          );
        }
        return;
      case "function":
        {
          const declaration: Span = node;
          hoistedDeclarations.set(declaration, 1);
        }
        return;
      case "block":
        statements(node.statements);
        sinkHoisted(node.statements);
        return;
      case "if":
        statement(node.consequent);
        if (node.alternate !== undefined) statement(node.alternate);
        return;
      case "try":
        statements(node.body.statements);
        if (node.handler !== undefined)
          statements(node.handler.body.statements);
        if (node.finalizer !== undefined) statements(node.finalizer.statements);
        return;
      case "while":
      case "do-while":
      case "for":
      case "for-of":
      case "for-in":
      case "for-of-assignment":
      case "for-in-assignment":
      case "label":
        statement(node.body);
        return;
      default:
        // Switch clauses share one scope across cases, so a later clause can
        // run without an earlier clause's declaration: never recorded.
        return;
    }
  }
  function statements(list: readonly Statement[]): void {
    for (const node of list) {
      if (node === undefined) throw "statement invariant";
      statement(node);
    }
  }
  // Nested functions are walked as their own bodies.
  statements(checked.module.statements);
  for (const [, body] of checked.bodies) {
    const block = body.body;
    if (block.kind !== "block") continue;
    statements(block.statements);
    sinkHoisted(block.statements);
  }
  /** Where a hoisted declaration is created: after its sink statement, or at
   * scope entry (-1). Declarations created at one point are created in
   * source order (see hoistFunctions). */
  function creation(declaration: Span): number {
    const sink = sinks.get(declaration);
    return sink === undefined ? -1 : sink.end;
  }
  /** Every direct captor of function declaration `binding` is created after
   * it in the same scope: a later hoisted sibling, or a function expression
   * evaluated after its creation point. */
  function createdBeforeCaptors(binding: BoundBinding): boolean {
    const declaration: Span = binding.node,
      created = creation(declaration);
    for (const captor of directCaptors[binding.id] ?? []) {
      if (captor === undefined) throw "captor invariant";
      const body = checked.bodies.get(captor);
      if (body === undefined) return false;
      const node: Span = body.node;
      if (!hoistedDeclarations.has(node)) {
        if (node.start < created) return false;
        continue;
      }
      const sibling = checked.bindings.bindings[bindingByNode.get(node) ?? -1];
      if (sibling === undefined || sibling.scope !== binding.scope)
        return false;
      const at = creation(node);
      if (at < created || (at === created && node.start <= declaration.start))
        return false;
    }
    return true;
  }
  for (const binding of checked.bindings.bindings) {
    if (binding === undefined) throw "capture binding invariant";
    const kind = binding.kind;
    if (binding.capture === "reference") continue;
    if (
      binding.capture === "value" &&
      kind === "const" &&
      binding.captured &&
      writes.written[binding.id] !== 1
    ) {
      // An explicit hint describes what the value may snapshot once initialized.
      // A hoisted declaration can still be created before the initializer.
      const initialized = initializedAt.get(binding.node) ?? Infinity;
      let ready = true;
      for (const captor of directCaptors[binding.id] ?? []) {
        if (captor === undefined) throw "captor invariant";
        const node = checked.bodies.get(captor)?.node;
        if (
          node === undefined ||
          (hoistedDeclarations.has(node) && creation(node) < initialized)
        ) {
          ready = false;
          break;
        }
      }
      if (ready) result[binding.id] = 1;
      continue;
    }
    // Never-reassigned function declarations: each captor copies the
    // function object once it exists.
    if (
      kind === "function" &&
      binding.captured &&
      binding.owner !== undefined &&
      writes.written[binding.id] !== 1 &&
      checked.bindings.scopes[binding.scope]?.strict === true &&
      hoistedDeclarations.has(binding.node) &&
      createdBeforeCaptors(binding)
    ) {
      result[binding.id] = 1;
      continue;
    }
    const written = writes.written[binding.id] === 1;
    if (
      (kind !== "const" && kind !== "let") ||
      !binding.captured ||
      binding.owner === undefined ||
      (written && (kind !== "let" || writes.foreign[binding.id] === 1))
    )
      continue;
    const sites = written ? (writes.ownerSites[binding.id] ?? []) : [];
    // The end of the innermost statement containing any write: the write
    // has completed there (an assignment's target precedes its value).
    let lastWrite = -1;
    const shape =
      sites.length === 0 ? undefined : ownerStatements(binding.owner);
    if (sites.length > 0 && shape === undefined) continue;
    for (const site of sites) {
      if (site === undefined) throw "capture write invariant";
      let end = -1,
        width = Infinity;
      for (const node of shape?.statements ?? []) {
        if (node === undefined) throw "capture statement invariant";
        if (
          node.start <= site.start &&
          site.end <= node.end &&
          node.end - node.start < width
        ) {
          end = node.end;
          width = node.end - node.start;
        }
      }
      // A write outside every statement (a parameter default) keeps the cell.
      lastWrite = end < 0 ? Infinity : Math.max(lastWrite, end);
    }
    const scope = checked.bindings.scopes[binding.scope];
    if (
      scope === undefined ||
      scope.strict !== true ||
      (scope.kind !== "function-body" &&
        scope.kind !== "function" &&
        scope.kind !== "block")
    )
      continue;
    const initialized = initializedAt.get(binding.node);
    if (initialized === undefined) continue;
    let ordered = true;
    for (const captor of directCaptors[binding.id] ?? []) {
      if (captor === undefined) throw "captor invariant";
      const body = checked.bodies.get(captor);
      if (body === undefined) {
        ordered = false;
        break;
      }
      // A sunk hoisted declaration is created after its sink statement.
      const sink = sinks.get(body.node);
      const created = hoistedDeclarations.has(body.node)
        ? sink === undefined
          ? -1
          : sink.end
        : body.node.start;
      if (
        created < 0 ||
        created < initialized ||
        created < lastWrite ||
        rerunsWrite(binding.node, sites, body.node, shape)
      ) {
        ordered = false;
        break;
      }
    }
    if (ordered) result[binding.id] = 1;
  }
  /** Whether a loop of the owner's body may run one of `sites` again after
   * `captor` (or its declaration statement) is created: it contains both but
   * not the binding's declaration (a binding declared in the loop is a fresh
   * one each iteration). */
  function rerunsWrite(
    declaration: Span,
    sites: readonly Span[],
    captor: Span,
    shape: BodyStatements | undefined,
  ): boolean {
    if (sites.length === 0) return false;
    if (shape === undefined) return true;
    for (const loop of shape.loops) {
      if (loop === undefined) throw "capture loop invariant";
      if (
        captor.start < loop.start ||
        captor.start >= loop.end ||
        (declaration.start >= loop.start && declaration.start < loop.end)
      )
        continue;
      for (const site of sites) {
        if (site === undefined) throw "capture write invariant";
        if (site.start >= loop.start && site.start < loop.end) return true;
      }
    }
    return false;
  }
}
/** Declarations proven never reassigned and used exclusively as direct callees need no runtime function cell. */
export function directFunctions(
  checked: CheckedClosures,
): (number | undefined)[] {
  const calls = createKeyIndex<Expression, number>(syntaxHash);
  checked.expressions.forEach((type, node) => {
    if (node.kind === "call") {
      let callee = node.callee;
      while (callee.kind === "group") callee = callee.expression;
      if (callee.kind === "identifier") calls.set(callee, 1);
    }
  });
  const indirect: number[] = [];
  for (const reference of checked.bindings.references) {
    if (reference === undefined) throw "reference graph invariant";
    const binding = reference.binding;
    if (
      binding !== undefined &&
      (reference.access !== "read" || calls.get(reference.node) === undefined)
    )
      indirect[binding] = 1;
  }
  const functions = createKeyIndex<Span, number>(syntaxHash);
  for (const fn of checked.bindings.functions) {
    if (fn === undefined) throw "function graph invariant";
    if (functions.get(fn.node) === undefined) functions.set(fn.node, fn.id);
  }
  const result: (number | undefined)[] = [];
  for (const binding of checked.bindings.bindings) {
    if (binding === undefined) throw "binding graph invariant";
    if (binding.kind !== "function" || indirect[binding.id] === 1) continue;
    const fn = functions.get(binding.node);
    if (fn !== undefined) result[binding.id] = fn;
  }
  return result;
}
export function planScalarClosures(
  checked: CheckedClosures,
  target: TargetDataLayout,
  maxBytes: number,
): PlanResult {
  const direct = directFunctions(checked),
    graph = {
      ...checked.bindings,
      bindings: checked.bindings.bindings.map((b) =>
        direct[b.id] !== undefined ? { ...b, captured: false } : b,
      ),
      functions: checked.bindings.functions.map((f) => ({
        ...f,
        captures: f.captures.filter((c) => direct[c.binding] === undefined),
      })),
    };
  const representations: BindingStorage[] = [];
  for (const binding of graph.bindings) {
    if (binding === undefined) throw "planned binding invariant";
    if (binding.captured) {
      const type = checked.bindingTypes[binding.id],
        encoding = type === undefined ? undefined : scalarType(checked, type),
        bytes =
          encoding === undefined
            ? undefined
            : encoding === "optional-boolean"
              ? 16
              : 8;
      if (bytes === undefined)
        return {
          ok: false,
          error: "capture requires a supported scalar representation",
        };
      representations.push({ binding: binding.id, size: bytes, alignment: 8 });
    }
  }
  return planClosures(graph, representations, target, maxBytes);
}

export function scalarType(
  checked: CheckedClosures,
  id: number,
): ScalarType | undefined {
  const t = checked.types[id];
  if (t === undefined) return undefined;
  if (t.kind === "number" || t.kind === "boolean") return t.kind;
  const array = nativeTypedArray(t.kind);
  if (array !== undefined) return array;
  if (t.kind === "undefined") return "optional-number";
  if (t.kind === "literal")
    return typeof t.value === "number"
      ? "number"
      : typeof t.value === "boolean"
        ? "boolean"
        : undefined;
  if (t.kind === "union") {
    // Each member's type once: nested unions (a narrowed discriminated
    // union is a chain of two-member unions) then cost linear time, where
    // recomputing members per test cost three times as much per level.
    const members = t.members.map((m) => scalarType(checked, m)),
      first = members[0];
    if (first !== undefined && members.every((m) => m === first)) return first;
    if (
      members.length > 0 &&
      members.every((m) => m === "number" || m === "optional-number")
    )
      return "optional-number";
    let optionalBoolean = members.length > 0;
    for (let index = 0; index < members.length; index++) {
      const member = members[index];
      if (
        checked.types[t.members[index] ?? -1]?.kind !== "undefined" &&
        member !== "boolean" &&
        member !== "optional-boolean"
      )
        optionalBoolean = false;
    }
    if (optionalBoolean) return "optional-boolean";
  }
  return undefined;
}
