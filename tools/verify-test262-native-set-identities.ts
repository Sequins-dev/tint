import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `for(let left=0;left<8;left++)for(let right=0;right<8;right++){
    const a=[0,1,2].filter(v=>left&(1<<v)),b=[2,1,0].filter(v=>right&(1<<v));
    const first=new Set(a),second=new Set(b),order=a.length<=b.length?a:b;
    const expected={union:[...a,...b.filter(v=>!a.includes(v))],symmetricDifference:[...a.filter(v=>!b.includes(v)),...b.filter(v=>!a.includes(v))],difference:a.filter(v=>!b.includes(v)),intersection:order.filter(v=>a.includes(v)&&b.includes(v))};
    for(const name of Object.keys(expected))if(first[name](second).values().toArray().join()!==expected[name].join())throw name;
    if(first.isSubsetOf(second)!==a.every(v=>b.includes(v))||first.isSupersetOf(second)!==b.every(v=>a.includes(v))||first.isDisjointFrom(second)!==a.every(v=>!b.includes(v)))throw 1;
    if(first.values().toArray().join()!==a.join()||second.values().toArray().join()!==b.join())throw 2;
  }`,
]);
