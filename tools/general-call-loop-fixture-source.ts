export const generalCallLoopSource = `
export function run() {
  if (typeof Reflect !== "object") return 1;

  // A local loop binding can hold any JavaScript value.
  let visits = "";
  for (let i = 0; i !== "stop"; i = i === 0 ? 1 : "stop") {
    visits += i;
  }
  if (visits !== "01") return 3;

  let signedZero = -0;
  for (let i = 0; i < 1; i++) signedZero += -0;
  if (1 / signedZero !== -Infinity) return 9;

  let coercions = 0;
  const operand = { valueOf() { coercions++; return 5; } };
  let number = 1;
  for (let i = 0; i < 2; i++) number += operand;
  if (number !== 11 || coercions !== 2) return 10;

  try {
    for (let tdz = tdz; false; ) {}
    return 11;
  } catch (error) {
    if (!(error instanceof ReferenceError)) return 12;
  }

  // An initializer closure retains the pre-iteration binding. The body
  // closure retains its iteration's binding after continue unwinds finally.
  let initial;
  let captured;
  let finalized = 0;
  for (let i = 0, getInitial = () => i; i < 2; i++) {
    initial = getInitial;
    if (i === 0) {
      captured = () => i;
      try {
        continue;
      } finally {
        finalized++;
      }
    }
  }
  if (initial() !== 0 || captured() !== 0 || finalized !== 1) return 4;

  const sentinel = {};
  let order = "";
  const receiver = {
    get method() {
      order += "get ";
      return function (a, b) {
        if (this !== receiver || a !== 1 || b !== 2 || arguments.length !== 2)
          return 5;
        order += "call";
        throw sentinel;
      };
    },
  };
  function argument(value) {
    order += value + " ";
    return value;
  }
  try {
    receiver.method(argument(1), argument(2));
    return 6;
  } catch (error) {
    if (error !== sentinel) return 7;
  }
  if (order !== "get 1 2 call") return 8;

  function numericSum(bound, step) {
    const next = value => value + 1;
    let total = 0;
    for (let i = 0; i < bound; i++) total += next(i) * step;
    return total;
  }
  if (numericSum(3, 2) !== 12 || numericSum("3", 2) !== 12 ||
      numericSum(3, "2") !== 12 || numericSum(NaN, 2) !== 0 ||
      numericSum(3) === numericSum(3) || numericSum(1, 2, 3) !== 2)
    return 13;
  let bounds = 0;
  if (numericSum({ valueOf() { bounds++; return 2; } }, 2) !== 6 ||
      bounds !== 3)
    return 14;
  try {
    numericSum({ valueOf() { throw sentinel; } }, 2);
    return 15;
  } catch (error) {
    if (error !== sentinel) return 16;
  }

  let next = value => value + 1;
  if (next(2) !== 3 || next("2") !== "21") return 17;
  function replace(value) { return value * 10; }
  if (next((next = replace, 2)) !== 3 || next(2) !== 20) return 18;
  const identity = value => value;
  if (1 / identity(-0) !== -Infinity) return 19;

  let value = -0;
  const before = value++;
  if (value !== 1 || 1 / before !== -Infinity || NaN === NaN) return 20;
  let wide = 1n;
  if (wide++ !== 1n || wide !== 2n || 0n || !wide) return 21;

  function add(a, b) {
    if (a === "throw") throw sentinel;
    return a + b;
  }
  if (add(20, 22, 13) !== 42 || add(42) === add(42)) return 22;
  try { add("throw", 2); return 23; }
  catch (error) { if (error !== sentinel) return 24; }
  const bound = add.bind(null, 20);
  const proxy = new Proxy(add, {
    apply(target, base, values) { return Reflect.apply(target, base, values); },
  });
  if (bound(22) !== 42 || proxy(20, 22) !== 42) return 25;

  const first = { method() { return this.current + 1; } };
  const second = { method() { return this.current + 2; } };
  const subject = Object.create(first);
  subject.current = 40;
  function method(value) { return value.method(); }
  function read(value) { return value.current; }
  function write(value, next) { value.current = next; }
  if (method(subject) !== 41 || read(subject) !== 40) return 26;
  Object.setPrototypeOf(subject, second);
  write(subject, 41);
  if (method(subject) !== 43 || read(subject) !== 41) return 27;
  subject.method = () => 7;
  if (method(subject) !== 7) return 28;
  delete subject.method;
  if (method(subject) !== 43) return 29;
  let calls = "";
  Object.defineProperty(subject, "current", {
    get() { calls += "get"; return 42; },
    set(value) { calls += "set" + value; },
  });
  write(subject, 5);
  const observed = new Proxy(subject, {
    get(target, key, originalReceiver) {
      calls += "trap";
      return Reflect.get(target, key, originalReceiver);
    },
  });
  if (read(observed) !== 42 || calls !== "set5trapget") return 30;

  {
    let wideOrder = "";
    const wide = {
      get call() {
        wideOrder += "g";
        return function(a, b, c, d, e, f) {
          return this === wide && arguments.length === 6 && a+b+c+d+e+f === 42;
        };
      }
    };
    function operandValue(value) {
      wideOrder += value;
      if (value === "x") throw value;
      return value;
    }
    if (!wide.call(operandValue(2), operandValue(3), 5, 7, 11, 14)) return 31;
    try { wide.call(operandValue(4), operandValue("x"), operandValue(9)); return 32; }
    catch (error) { if (error !== "x" || wideOrder !== "g23g4x") return 33; }

    const packed = [42, undefined];
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, "1", {get() { return 7; }});
    Object.setPrototypeOf(packed, prototype);
    function readIndex(array, index) { return array[index]; }
    if (readIndex(packed, -0) !== 42 || readIndex(packed, 1) !== undefined) return 34;
    delete packed[1];
    if (readIndex(packed, 1) !== 7) return 35;
    const proxy = new Proxy(packed, {get(target, key) { return key; }});
    if (readIndex(proxy, 0) !== "0") return 36;

    function readShape(object) { return object.read(); }
    let shapes = [{read() {return 1;}}, {a: 0, read() {return 2;}},
      {b: 0, read() {return 3;}}, {c: 0, read() {return 4;}},
      {d: 0, read() {return 5;}}];
    for (let pass = 0; pass < 2; pass++)
      for (let index = 0; index < shapes.length; index++)
        if (readShape(shapes[index]) !== index + 1) return 37;
    Object.defineProperty(shapes[0], "read", {get() {throw "getter";}});
    try { readShape(shapes[0]); return 38; }
    catch (error) { if (error !== "getter") return 39; }

    function join(left, right) { return left + right; }
    const joined = join("a", "🦉");
    if (joined.length !== 3 || joined !== "a🦉") return 40;
    if (join(2, 3) !== 5 || join({valueOf() {return "a";}}, true) !== "atrue") return 41;

    function capture(a = 0, ...rest) {
      if (a === sentinel) throw sentinel;
      if (this !== wide || new.target !== undefined) return -1;
      return a + arguments.length + (rest[5] || 0);
    }
    wide.capture = capture;
    if (wide.capture() !== 0 || wide.capture(1, 2, 3, 4, 5, 6, 7) !== 15)
      return 43;
    let traps = 0;
    wide.capture = new Proxy(capture, {apply(target, receiver, values) {
      traps++;
      if (values.length !== 8) return -1;
      return Reflect.apply(target, receiver, values);
    }});
    if (wide.capture(...[1, 2, 3, 4, 5, 6, 7, 8]) !== 16 || traps !== 1)
      return 44;
    try {
      wide.capture(sentinel, 2, 3, 4, 5, 6, 7, 8);
      return 45;
    } catch (error) {
      if (error !== sentinel || traps !== 2) return 46;
    }
    function last(a, b, c, d, e, f, g, h) { return this === wide ? h : g; }
    wide.last = last;
    if (wide.last(1, 2, 3, 4, 5, 6, 7) !== undefined ||
        wide.last(1, 2, 3, 4, 5, 6, 7, sentinel, "ignored") !== sentinel ||
        last(1, 2, 3, 4, 5, 6, sentinel) !== sentinel)
      return 47;

    let keyOrder = "";
    const indexed = {"0": 1, "-0": 2, "-1": 3, "01": 4};
    const indexedPrototype = Object.create(null);
    Object.defineProperty(indexedPrototype, "0", {
      get() { return this === indexed ? 11 : -1; },
      set(value) { keyOrder += "setter" + value; },
    });
    Object.setPrototypeOf(indexed, indexedPrototype);
    function writeIndex(object, key, value) { object[key] = value; }
    if (readIndex(indexed, -0) !== 1 || readIndex(indexed, -1) !== 3 ||
        readIndex(indexed, "-0") !== 2 || readIndex(indexed, 1) !== undefined)
      return 48;
    writeIndex(indexed, 0, 10);
    if (readIndex(indexed, 0) !== 10) return 49;
    delete indexed[0];
    if (readIndex(indexed, 0) !== 11) return 50;
    writeIndex(indexed, -0, 12);
    const computed = {toString() { keyOrder += "key"; return "0"; }};
    try { null[computed] = (keyOrder += "rhs", 13); return 51; }
    catch (error) { if (!(error instanceof TypeError)) return 52; }
    indexed[computed] = (keyOrder += "rhs", 14);
    if (keyOrder !== "setter12rhsrhskeysetter14") return 53;

    const bytes = new ArrayBuffer(8, {maxByteLength: 16});
    const view = new Uint8Array(bytes, 2, 4);
    writeIndex(view, -0, 42);
    if (readIndex(view, 0) !== 42 || readIndex(view, -1) !== undefined) return 54;
    bytes.resize(4);
    if (readIndex(view, 0) !== undefined) return 55;
    bytes.resize(8);
    if (readIndex(view, 0) !== 42 || readIndex(view, 3) !== 0) return 56;

    const sparse = [];
    writeIndex(sparse, 8, 42);
    if (readIndex(sparse, 8) !== 42) return 57;
    sparse.length = 0;
    if (readIndex(sparse, 8) !== undefined) return 58;
  }
  return 42;
}
`;

export const typedCallLoopSource = `
export function run(): number {
  const next = (value: number): number => value + 1;
  let sum: number = 0;
  for (let index: number = 0; index < 8; index++) {
    if (index === 2) continue;
    sum += next(index);
    if (index === 5) break;
  }
  return sum === 18 ? 42 : 1;
}
`;

// The incoming argument is a primitive. The object assigned to the parameter
// has no Script-visible root except the parameter's native slot.
export const generalSlotCollectionSource = `
function retain(value) {
  value = { answer: 42 };
  for (let index = 0; index < 5; index++) {
    const garbage = { answer: index };
    collectGarbage();
    if (garbage.answer !== index) return 1;
  }
  return value.answer;
}

function capture() {
  const value = { answer: 42 };
  return () => value.answer;
}

function keepWide(a, b, third, d, e, sixth) {
  collectGarbage();
  return third.answer + sixth.answer;
}

export function run() {
  if (typeof Reflect !== "object") return 2;
  const read = capture();
  collectGarbage();
  if (read() !== 42) return 3;
  if (keepWide(0, 0, { answer: 15 }, 0, 0, { answer: 27 }) !== 42) return 4;
  return retain(0);
}
`;
