import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// Node has no $262 host, and V8 omits the HasProperty steps of with-statement
// GetBindingValue/SetMutableBinding that ECMA-262 9.1.1.2 and Test262 require.
verifyNativeScriptCases(
  [
    // built-ins/Proxy/has/trap-is-missing-target-is-proxy.js
    `var regExpProxy=new Proxy(new Proxy(/(?:)/m,{}),{});if(!Reflect.has(regExpProxy,'ignoreCase')||!(Symbol.replace in regExpProxy)||!('lastIndex' in Object.create(regExpProxy)))throw 1;var functionProxy=new Proxy(new Proxy(function(){},{}),{});if(!('name' in functionProxy)||!('length' in Object.create(functionProxy))||('missing' in Object.create(functionProxy)))throw 2;`,
    // built-ins/Proxy/ownKeys/extensible-return-trap-result.js and property-order.js
    `var target={};Object.defineProperty(target,'foo',{configurable:false,enumerable:true,value:true});var keys=Object.getOwnPropertyNames(new Proxy(target,{ownKeys(){return ['foo','bar'];}}));if(keys.length!==2||keys[0]!=='foo'||keys[1]!=='bar')throw 1;var names=Object.getOwnPropertyNames(Proxy);var length=names.indexOf('length');if(length<0||names.indexOf('name')!==length+1)throw 2;`,
    // built-ins/Proxy/get-fn-realm{,-recursive}.js without dynamic Function construction.
    `const r1=$262.createRealm().global,r2=$262.createRealm().global,r3=$262.createRealm().global;const bound=r1.Object.bind(null);if(Object.getPrototypeOf(Reflect.construct(r3.Array,[],new r2.Proxy(bound,{})))!==r1.Array.prototype)throw 1;let traps=0;const counting={getPrototypeOf(){traps++;return null;},getOwnPropertyDescriptor(){traps++;}};const nested=new r2.Proxy(new r3.Proxy(bound,counting),{});const array=Reflect.construct(r3.Array,[],nested);if(Object.getPrototypeOf(array)!==r1.Array.prototype||!(array instanceof r1.Array)||traps!==0)throw 2;`,
    // built-ins/Proxy/{apply,construct}/arguments-realm.js without cross-realm eval.
    `const other=$262.createRealm().global;const f=new other.Proxy(function(){},{apply:other.Array.of,construct:other.Array.of});const called=f(1,2);if(Object.getPrototypeOf(called)!==other.Array.prototype||called[2].constructor!==Array||called[2].length!==2)throw 1;const made=new f(3);if(made[1].constructor!==Array||made[1][0]!==3||made[2]!==f)throw 2;`,
    // built-ins/Proxy/construct/trap-is-undefined-proto-from-{newtarget-realm,cross-realm-newtarget}.js
    `const other=$262.createRealm().global;const C=other.Object.bind(null);const P=new Proxy(function(){},{});if(Object.getPrototypeOf(Reflect.construct(P,[],C))!==other.Object.prototype)throw 1;if(Object.getPrototypeOf(Reflect.construct(P,[],new other.Proxy(C,{})))!==other.Object.prototype)throw 4;class B{}const Q=new Proxy(B,{});const b=Reflect.construct(Q,[],C);if(Object.getPrototypeOf(b)!==other.Object.prototype)throw 2;const D=new other.Proxy(B,{});if(Object.getPrototypeOf(new D())!==B.prototype)throw 3;`,
    // Revoked proxies: internal-method errors use the active realm.
    `const other=$262.createRealm().global;const r=other.Proxy.revocable({},{});r.revoke();let step=0;try{r.proxy.x;}catch(e){if(e.constructor===TypeError)step++;}try{other.Reflect.get(r.proxy,'x');}catch(e){if(e.constructor===other.TypeError)step++;}const s=Proxy.revocable(function(){},{});s.revoke();try{Reflect.construct(Array,[],s.proxy);}catch(e){if(e.constructor===TypeError)step++;}try{new other.Proxy(s.proxy,{});step++;}catch(e){}if(step!==4)throw step;`,
    // language/statements/with/set-mutable-binding-idref-compound-assign-with-proxy-env.js
    `var log=[];var env={p:0};var proxy=new Proxy(env,{has(t,k){log.push('has:'+String(k));return Reflect.has(t,k);},get(t,k,r){log.push('get:'+String(k));return Reflect.get(t,k,r);},set(t,k,v,r){log.push('set:'+String(k));return Reflect.set(t,k,v,r);},getOwnPropertyDescriptor(t,k){log.push('getOwnPropertyDescriptor:'+String(k));return Reflect.getOwnPropertyDescriptor(t,k);},defineProperty(t,k,d){log.push('defineProperty:'+String(k));return Reflect.defineProperty(t,k,d);}});with(proxy){p+=1;}if(log.join()!=='has:p,get:Symbol(Symbol.unscopables),has:p,get:p,has:p,set:p,getOwnPropertyDescriptor:p,defineProperty:p'||env.p!==1)throw log.join();`,
    // Derived classes construct through a Proxy superclass with the derived newTarget.
    `let seen;const Base=new Proxy(class{constructor(x){this.x=x;}},{construct(t,a,n){seen=n;return Reflect.construct(t,a,n);}});class D extends Base{constructor(){super(5);}}const d=new D();if(seen!==D||Object.getPrototypeOf(d)!==D.prototype||d.x!==5)throw 1;const r=Proxy.revocable(class{},{});class E extends r.proxy{}r.revoke();try{new E();throw 2;}catch(e){if(!(e instanceof TypeError))throw 3;}`,
  ],
  { nodeReference: false },
);
