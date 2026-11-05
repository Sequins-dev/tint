import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const map=new Map([["a",19],["b",23],["a",42]]);if(map.size!==2||map.get("a")!==42)throw 1;`,
  `const map=new Map([["a",42],["b",23]]);if(map.keys().toArray().join()!=="a,b")throw 1;`,
  `const map=new Map([["a",42],["b",23]]);if(map.values().toArray().join()!=="42,23")throw 1;`,
  `const map=new Map([["a",42],["b",23]]);const entry=map.entries().next().value;if(!Array.isArray(entry)||entry.length!==2||entry[0]!=="a"||entry[1]!==42)throw 1;`,
  `const map=new Map();if(map[Symbol.iterator]!==map.entries)throw 1;map.set(undefined,undefined);if(!map.has(undefined)||!map.delete(undefined)||map.delete(undefined)||map.size!==0)throw 2;`,
  `const map=new Map([["a",42],["b",23]]);map.clear();if(map.size!==0||map.has("a")||map.clear()!==undefined)throw 1;`,
]);
