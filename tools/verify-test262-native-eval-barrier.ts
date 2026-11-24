import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// Write barriers in code that eval and Function publish at run time, on the
// generational Test262 host (docs/native-code-loading.md, "Trusted executable
// code"). In each case, run-time-compiled code stores a young object into an
// object that minor collections have already promoted. The case then forces
// more minor collections and reads the value back. A missing barrier leaves
// the old object pointing into the reclaimed nursery. Bespoke regression
// evidence, not a Test262 conformance measurement.
//
// churn() allocates several times the nursery of the 512 MiB Test262 heap in
// small objects, so every call runs minor collections. Every collection
// promotes all nursery survivors.
const churn = `
function churn() {
  var total = 0;
  for (var i = 0; i < 400000; i++) {
    var block = [i, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i,
                 i, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i];
    total += block.length;
  }
  return total;
}
function check(value, expected, label) {
  if (value === null || typeof value !== "object" || value.v !== expected ||
      value.tag !== "young")
    throw new Error(label + ": expected v=" + expected);
}
`;
verifyNativeScriptCases([
  // An eval-created closure stores into its own captured cell.
  `${churn}
var holder = eval(
  "(function () { var slot; return { set: function (v) { slot = v; }, get: function () { return slot; } }; })()"
);
churn();
churn();
for (var round = 0; round < 4; round++) {
  holder.set({ v: 7 + round, tag: "young" });
  churn();
  check(holder.get(), 7 + round, "eval closure cell, round " + round);
}`,
  // A Function-created body allocates the young object and stores it into a
  // property of an old object.
  `${churn}
var old = { p: null };
var store = Function("o", "n", "o.p = { v: n, tag: 'young' };");
churn();
churn();
for (var round = 0; round < 4; round++) {
  store(old, 7 + round);
  churn();
  check(old.p, 7 + round, "Function property store, round " + round);
}`,
  // Indirect eval code writes an element of an old array.
  `${churn}
var list = [null, null];
churn();
churn();
for (var round = 0; round < 4; round++) {
  (0, eval)("list[" + (round & 1) + "] = { v: " + (7 + round) + ", tag: 'young' };");
  churn();
  check(list[round & 1], 7 + round, "eval element store, round " + round);
}`,
  // Direct eval code writes a variable of the enclosing function's old
  // environment.
  `${churn}
function outer() {
  var captured = null;
  churn();
  churn();
  for (var round = 0; round < 4; round++) {
    eval("captured = { v: " + (7 + round) + ", tag: 'young' };");
    churn();
    check(captured, 7 + round, "direct eval environment store, round " + round);
  }
}
outer();`,
]);
