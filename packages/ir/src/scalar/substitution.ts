import type { Instruction, Terminator } from "./model.ts";
/** Dense substitutions encode replacement ID + 1; zero retains the original.
 * Only operands change. Definitions, slots, labels, descriptors and spans do not.
 * The caller supplies canonical replacements; this primitive does not chase chains. */
export function substitutedValue(values: Uint32Array, id: number): number {
  const replacement = values[id] ?? 0;
  return replacement === 0 ? id : replacement - 1;
}
function list(
  input: readonly number[],
  values: Uint32Array,
): readonly number[] {
  let output: number[] | undefined;
  for (let i = 0; i < input.length; i++) {
    const before = input[i];
    if (before === undefined) throw "substitution operand invariant";
    const after = substitutedValue(values, before);
    if (after !== before && output === undefined) output = input.slice(0, i);
    if (output !== undefined) output.push(after);
  }
  return output === undefined ? input : output;
}
function optionalList(
  input: readonly (number | undefined)[],
  values: Uint32Array,
): readonly (number | undefined)[] {
  let output: (number | undefined)[] | undefined;
  for (let i = 0; i < input.length; i++) {
    const before = input[i],
      after =
        before === undefined ? undefined : substitutedValue(values, before);
    if (after !== before && output === undefined) output = input.slice(0, i);
    if (output !== undefined) output.push(after);
  }
  return output === undefined ? input : output;
}
export function substituteInstructionValues(
  op: Instruction,
  values: Uint32Array,
): Instruction {
  switch (op.kind) {
    case "function-environment": {
      const callee = substitutedValue(values, op.callee);
      return callee === op.callee ? op : { ...op, callee };
    }
    case "function-address":
    case "record-descriptor-address":
    case "constant":
    case "load":
    case "undefined":
    case "general-null":
    case "general-none":
    case "script-argument-count":
    case "script-argument-area":
    case "boolean-none":
    case "string-none":
    case "reference-none":
    case "string-literal":
    case "closure-environment":
      return op;
    case "store":
    case "general-kind":
    case "general-record-is":
    case "general-is":
    case "general-record-descriptor":
    case "general-wrap":
    case "general-value":
    case "boolean-wrap":
    case "boolean-value":
    case "boolean-present":
    case "primitive-wrap":
    case "primitive-reference":
    case "string-wrap":
    case "string-value":
    case "string-present":
    case "reference-wrap":
    case "reference-value":
    case "string-reference":
    case "reference-string":
    case "error-message":
    case "error-is":
    case "optional-wrap":
    case "optional-present":
    case "optional-value": {
      const value = substitutedValue(values, op.value);
      return value === op.value ? op : { ...op, value };
    }
    case "optional-value-or": {
      const value = substitutedValue(values, op.value),
        fallback = substitutedValue(values, op.fallback);
      return value === op.value && fallback === op.fallback
        ? op
        : { ...op, value, fallback };
    }
    case "unary": {
      const operand = substitutedValue(values, op.operand);
      return operand === op.operand ? op : { ...op, operand };
    }
    case "binary":
    case "general-equal":
    case "string-concat": {
      const left = substitutedValue(values, op.left),
        right = substitutedValue(values, op.right);
      return left === op.left && right === op.right
        ? op
        : { ...op, left, right };
    }
    case "record-read":
    case "record-has": {
      const object = substitutedValue(values, op.object);
      return object === op.object ? op : { ...op, object };
    }
    case "error-new": {
      const message = substitutedValue(values, op.message);
      return message === op.message ? op : { ...op, message };
    }
    case "string-length":
    case "string-two-byte":
    case "string-flat": {
      const string = substitutedValue(values, op.string);
      return string === op.string ? op : { ...op, string };
    }
    case "string-flatten-into": {
      const address = substitutedValue(values, op.address),
        byteLength = substitutedValue(values, op.byteLength),
        string = substitutedValue(values, op.string);
      return address === op.address &&
        byteLength === op.byteLength &&
        string === op.string
        ? op
        : { ...op, address, byteLength, string };
    }
    case "string-code-unit": {
      const string = substitutedValue(values, op.string),
        index = substitutedValue(values, op.index);
      return string === op.string && index === op.index
        ? op
        : { ...op, string, index };
    }
    case "string-from-latin1":
    case "bytes-ascii-prefix":
    case "string-from-utf8": {
      const bytes = substitutedValue(values, op.bytes),
        begin = substitutedValue(values, op.begin),
        limit = substitutedValue(values, op.limit);
      return bytes === op.bytes && begin === op.begin && limit === op.limit
        ? op
        : { ...op, bytes, begin, limit };
    }
    case "string-ascii-case": {
      const string = substitutedValue(values, op.string);
      return string === op.string ? op : { ...op, string };
    }
    case "string-ascii-prefix":
    case "string-utf8-length": {
      const string = substitutedValue(values, op.string),
        begin = substitutedValue(values, op.begin),
        limit = substitutedValue(values, op.limit);
      return string === op.string && begin === op.begin && limit === op.limit
        ? op
        : { ...op, string, begin, limit };
    }
    case "string-copy-latin1":
    case "string-write-utf8": {
      const string = substitutedValue(values, op.string),
        begin = substitutedValue(values, op.begin),
        limit = substitutedValue(values, op.limit),
        bytes = substitutedValue(values, op.bytes),
        offset = substitutedValue(values, op.offset);
      return string === op.string &&
        begin === op.begin &&
        limit === op.limit &&
        bytes === op.bytes &&
        offset === op.offset
        ? op
        : { ...op, string, begin, limit, bytes, offset };
    }
    case "string-starts-with":
    case "string-index-of": {
      const string = substitutedValue(values, op.string),
        search = substitutedValue(values, op.search),
        position = substitutedValue(values, op.position);
      return string === op.string &&
        search === op.search &&
        position === op.position
        ? op
        : { ...op, string, search, position };
    }
    case "string-slice": {
      const string = substitutedValue(values, op.string),
        begin = substitutedValue(values, op.begin),
        limit = substitutedValue(values, op.limit);
      return string === op.string && begin === op.begin && limit === op.limit
        ? op
        : { ...op, string, begin, limit };
    }
    case "weak-slot-new": {
      const key = substitutedValue(values, op.key),
        value = substitutedValue(values, op.value),
        ephemeron = substitutedValue(values, op.ephemeron);
      return key === op.key && value === op.value && ephemeron === op.ephemeron
        ? op
        : { ...op, key, value, ephemeron };
    }
    case "weak-slot-key":
    case "weak-slot-value":
    case "weak-slot-clear": {
      const cell = substitutedValue(values, op.cell);
      return cell === op.cell ? op : { ...op, cell };
    }
    case "weak-slot-set-value": {
      const cell = substitutedValue(values, op.cell),
        value = substitutedValue(values, op.value);
      return cell === op.cell && value === op.value
        ? op
        : { ...op, cell, value };
    }
    case "reference-vector-new":
    case "array-new": {
      const length = substitutedValue(values, op.length);
      return length === op.length ? op : { ...op, length };
    }
    case "reference-vector-is":
    case "reference-vector-length": {
      const vector = substitutedValue(values, op.vector);
      return vector === op.vector ? op : { ...op, vector };
    }
    case "reference-vector-read": {
      const vector = substitutedValue(values, op.vector),
        index = substitutedValue(values, op.index);
      return vector === op.vector && index === op.index
        ? op
        : { ...op, vector, index };
    }
    case "reference-vector-write": {
      const vector = substitutedValue(values, op.vector),
        index = substitutedValue(values, op.index),
        value = substitutedValue(values, op.value);
      return vector === op.vector && index === op.index && value === op.value
        ? op
        : { ...op, vector, index, value };
    }
    case "reference-vector-copy": {
      const source = substitutedValue(values, op.source),
        target = substitutedValue(values, op.target),
        count = substitutedValue(values, op.count);
      return source === op.source && target === op.target && count === op.count
        ? op
        : { ...op, source, target, count };
    }
    case "array-subarray": {
      const array = substitutedValue(values, op.array),
        begin = substitutedValue(values, op.begin),
        length = substitutedValue(values, op.length);
      return array === op.array && begin === op.begin && length === op.length
        ? op
        : { ...op, array, begin, length };
    }
    case "array-length":
    case "array-buffer":
    case "array-byte-offset":
    case "array-byte-length": {
      const array = substitutedValue(values, op.array);
      return array === op.array ? op : { ...op, array };
    }
    case "array-valid":
    case "array-read":
    case "array-element": {
      const array = substitutedValue(values, op.array),
        index = substitutedValue(values, op.index);
      return array === op.array && index === op.index
        ? op
        : { ...op, array, index };
    }
    case "array-copy": {
      const array = substitutedValue(values, op.array),
        source = substitutedValue(values, op.source),
        offset = substitutedValue(values, op.offset);
      return array === op.array && source === op.source && offset === op.offset
        ? op
        : { ...op, array, source, offset };
    }
    case "array-write":
    case "array-store": {
      const array = substitutedValue(values, op.array),
        index = substitutedValue(values, op.index),
        value = substitutedValue(values, op.value);
      return array === op.array && index === op.index && value === op.value
        ? op
        : { ...op, array, index, value };
    }
    case "function-new": {
      const before = op.environment;
      if (before === undefined) return op;
      const environment = substitutedValue(values, before);
      return environment === before ? op : { ...op, environment };
    }
    case "call": {
      const args = list(op.arguments, values),
        receiver =
          op.receiver === undefined
            ? undefined
            : substitutedValue(values, op.receiver);
      if (args === op.arguments && receiver === op.receiver) return op;
      return {
        ...op,
        arguments: args,
        ...(receiver === undefined ? {} : { receiver }),
      };
    }
    case "host-call": {
      const args = list(op.arguments, values);
      return args === op.arguments ? op : { ...op, arguments: args };
    }
    case "c-call":
    case "c-memory": {
      const args = list(op.arguments, values);
      return args === op.arguments ? op : { ...op, arguments: args };
    }
    case "call-indirect": {
      const args = list(op.arguments, values),
        actuals =
          op.scriptArguments === undefined
            ? undefined
            : list(op.scriptArguments, values),
        callee = substitutedValue(values, op.callee),
        receiver =
          op.receiver === undefined
            ? undefined
            : substitutedValue(values, op.receiver);
      return args === op.arguments &&
        actuals === op.scriptArguments &&
        callee === op.callee &&
        receiver === op.receiver
        ? op
        : {
            ...op,
            arguments: args,
            callee,
            ...(receiver === undefined ? {} : { receiver }),
            ...(actuals === undefined ? {} : { scriptArguments: actuals }),
          };
    }
    case "script-argument": {
      const index = substitutedValue(values, op.index);
      const frame = op.frame;
      if (frame === undefined)
        return index === op.index ? op : { ...op, index };
      const count = substitutedValue(values, frame.count),
        registers = substitutedValue(values, frame.registers),
        stack = substitutedValue(values, frame.stack);
      return index === op.index &&
        count === frame.count &&
        registers === frame.registers &&
        stack === frame.stack
        ? op
        : { ...op, index, frame: { count, registers, stack } };
    }
    case "record-new": {
      const args = optionalList(op.arguments, values),
        before = op.presence,
        presence =
          before === undefined ? undefined : optionalList(before, values);
      if (args === op.arguments && presence === before) return op;
      return presence === undefined
        ? { ...op, arguments: args }
        : { ...op, arguments: args, presence };
    }
    case "string-from-code-units": {
      const mapped = list(op.values, values);
      return mapped === op.values ? op : { ...op, values: mapped };
    }
    case "string-allocate": {
      const length = substitutedValue(values, op.length),
        twoByte = substitutedValue(values, op.twoByte);
      return length === op.length && twoByte === op.twoByte
        ? op
        : { ...op, length, twoByte };
    }
    case "string-write": {
      const target = substitutedValue(values, op.target),
        offset = substitutedValue(values, op.offset),
        source = substitutedValue(values, op.source);
      return target === op.target &&
        offset === op.offset &&
        source === op.source
        ? op
        : { ...op, target, offset, source };
    }
    case "number-string-cached": {
      const value = substitutedValue(values, op.value);
      return value === op.value ? op : { ...op, value };
    }
    case "number-string-cache": {
      const value = substitutedValue(values, op.value),
        string = substitutedValue(values, op.string);
      return value === op.value && string === op.string
        ? op
        : { ...op, value, string };
    }
    case "string-index-cached": {
      const string = substitutedValue(values, op.string);
      return string === op.string ? op : { ...op, string };
    }
    case "string-index-cache": {
      const string = substitutedValue(values, op.string),
        value = substitutedValue(values, op.value);
      return string === op.string && value === op.value
        ? op
        : { ...op, string, value };
    }
    case "string-split-cached": {
      const string = substitutedValue(values, op.string),
        separator = substitutedValue(values, op.separator),
        template = substitutedValue(values, op.template);
      return string === op.string &&
        separator === op.separator &&
        template === op.template
        ? op
        : { ...op, string, separator, template };
    }
    case "string-split-cache": {
      const string = substitutedValue(values, op.string),
        separator = substitutedValue(values, op.separator),
        value = substitutedValue(values, op.value);
      return string === op.string &&
        separator === op.separator &&
        value === op.value
        ? op
        : { ...op, string, separator, value };
    }
  }
  throw "unsupported instruction substitution";
}
export function substituteTerminatorValues(
  op: Terminator,
  values: Uint32Array,
): Terminator {
  switch (op.kind) {
    case "record":
    case "record-cell": {
      const object = substitutedValue(values, op.object);
      return object === op.object ? op : { ...op, object };
    }
    case "throw": {
      const value = substitutedValue(values, op.value);
      return value === op.value ? op : { ...op, value };
    }
    case "return": {
      const before = op.value;
      if (before === undefined) return op;
      const value = substitutedValue(values, before);
      return value === before ? op : { ...op, value };
    }
    case "branch": {
      const condition = substitutedValue(values, op.condition);
      return condition === op.condition ? op : { ...op, condition };
    }
    case "trap":
    case "throw-literal":
    case "jump":
    case "cell":
      return op;
  }
  throw "unsupported terminator substitution";
}

/** `op` defining `id` instead of its own result (instructions without a
 * result are returned unchanged). Copies of code take fresh value IDs. */
export function renumberInstructionResult(
  op: Instruction,
  id: number,
): Instruction {
  switch (op.kind) {
    case "store":
    case "array-write":
    case "array-store":
    case "weak-slot-set-value":
    case "weak-slot-clear":
    case "reference-vector-write":
    case "reference-vector-copy":
    case "string-write":
    case "number-string-cache":
    case "string-index-cache":
    case "string-split-cache":
      return op;
    default:
      return { ...op, id };
  }
}
