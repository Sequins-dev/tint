export const valueField = 1;
export const writableField = 2;
export const getField = 4;
export const setField = 8;
export const enumerableField = 16;
export const configurableField = 32;

/** Complete immutable property state. Inactive payloads hold the caller's undefined value. */
export interface Descriptor<T> {
  readonly accessor: boolean;
  readonly value: T;
  readonly writable: boolean;
  readonly get: T;
  readonly set: T;
  readonly enumerable: boolean;
  readonly configurable: boolean;
}
/** Presence is separate from payload: a supplied undefined getter differs from no getter update. */
export interface DescriptorUpdate<T> {
  readonly fields: number;
  readonly value: T;
  readonly writable: boolean;
  readonly get: T;
  readonly set: T;
  readonly enumerable: boolean;
  readonly configurable: boolean;
}
export interface DescriptorResult<T> {
  readonly status: "accepted" | "rejected" | "invalid";
  readonly descriptor: Descriptor<T> | undefined;
}
export function emptyUpdate<T>(undefinedValue: T): DescriptorUpdate<T> {
  return {
    fields: 0,
    value: undefinedValue,
    writable: false,
    get: undefinedValue,
    set: undefinedValue,
    enumerable: false,
    configurable: false,
  };
}
/** ValidateAndApplyPropertyDescriptor without storage mutation. Callers validate getter/setter
 * callability while converting source descriptors, and supply ECMAScript SameValue and undefined.
 * Invalid mixed descriptors are distinct from a valid but rejected redefinition. */
export function applyDescriptor<T>(
  current: Descriptor<T> | undefined,
  extensible: boolean,
  update: DescriptorUpdate<T>,
  undefinedValue: T,
  sameValue: (left: T, right: T) => boolean,
): DescriptorResult<T> {
  const fields = update.fields;
  const data = (fields & 3) !== 0,
    accessor = (fields & 12) !== 0;
  if (
    !Number.isInteger(fields) ||
    fields < 0 ||
    fields > 63 ||
    (data && accessor)
  )
    return { status: "invalid", descriptor: current };
  let base: Descriptor<T>;
  if (current === undefined) {
    if (!extensible) return { status: "rejected", descriptor: current };
    base = {
      accessor,
      value: undefinedValue,
      writable: false,
      get: undefinedValue,
      set: undefinedValue,
      enumerable: false,
      configurable: false,
    };
  } else {
    if (fields === 0) return { status: "accepted", descriptor: current };
    if (!current.configurable) {
      if ((fields & configurableField) !== 0 && update.configurable)
        return { status: "rejected", descriptor: current };
      if (
        (fields & enumerableField) !== 0 &&
        update.enumerable !== current.enumerable
      )
        return { status: "rejected", descriptor: current };
    }
    if ((data || accessor) && accessor !== current.accessor) {
      if (!current.configurable)
        return { status: "rejected", descriptor: current };
      base = {
        accessor,
        value: undefinedValue,
        writable: false,
        get: undefinedValue,
        set: undefinedValue,
        enumerable: current.enumerable,
        configurable: current.configurable,
      };
    } else {
      base = current;
      if (!current.configurable) {
        if (!current.accessor && !current.writable) {
          if ((fields & writableField) !== 0 && update.writable)
            return { status: "rejected", descriptor: current };
          if (
            (fields & valueField) !== 0 &&
            !sameValue(current.value, update.value)
          )
            return { status: "rejected", descriptor: current };
        } else if (current.accessor) {
          if ((fields & getField) !== 0 && !sameValue(current.get, update.get))
            return { status: "rejected", descriptor: current };
          if ((fields & setField) !== 0 && !sameValue(current.set, update.set))
            return { status: "rejected", descriptor: current };
        }
      }
    }
  }
  return {
    status: "accepted",
    descriptor: {
      accessor: base.accessor,
      value: (fields & valueField) !== 0 ? update.value : base.value,
      writable:
        (fields & writableField) !== 0 ? update.writable : base.writable,
      get: (fields & getField) !== 0 ? update.get : base.get,
      set: (fields & setField) !== 0 ? update.set : base.set,
      enumerable:
        (fields & enumerableField) !== 0 ? update.enumerable : base.enumerable,
      configurable:
        (fields & configurableField) !== 0
          ? update.configurable
          : base.configurable,
    },
  };
}
