import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function measure(program: string): { graphs: number; types: number } {
  const loader = `import {registerHooks} from 'node:module';
    globalThis.validationWork={attached:0,graphs:0,types:0};
    registerHooks({load(url,context,next){const result=next(url,context);
      if(url.endsWith('/typescript/dist/types/index.js')) { globalThis.validationWork.attached++; result.source=String(result.source).replace(
        'export function createTypeSystem(input) {',
        'export function createTypeSystem(input) { globalThis.validationWork.graphs++; globalThis.validationWork.types+=input.length;');
      } return result;}});`;
  const source = `import assert from 'node:assert/strict';
    import {workspaceModules} from './tools/workspace-sources.ts';
    import {projectRoots,projectBuildRequest} from '@tint/compiler/cli';
    import {createSourceText} from '@tint/source/text';
    import {parseModule} from '@tint/typescript/syntax';
    import {buildMacOSProgram} from '@tint/compiler/build';
    const bytes=new TextEncoder().encode(${JSON.stringify(program)});
    const text=createSourceText(bytes,bytes.length);assert.ok(text.ok);
    const parsed=parseModule(text.value);assert.ok(parsed.ok);
    const modules=[...workspaceModules(projectRoots()),{id:'fixture',module:parsed.value,dependencies:new Map()}];
    const built=buildMacOSProgram({...projectBuildRequest(modules,()=>{}),entry:'fixture',start:'run'});
    assert.ok(built.ok,JSON.stringify(built));console.log(JSON.stringify(globalThis.validationWork));`;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(loader)}`,
      "--input-type=module",
      "--eval",
      source,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const work = JSON.parse(result.stdout);
  assert.ok(
    work.attached > 0,
    "instrumentation must attach to the compiled public types entry",
  );
  assert.ok(
    work.graphs > 0 && work.types > 0,
    "instrumentation must observe graph validation",
  );
  return work;
}
test("runtime helper validation shares a type graph across collection specializations", () => {
  const baseline = measure(
    'export function run():number{const a:string[]=["a"];return a.length;}',
  );
  const expanded = measure(
    'export function run():number{const a:string[]=["a"];const b:number[]=[1];const c:({x:number}|undefined)[]=[{x:1}];return a.length+b.length+c.length;}',
  );
  assert.ok(
    expanded.graphs <= baseline.graphs + 1,
    JSON.stringify({ baseline, expanded }),
  );
});
