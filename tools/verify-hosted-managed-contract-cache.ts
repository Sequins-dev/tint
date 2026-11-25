import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {createManagedTypeContractCache,createManagedTypeContractIndex} from "contracts";
import type {Type} from "types";
export function run():number{
 const types:Type[]=[
  {kind:"number"},{kind:"string"},
  {kind:"object",properties:[{name:"value",type:0,readonly:true},{name:"next",type:2,readonly:true}]},
  {kind:"object",properties:[{name:"value",type:0,readonly:true},{name:"next",type:3,readonly:true}]},
  {kind:"object",properties:[{name:"value",type:1,readonly:true},{name:"next",type:4,readonly:true}]},
  {kind:"array",element:2,readonly:false},{kind:"array",element:3,readonly:true},
  {kind:"function",parameters:[2],result:2},{kind:"function",parameters:[3],result:3}
 ];
 const other:Type[]=[{kind:"string"},{kind:"number"}];
 const cache=createManagedTypeContractCache(),independent=createManagedTypeContractCache();
 for(let iteration=0;iteration<64;iteration++){
  const a=cache.get(types),b=cache.get(types),cold=createManagedTypeContractIndex(types);
  if(!a.ok||!b.ok||!cold.ok)return 1;
  if(a.value!==b.value||a.value.sourceTypes!==types)return 2;
  const equal=a.value.matches(7,8),different=a.value.matches(2,4),readonly=a.value.matches(5,6),ignored=a.value.matchesIgnoringReadonly(5,6);
  if(!equal.ok||!equal.value||!different.ok||different.value||!readonly.ok||readonly.value||!ignored.ok||!ignored.value)return 3;
  const reference=cold.value.matches(7,8);if(!reference.ok||reference.value!==equal.value)return 4;
  if(!a.value.assignable(7,8)||a.value.matches(-1,2).ok)return 5;
  const limited=cache.get(types,1);if(!limited.ok||limited.value.matches(7,8).ok)return 6;
  const separate=independent.get(types);if(!separate.ok||separate.value===a.value)return 7;
  const switched=cache.get(other);if(!switched.ok||switched.value.sourceTypes!==other)return 8;
  const miss=switched.value.matches(0,1);if(!miss.ok||miss.value)return 9;
  const returned=cache.get(types);if(!returned.ok||returned.value===a.value)return 10;
 }
 if(cache.get([{kind:"array",element:99,readonly:false}]).ok||cache.get(types,0).ok)return 11;
 return 42;
}`,
  "managed-contract-cache",
  [
    ["contracts", "packages/compiler/src/native/managed-contracts.ts"],
    ["types", "packages/typescript/src/types/index.ts"],
  ],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 16777216,
    allocationCapacity: 262144,
    rootCapacity: 4096,
    stackBytes: 16777216,
  },
);
