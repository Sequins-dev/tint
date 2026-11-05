export const managedJitFixtureText = `interface Box{readonly n:number;}interface Tag{readonly m:number;}
type Left=(v:Box)=>number;type Right=(v:Tag)=>number;type Inc=(v:number)=>number;type Wide=(v:number)=>number|undefined;
interface Frame{readonly $imports:unknown;readonly $argument0:number;}
function apply(f:Inc,v:number):number{return f(v);}function useLeft(f:Left):number{return 0;}function useRight(f:Right):number{return 0;}
function keep(v:unknown):number{return 0;}function box(n:number):Box{return {n};}function tag(m:number):Tag{return {m};}
function getInc():Inc{return (v:number):number=>v;}function getWide():Wide{return (v:number):number|undefined=>v;}`;
export const managedJitFixtureValues = [
  "apply",
  "useLeft",
  "useRight",
  "keep",
  "box",
  "tag",
  "getInc",
  "getWide",
] as const;
export const managedJitFixtureTypes = [
  "Frame",
  "Box",
  "Tag",
  "Left",
  "Right",
  "Inc",
  "Wide",
] as const;
