/** Await Dictionary proposal, https://tc39.es/proposal-await-dictionary/.
 * Bespoke semantic regressions shared with native fixtures, not Test262 results. */
const check = `function check(a,b){if(a!==b)throw new Error(String(a)+" !== "+String(b));}`;
export const promiseKeyedCases: readonly { name: string; source: string }[] = [
  {
    name: "static method descriptors",
    source: `
for(var n of ['allKeyed','allSettledKeyed']){var d=Object.getOwnPropertyDescriptor(Promise,n);check(d.writable,true);check(d.enumerable,false);check(d.configurable,true);check(d.value.length,1);check(d.value.name,n);check(Object.getPrototypeOf(d.value),Function.prototype);check(d.value.hasOwnProperty('prototype'),false);}
$DONE();`,
  },
  {
    name: "null prototype, symbols and safe proto key",
    source: `
var s=Symbol();var input={a:Promise.resolve(3),[s]:4};Object.defineProperty(input,'__proto__',{value:5,enumerable:true});
Promise.allKeyed(input).then(function(o){check(Object.getPrototypeOf(o),null);check(o.a,3);check(o[s],4);check(o.__proto__,5);check(Reflect.ownKeys(o).length,3);var d=Object.getOwnPropertyDescriptor(o,'a');check(d.writable&&d.enumerable&&d.configurable,true);$DONE();},$DONE);`,
  },
  {
    name: "settled records and opposite callbacks share guard",
    source: `
var result;function C(e){e(function(v){result=v},function(e){throw e})}C.resolve=function(v){return {then:function(f,r){r(v);f(99);r(100)}}};
Promise.allSettledKeyed.call(C,{x:7,y:8});check(Object.getPrototypeOf(result),null);check(result.x.status,'rejected');check(result.x.reason,7);check(result.y.reason,8);check(Object.getPrototypeOf(result.x),Object.prototype);check(Object.keys(result.x).join(),'status,reason');$DONE();`,
  },
  {
    name: "snapshot keys but recheck descriptors before values",
    source: `
var log=[];var target={a:1,b:2,c:3};var input=new Proxy(target,{ownKeys:function(t){log.push('keys');return ['a','b','c'];},getOwnPropertyDescriptor:function(t,k){log.push('desc:'+k);return Reflect.getOwnPropertyDescriptor(t,k);},get:function(t,k){log.push('get:'+k);delete t.b;Object.defineProperty(t,'c',{enumerable:false});t.d=4;return t[k];}});
Promise.allKeyed(input).then(function(o){check(log.join(),'keys,desc:a,get:a,desc:b,desc:c');check(Object.keys(o).join(),'a');check(o.a,1);$DONE();},$DONE);`,
  },
  {
    name: "get resolve once before own keys and validate input",
    source: `
for(var n of ['allKeyed','allSettledKeyed']){var log=[];function C(e){log.push('construct');e(function(){log.push('done')},function(){log.push('reject')})}Object.defineProperty(C,'resolve',{get:function(){log.push('resolve');return function(v){log.push('call');return {then:function(f){f(v)}}}}});var o=new Proxy({x:1},{ownKeys:function(t){log.push('keys');return ['x']}});Promise[n].call(C,o);check(log.join(),'construct,resolve,keys,call,done');log=[];Promise[n].call(C,1);check(log.join(),'construct,resolve,reject');}
$DONE();`,
  },
  {
    name: "empty inputs skip inherited and non-enumerable getters",
    source: `
var a=Object.create({get bad(){throw 1}});Object.defineProperty(a,'x',{get:function(){throw 9}});Promise.allKeyed(a).then(function(o){check(Object.getPrototypeOf(o),null);check(Reflect.ownKeys(o).length,0);return Promise.allSettledKeyed({})}).then(function(o){check(Object.getPrototypeOf(o),null);check(Reflect.ownKeys(o).length,0);$DONE();},$DONE);`,
  },
  {
    name: "synchronous callbacks cannot complete before enumeration ends",
    source: `
var log=[],result,first;function C(e){e(function(o){log.push('done');result=o},function(e){throw e})}C.resolve=function(v){return v};Promise.allKeyed.call(C,{a:{then:function(f){first=f}},b:{then:function(f){first(1);first(99);f(2);log.push('b')}},c:{then:function(f){f(3);log.push('c')}}});check(log.join(),'b,c,done');check(Object.keys(result).join(),'a,b,c');check(result.a,1);check(result.b,2);check(result.c,3);$DONE();`,
  },
  {
    name: "callbacks return custom resolve value and ignore repeats",
    source: `
for(var n of ['allKeyed','allSettledKeyed']){var callback;function C(e){e(function(){return 42},function(e){throw e})}C.resolve=function(v){return {then:function(f){callback=f}}};Promise[n].call(C,{a:1});check(callback(7),42);check(callback(8),undefined);check(callback.length,1);check(callback.name,'');}
$DONE();`,
  },
  {
    name: "resolve throw at loop exit rejects capability",
    source: `
for(var n of ['allKeyed','allSettledKeyed']){var reason;function C(e){e(function(){throw 17},function(e){reason=e})}C.resolve=function(v){return {then:function(f){f(v)}}};Promise[n].call(C,{a:1});check(reason,17);}
$DONE();`,
  },
  {
    name: "abrupt own keys descriptor value resolve and then reject",
    source: `
for(var n of ['allKeyed','allSettledKeyed']){var reasons=[];function C(e){e(function(){throw 'unexpected'},function(e){reasons.push(e)})}C.resolve=function(v){return v};var inputs=[new Proxy({},{ownKeys:function(){throw 1}}),new Proxy({x:1},{getOwnPropertyDescriptor:function(){throw 2}}),{get x(){throw 3}},{x:{get then(){throw 4}}},{x:{then:function(){throw 5}}},{x:{then:1}}];for(var input of inputs)Promise[n].call(C,input);check(reasons.slice(0,5).join(),'1,2,3,4,5');check(reasons[5] instanceof TypeError,true);}
$DONE();`,
  },
  {
    name: "ordinary promises settle in input order",
    source: `
var resolve;var slow=new Promise(function(r){resolve=r});Promise.allSettledKeyed({a:slow,b:Promise.reject(8),c:3}).then(function(o){check(Object.keys(o).join(),'a,b,c');check(o.a.value,7);check(o.b.reason,8);check(o.c.status,'fulfilled');$DONE();},$DONE);resolve(7);`,
  },
  {
    name: "invalid constructors throw before reading resolve",
    source: `
for(var n of ['allKeyed','allSettledKeyed']){check(typeof Promise[n],'function');for(var c of [undefined,null,1,{},()=>{}]){var thrown=false;try{Promise[n].call(c,{})}catch(e){check(e instanceof TypeError,true);thrown=true}check(thrown,true)}}$DONE();`,
  },
].map((c) => ({ name: c.name, source: check + c.source }));
