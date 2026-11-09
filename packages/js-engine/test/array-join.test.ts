import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { createLoweredRealm } from "./lowered-node-host.ts";

/** Array.prototype.join and toLocaleString keep one length snapshot, read
 * every index in order (holes and inherited elements included), convert each
 * element immediately after reading it, and insert separators between all
 * positions. Each case is compared with Node's own result. */
const cases = [
  "print([1,2,3].join());",
  "print([1,2,3].join(''));",
  "print([1,,3,undefined,null,'x'].join('-'));",
  "print([].join('|') + '|' + [7].join('|'));",
  "var a=[1,2,3];print(a.join({toString(){a.length=1;return '+';}}));",
  "var log=[];var a=[{toString(){log.push('a');return 'A';}},{toString(){log.push('b');return 'B';}}];print(a.join(':'));print(log.join());",
  "var log=[];var o={length:3,get 0(){log.push('g0');return {toString(){log.push('s0');return 'x';}};},get 1(){log.push('g1');return 'y';},get 2(){log.push('g2');return {toString(){log.push('s2');return 'z';}};}};print(Array.prototype.join.call(o,'/'));print(log.join());",
  "Array.prototype[1]='inherited';print([0,,2].join());delete Array.prototype[1];",
  "var log=[];var a=[{toLocaleString(){log.push('l0');return 'L0';}},null,{toLocaleString(){log.push('l2');return 'L2';}}];print(a.toLocaleString());print(log.join());",
  "var big=[];for(var i=0;i<2000;i++)big.push(i%10);var s=big.join('');print(s.length+':'+s.slice(0,12)+':'+s.slice(-3));",
  "try{[{toString(){throw new RangeError('stop');}}].join();}catch(e){print(e instanceof RangeError?e.message:'other');}",
];
function nodePrinted(source: string): string[] {
  const printed: string[] = [];
  new Script(source).runInNewContext({
    print: (value: unknown) => printed.push(String(value)),
  });
  return printed;
}
for (const source of cases)
  test("array join matches Node: " + source.slice(0, 70), () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(source), "none");
    assert.deepEqual(realm.printed, nodePrinted(source));
  });
