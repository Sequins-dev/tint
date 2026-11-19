import type { CheckedClosures } from "@tint/typescript/checker";
import type { CollectionElement } from "../../scalar.ts";
import { arrayElement, setElement, mapEncoding } from "./records.ts";
export interface RuntimeRequirements {
  readonly sorts: readonly {
    readonly type: number;
    readonly element: CollectionElement;
  }[];
  readonly lists: readonly {
    readonly type: number;
    readonly element: CollectionElement;
  }[];
  readonly sets: readonly {
    readonly type: number;
    readonly element: CollectionElement;
  }[];
  readonly maps: readonly {
    readonly type: number;
    readonly key: CollectionElement;
    readonly value: CollectionElement;
  }[];
  readonly unsupported: readonly {
    readonly type: number;
    readonly kind: "array" | "set" | "map";
  }[];
}
/** Discover representation-specific collection helpers from checked executable contracts. */
export function collectRuntimeRequirements(
  checked: CheckedClosures,
): RuntimeRequirements {
  const pending: number[] = [],
    seen = new Uint8Array(checked.types.length);
  const lists: { type: number; element: CollectionElement }[] = [],
    sets: { type: number; element: CollectionElement }[] = [],
    maps: { type: number; key: CollectionElement; value: CollectionElement }[] =
      [],
    unsupported: { type: number; kind: "array" | "set" | "map" }[] = [];
  function add(id: number): void {
    if (seen[id] !== 1) {
      seen[id] = 1;
      pending.push(id);
    }
  }
  for (const type of checked.bindingTypes) if (type !== undefined) add(type);
  checked.expressions.forEach((type, expression) => add(type));
  checked.restCalls?.forEach((rest, _expression) => add(rest.list));
  for (const [id, body] of checked.bodies) add(body.result);
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (id === undefined) throw "pending type invariant";
    const type = checked.types[id];
    if (type === undefined) throw "checked type invariant";
    switch (type.kind) {
      case "array": {
        if (type.realmArray === true) {
          add(type.element);
          break;
        }
        const element = arrayElement(checked, id);
        if (element === undefined)
          unsupported.push({ type: id, kind: "array" });
        else if (!lists.some((l) => l !== undefined && l.element === element))
          lists.push({ type: id, element });
        add(type.element);
        break;
      }
      case "set": {
        const element = setElement(checked, id);
        if (element === undefined) unsupported.push({ type: id, kind: "set" });
        else if (!sets.some((s) => s !== undefined && s.element === element))
          sets.push({ type: id, element });
        add(type.element);
        break;
      }
      case "map": {
        const encoding = mapEncoding(checked, id);
        if (encoding === undefined) unsupported.push({ type: id, kind: "map" });
        else if (
          !maps.some(
            (m) =>
              m !== undefined &&
              m.key === encoding.key &&
              m.value === encoding.value,
          )
        )
          maps.push({ type: id, key: encoding.key, value: encoding.value });
        add(type.key);
        add(type.value);
        break;
      }
      case "object":
        for (const property of type.properties) {
          if (property === undefined) throw "checked property invariant";
          add(property.type);
        }
        break;
      case "function":
        for (const parameter of type.parameters) {
          if (parameter === undefined) throw "checked parameter invariant";
          add(parameter);
        }
        add(type.result);
        break;
      case "union":
        for (const member of type.members) {
          if (member === undefined) throw "checked union invariant";
          add(member);
        }
        break;
    }
  }
  const sorts: { type: number; element: CollectionElement }[] = [];
  checked.intrinsics.forEach((operation, node) => {
    if (operation !== "list-sort" || node.kind !== "call") return;
    let target = node.callee;
    while (target.kind === "group") target = target.expression;
    if (target.kind !== "member") throw "sort receiver invariant";
    const type = checked.expressions.get(target.object);
    const element =
      type === undefined ? undefined : arrayElement(checked, type);
    if (type === undefined || element === undefined)
      throw "sort element invariant";
    if (!sorts.some((sort) => sort !== undefined && sort.element === element))
      sorts.push({ type, element });
  });
  return { lists, sets, maps, sorts, unsupported };
}
