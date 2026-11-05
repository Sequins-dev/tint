import { createContext, Script, type Context } from "node:vm";
import type { ExecutionJob, ExecutionOutcome } from "./test262-execution.ts";
/** Script reference adapter; an async completion observer is supplied by the isolated host. */
export function executeNodeScript(
  job: ExecutionJob,
  print?: (value: string) => void,
): ExecutionOutcome {
  if (job.plan.goal !== "script")
    return {
      kind: "unsupported",
      reason: "reference adapter module linking is not implemented",
    };
  if (job.plan.canSuspend === false)
    return {
      kind: "unsupported",
      reason: "reference adapter cannot configure a non-suspending agent",
    };
  if (job.plan.asynchronous && print === undefined)
    return {
      kind: "unsupported",
      reason: "reference adapter asynchronous completion is not implemented",
    };
  let unavailable: string | undefined;
  function error(
    phase: "parse" | "runtime" | "harness",
    value: unknown,
  ): ExecutionOutcome {
    if (unavailable !== undefined)
      return { kind: "unsupported", reason: unavailable };
    if (
      value !== null &&
      typeof value === "object" &&
      "code" in value &&
      value.code === "ERR_SCRIPT_EXECUTION_TIMEOUT"
    )
      return { kind: "timeout" };
    let type = "unknown",
      message = "";
    try {
      type = String(
        (value as { constructor?: { name?: unknown } })?.constructor?.name ??
          "unknown",
      );
      message = String(value);
    } catch {}
    return { kind: "error", phase, type, message };
  }
  function realm(): { context: Context; api: unknown } {
    const context = createContext({}, { microtaskMode: "afterEvaluate" });
    const run = (source: string) =>
      new Script(source).runInContext(context, { timeout: job.timeoutMs });
    const bridge = {
      print(value: string) {
        print?.(value);
      },
      evalScript(source: string) {
        let script: Script;
        try {
          script = new Script(String(source));
        } catch (caught) {
          const Constructor = run("SyntaxError") as new (
            message: string,
          ) => Error;
          throw new Constructor(String(caught));
        }
        return script.runInContext(context, { timeout: job.timeoutMs });
      },
      createRealm() {
        return realm().api;
      },
      detachArrayBuffer(buffer: ArrayBuffer, key: unknown) {
        try {
          if (key !== undefined) throw new TypeError("invalid detach key");
          const length = Object.getOwnPropertyDescriptor(
            ArrayBuffer.prototype,
            "byteLength",
          )!.get!;
          length.call(buffer); // Validate the ArrayBuffer brand across realms.
          const detached = Object.getOwnPropertyDescriptor(
            ArrayBuffer.prototype,
            "detached",
          )?.get;
          if (detached?.call(buffer) !== true)
            structuredClone(buffer, { transfer: [buffer] });
        } catch (caught) {
          const Constructor = run("TypeError") as new (
            message: string,
          ) => Error;
          throw new Constructor(String(caught));
        }
      },
      gc() {
        if (global.gc === undefined) {
          unavailable = "gc host capability unavailable";
          throw new Error(unavailable);
        }
        global.gc();
      },
      unsupported(name: string) {
        unavailable = name;
        throw new Error(name);
      },
    };
    context.__test262Host = bridge;
    run(`((host)=>{
    const api={global:globalThis,evalScript:source=>host.evalScript(source),createRealm:()=>host.createRealm(),detachArrayBuffer:(buffer,key)=>host.detachArrayBuffer(buffer,key),gc:()=>host.gc()};
    Object.defineProperty(api,"agent",{get(){return host.unsupported("agent host capability unavailable");},configurable:true});
    Object.defineProperties(globalThis,{print:{value:function print(value){host.print(String(value));},writable:true,configurable:true},$262:{value:api,writable:true,configurable:true}});
  })(__test262Host);delete globalThis.__test262Host;`);
    return { context, api: run("$262") };
  }
  let script: Script;
  try {
    script = new Script(job.plan.source, { filename: job.filename });
  } catch (caught) {
    return error("parse", caught);
  }
  const target = realm();
  try {
    for (const harness of job.harness)
      new Script(harness.source, { filename: harness.filename }).runInContext(
        target.context,
        { timeout: job.timeoutMs },
      );
  } catch (caught) {
    return error("harness", caught);
  }
  try {
    script.runInContext(target.context, { timeout: job.timeoutMs });
  } catch (caught) {
    return error("runtime", caught);
  }
  return unavailable === undefined
    ? { kind: "completed" }
    : { kind: "unsupported", reason: unavailable };
}
