export const classDecoratorCases = [
  [
    "decorator evaluation and application order precede static and instance initializers",
    `
    function check(v){if(!v)throw new Error("check");}
    var log=[];
    function dec(n){log.push("eval:"+n);return function(v,c){log.push("apply:"+n+":"+c.kind);c.addInitializer(function(){log.push("extra:"+n);});};}
    class B{}
    @dec("class1") @dec("class2") class C extends (log.push("heritage"),B){
      @dec("field") [(log.push("key"),"x")]=(log.push("field"),1);
      @dec("method") m(){}
      @dec("static") static m(){}
      static {(log.push("block"));}
      constructor(){super();log.push("body");}
    }
    new C();
    check(log.join() === "eval:class1,eval:class2,heritage,eval:field,key,eval:method,eval:static,apply:static:method,apply:method:method,apply:field:field,apply:class2:class,apply:class1:class,extra:static,block,extra:class2,extra:class1,extra:method,field,extra:field,body");
  `,
  ],
  [
    "decorators replace methods, getters, setters and initialize fields in composition order",
    `
    function check(v){if(!v)throw new Error("check");}
    function method(v,c){check(c.kind==="method"&&c.name==="m"&&!c.static&&!c.private);return function(){return v.call(this)+1;};}
    function getter(v,c){check(c.kind==="getter");return function(){return v.call(this)+2;};}
    function setter(v,c){check(c.kind==="setter");return function(x){v.call(this,x+3);};}
    function add(n){return function(v,c){check(v===undefined&&c.kind==="field");return function(x){return x+n;};};}
    class C{
      @add(1) @add(10) x=1;
      @method m(){return this.x;}
      @getter get y(){return this.x;}
      @setter set y(v){this.x=v;}
    }
    var c=new C();check(c.x===12&&c.m()===13&&c.y===14);c.y=5;check(c.x===8);
    var d=Object.getOwnPropertyDescriptor(C.prototype,"m");check(!d.enumerable&&d.configurable&&d.writable);
  `,
  ],
  [
    "class replacement updates inner binding and static initialization receiver",
    `
    function check(v){if(!v)throw new Error("check");}
    var original,seen,extra;
    function dec(v,c){original=v;check(c.kind==="class"&&c.name==="C"&&!('static'in c)&&!('private'in c)&&!('access'in c));c.addInitializer(function(){extra=this;});return class Replacement extends v{};}
    @dec class C{static x=this;static y=C;static{seen=this;}value=42;}
    check(C!==original&&C.x===C&&C.y===C&&seen===C&&extra===C&&new C().value===42);
  `,
  ],
  [
    "decorator access objects expose correct public and private operations and brands",
    `
    function check(v){if(!v)throw new Error("check");}
    var field,method,getter,setter,auto,stat;
    function save(v,c){if(c.name==="#x")field=c;else if(c.name==="#m")method=c;else if(c.name==="g")getter=c;else if(c.name==="s")setter=c;else if(c.name==="#a")auto=c;else if(c.name==="z")stat=c;}
    class C{
      @save #x=1; @save #m(){return this.#x;}
      @save get g(){return this.#x;} @save set s(v){this.#x=v;}
      @save accessor #a=2; @save static z=3;
    }
    var c=new C();check(field.private&&!field.static&&field.kind==="field");
    check(field.access.has(c)&&!field.access.has({})&&field.access.get(c)===1);field.access.set(c,7);
    check(method.access.get(c).call(c)===7&&!("set"in method.access));
    check(getter.access.get(c)===7&&!("set"in getter.access));setter.access.set(c,8);check(field.access.get(c)===8&&!("get"in setter.access));
    auto.access.set(c,9);check(auto.kind==="accessor"&&auto.private&&auto.access.get(c)===9);
    check(stat.static&&!stat.private&&stat.access.get(C)===3);
    for(var a of [field.access,method.access,auto.access]){var caught=false;try{a.get({});}catch(e){caught=e instanceof TypeError;}check(caught);}
  `,
  ],
  [
    "auto-accessor replacement composes get, set and init with per-field extra initializers",
    `
    function check(v){if(!v)throw new Error("check");}
    var events=[];
    function dec(v,c){check(c.kind==="accessor");c.addInitializer(function(){events.push(c.access.get(this));});return {get(){return v.get.call(this)+1;},set(x){v.set.call(this,x+2);},init(x){return x+3;}};}
    class C{@dec accessor x=1;after=this.x;}
    var c=new C();check(c.x===5&&c.after===5&&events.join()==="5");c.x=10;check(c.x===13);
    var d=Object.getOwnPropertyDescriptor(C.prototype,"x");check(!d.enumerable&&d.configurable&&!Object.hasOwn(c,"x"));
  `,
  ],
  [
    "addInitializer closes after invocation and invalid replacement values throw",
    `
    function check(v){if(!v)throw new Error("check");}
    var saved;function dec(v,c){saved=c.addInitializer;var bad=false;try{c.addInitializer(1);}catch(e){bad=e instanceof TypeError;}check(bad);}
    @dec class C{}var caught=false;try{saved(()=>{});}catch(e){caught=e instanceof TypeError;}check(caught);
    function bad(){return 1;}
    for(var kind of [0,1,2,3,4,5]){caught=false;try{if(kind===0){@bad class A{}}else if(kind===1){class A{@bad m(){}}}else if(kind===2){class A{@bad x;}}else if(kind===3){class A{@bad accessor x;}}else if(kind===4){class A{@bad get x(){}}}else{class A{@bad set x(v){}}}}catch(e){caught=e instanceof TypeError;}check(caught);}
    for(var key of ["get","set","init"]){caught=false;function badAccess(){return {[key]:1};}try{class A{@badAccess accessor x;}}catch(e){caught=e instanceof TypeError;}check(caught);}
  `,
  ],
  [
    "decorator abrupt completion stops application and static initialization",
    `
    function check(v){if(!v)throw new Error("check");}
    var sentinel={},events=[],saved;
    function fail(v,c){saved=c.addInitializer;events.push("apply");throw sentinel;}
    function later(){events.push("later");}
    var caught;try{class C{@later @fail m(){}static x=events.push("static");}}catch(e){caught=e;}
    check(caught===sentinel&&events.join()==="apply");saved(function(){events.push("aborted-extra");});check(events.join()==="apply");
    events=[];function extra(v,c){c.addInitializer(function(){events.push("extra");throw sentinel;});}
    caught=undefined;try{@extra class D{static x=events.push("static");}}catch(e){caught=e;}check(caught===sentinel&&events.join()==="static,extra");
  `,
  ],
  [
    "decorator contexts are fresh and symbol access observes live public properties",
    `
    function check(v){if(!v)throw new Error("check");}
    var key=Symbol("key"), contexts=[],saved;
    function a(v,c){contexts.push(c);saved=c.access;c.kind="changed";c.access.get=1;}
    function b(v,c){contexts.push(c);check(c.kind==="method"&&c.name===key&&!c.private);}
    class C{@b @a [key](){return 1;}}
    check(contexts[0]!==contexts[1]&&contexts[0].access!==contexts[1].access);
    var c=new C();check(contexts[1].access.has(c)&&contexts[1].access.get(c).call(c)===1);
    c[key]=()=>2;check(contexts[1].access.get(c)()===2);
    for(var operation of [()=>contexts[1].access.has(1),()=>contexts[1].access.get(null)]){var caught=false;try{operation();}catch(e){caught=e instanceof TypeError;}check(caught);}
    `,
  ],
  [
    "decorated private getter and setter replacements share a brand and run extras before fields",
    `
    function check(v){if(!v)throw new Error("check");}
    var getter,setter,log=[];
    function dec(v,c){if(c.kind==="getter"){getter=c;return function(){return v.call(this)+1;};}setter=c;return function(x){v.call(this,x+2);};}
    function method(v,c){c.addInitializer(function(){log.push(c.access.has(this));});}
    class C{@dec get #x(){return this.y;}@dec set #x(v){this.y=v;}@method #m(){}y=(log.push("field"),3);get(){return this.#x;}set(v){this.#x=v;}}
    var c=new C();check(log.join()==="true,field"&&c.get()===4);c.set(5);check(c.get()===8&&getter.access.get(c)===8);setter.access.set(c,8);check(c.get()===11);
    `,
  ],
  [
    "static and instance field extras follow their own initialization and precede the next element",
    `
    function check(v){if(!v)throw new Error("check");}
    var log=[];
    function dec(v,c){c.addInitializer(function(){log.push("extra:"+c.name+":"+c.access.get(this));});return x=>x+1;}
    class C{@dec static a=(log.push("a"),1);static{log.push("block");}@dec static b=(log.push("b"),2);@dec x=(log.push("x"),3);y=log.push("y");}
    new C();check(log.join()==="a,extra:a:2,block,b,extra:b:3,x,extra:x:4,y");
    `,
  ],
  [
    "accessor replacement property reads and validation stop at the first abrupt completion",
    `
    function check(v){if(!v)throw new Error("check");}
    var log=[],sentinel={},caught;
    function dec(){return {get get(){log.push("get");return function(){return 1;};},get set(){log.push("set");throw sentinel;},get init(){log.push("init");}};}
    try{class C{@dec accessor x;static y=log.push("static");}}catch(e){caught=e;}
    check(caught===sentinel&&log.join()==="get,set");
    log=[];function invalid(){return {get get(){log.push("get");return 1;},get set(){log.push("set");}};}
    caught=undefined;try{class C{@invalid accessor x;}}catch(e){caught=e;}check(caught instanceof TypeError&&log.join()==="get");
    `,
  ],
  [
    "decorator evaluation abrupt completion skips computed keys and later decorators",
    `
    function check(v){if(!v)throw new Error("check");}
    var log=[],sentinel={},caught;
    function fail(){log.push("evaluate");throw sentinel;}function later(){log.push("later");}
    try{class C{@(fail()) [(log.push("key"),"x")](){}@later m(){}static x=log.push("static");}}catch(e){caught=e;}
    check(caught===sentinel&&log.join()==="evaluate");
    `,
  ],
] as const;
