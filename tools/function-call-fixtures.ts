export const functionCallFixtures = [
  {
    name: "object",
    bytes: 80,
    source: `function run(n:number):number {
      function add(this:{value:number},x:number):number{return this.value+x;}
      return add.call({value:19},23);
    }`,
  },
  {
    name: "number",
    bytes: 48,
    source: `function run(n:number):number {
      function add(this:number,x:number):number{return this+x;}
      return add.call(19,23);
    }`,
  },
  {
    name: "undefined",
    bytes: 48,
    source: `function run(n:number):number {
      function check(this:undefined):number{return this===undefined?42:0;}
      return check.call();
    }`,
  },
  {
    name: "evaluation-order",
    bytes: 128,
    source: `function run(n:number):number {
      let add=function(this:{value:number},x:number):number{return this.value+x;};
      const other=function(this:{value:number},x:number):number{return 0;};
      return add.call((add=other,{value:19}),23);
    }`,
  },
  {
    name: "lexical",
    bytes: 224,
    source: `function run(n:number):number {
      const owner={value:19,make:function(this:{value:number}):(x:number)=>number{return (x:number):number=>this.value+x;}};
      const arrow=owner.make();
      return arrow.call({value:0},23);
    }`,
  },
  {
    name: "optional-present",
    bytes: 48,
    source: `function run(n:number):number {
      const add:((this:number,x:number)=>number)|undefined=function(this:number,x:number):number{return this+x;};
      return add?.call(19,23)??0;
    }`,
  },
  {
    name: "optional-absent",
    bytes: 32,
    source: `function run(n:number):number {
      const data={value:42};
      const add:((this:number,x:number)=>number)|undefined=undefined;
      let effects=0;
      const result=add?.call(++effects,++effects);
      return result??data.value+effects;
    }`,
  },
] as const;
