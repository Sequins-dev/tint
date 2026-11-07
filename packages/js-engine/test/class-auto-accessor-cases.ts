export const classAutoAccessorCases = [
  [
    "auto-accessors use branded storage with prototype getter/setter descriptors",
    `function check(value) { if (!value) throw new Error("check"); }

    class C { accessor x = 1; accessor y; }
    var a = new C(), b = new C();
    check(a.x === 1 && a.y === undefined && !Object.hasOwn(a, "x"));
    a.x = 42;
    check(a.x === 42 && b.x === 1);
    var d = Object.getOwnPropertyDescriptor(C.prototype, "x");
    check(d.enumerable === false && d.configurable === true);
    check(d.get.name === "get x" && d.get.length === 0);
    check(d.set.name === "set x" && d.set.length === 1);
    check(!Object.hasOwn(d.get, "prototype") && !Object.hasOwn(d.set, "prototype"));
    for (var receiver of [{}, C.prototype, 1, null]) {
      var rejected = false;
      try { d.get.call(receiver); } catch(e) { rejected = e instanceof TypeError; }
      check(rejected);
      rejected = false;
      try { d.set.call(receiver, 7); } catch(e) { rejected = e instanceof TypeError; }
      check(rejected);
    }
  `,
  ],
  [
    "static and private auto-accessors keep distinct brands and storage",
    `function check(value) { if (!value) throw new Error("check"); }

    class C {
      static accessor x = 10;
      accessor #x = 1;
      static accessor #y = 2;
      read() { return this.#x; }
      write(value) { this.#x = value; }
      static read() { return this.#y; }
      static write(value) { this.#y = value; }
      has(value) { return #x in value; }
    }
    var a = new C(), b = new C();
    a.write(42); C.write(43);
    check(a.read() === 42 && b.read() === 1 && C.read() === 43 && C.x === 10);
    check(a.has(a) && !a.has(C.prototype) && !a.has({}));
    class D extends C {}
    var errors = 0;
    try { D.x; } catch(e) { if (e instanceof TypeError) errors++; }
    try { D.read(); } catch(e) { if (e instanceof TypeError) errors++; }
    try { C.prototype.read.call({}); } catch(e) { if (e instanceof TypeError) errors++; }
    check(errors === 3);
    Object.preventExtensions(a); a.write(44); check(a.read() === 44);
  `,
  ],
  [
    "auto-accessor keys precede static initialization and initializers run in element order",
    `function check(value) { if (!value) throw new Error("check"); }

    var events = [];
    function key(name) { events.push(name); return name; }
    function init(name, value) { events.push(name); return value; }
    class C {
      accessor [key("x")] = init("ix", 1);
      static accessor [key("s")] = init("is", 2);
      accessor y = init("iy", this.x + C.s);
      static { events.push("block"); check(this.s === 2); }
    }
    check(events.join() === "x,s,is,block");
    var a = new C(), b = new C();
    check(a.y === 3 && b.y === 3);
    check(events.join() === "x,s,is,block,ix,iy,ix,iy");
    var symbol = Symbol("slot");
    class S { accessor [symbol] = 7; }
    check(new S()[symbol] === 7);
    var d = Object.getOwnPropertyDescriptor(S.prototype, symbol);
    check(d.get.name === "get [slot]" && d.set.name === "set [slot]");
  `,
  ],
  [
    "auto-accessor brands exist before initialization and abrupt completion stops later fields",
    `function check(value) { if (!value) throw new Error("check"); }

    var events = [], sentinel = {}, saved;
    class C {
      before = (saved = this, events.push("before"));
      accessor #x = (events.push("x"), (() => { throw sentinel; })());
      after = events.push("after");
      has(value) { return #x in value; }
      read() { return this.#x; }
    }
    var caught;
    try { new C(); } catch(e) { caught = e; }
    check(caught === sentinel && events.join() === "before,x");
    check(saved.has(saved));
    var rejected = false;
    try { saved.read(); } catch(e) { rejected = e instanceof TypeError; }
    check(rejected);
    class D { accessor x = this.x; }
    rejected = false;
    try { new D(); } catch(e) { rejected = e instanceof TypeError; }
    check(rejected);
  `,
  ],
  [
    "repeated public auto-accessors replace both accessor halves and retain separate backing fields",
    `function check(value) { if (!value) throw new Error("check"); }

    var events = [];
    class C {
      accessor x = (events.push(1), 1);
      accessor x = (events.push(2), 2);
    }
    var a = new C();
    check(a.x === 2 && events.join() === "1,2");
    a.x = 42; check(a.x === 42);
    class D extends C { accessor y = super.x; }
    check(new D().y === 2);
    var escaped;
    try {
      class E {
        static accessor x = (escaped = this, 3);
        static accessor y = (() => { throw 7; })();
        static after = events.push("after");
      }
    } catch(e) { check(e === 7); }
    check(escaped.x === 3 && events.join() === "1,2,1,2");
  `,
  ],
] as const;
