import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  syntaxHash,
  type Span,
} from "../packages/typescript/src/syntax/index.ts";
const nodes: readonly Span[] = [
  { start: 0, end: 0 },
  { start: 5, end: 30, nodeHash: 0 },
  { start: 1234567, end: 1234578, nodeHash: 19 },
  { start: 5, end: 30, nodeHash: 2147483648 },
  { start: 4294967295, end: 4294967295, nodeHash: 4294967295 },
];
verifyHostedFixture(
  `import {syntaxHash} from "hash";
import type {Span} from "hash";
export function run():number {
 const nodes:readonly Span[]=${JSON.stringify(nodes)}, expected:readonly number[]=${JSON.stringify(nodes.map(syntaxHash))};
 for(let index=0;index<nodes.length;index++){const node:Span|undefined=nodes[index],value=expected[index];if(node===undefined||value===undefined)return 1;if(syntaxHash(node)!==value)return index+2;}
 return 42;
}`,
  "syntax-hash",
  [["hash", "packages/typescript/src/syntax/index.ts"]],
);
