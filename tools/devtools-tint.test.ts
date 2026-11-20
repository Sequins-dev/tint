// The DevTools bridge on a Tint debug build (tools/devtools-fixture.ts),
// through the CDP calls Chrome DevTools makes. The core alone: breakpoints
// by file and line, inlined frames as separate call frames, scopes with
// locals, stepping and pausing the running program.
import assert from "node:assert/strict";
import { testNativeLaunch } from "./gate/native-launch-test.ts";
import { findLldbDap } from "./devtools/backend.ts";
import {
  fixtureLines,
  localScope,
  properties,
  tintSession,
  type Frame,
} from "./devtools-fixture.ts";

const available = findLldbDap() !== undefined;

testNativeLaunch(
  "DevTools bridge debugs a Tint debug build (core only)",
  { skip: !available && "needs lldb-dap", timeout: 300000 },
  async (onAdmitted) => {
    const { client, url, close } = await tintSession(
      "devtools-core",
      [],
      onAdmitted,
    );
    try {
      const parsed = await client.next(
        "Debugger.scriptParsed",
        (params) => params.url === url,
        10000,
        0,
      );
      const scriptId = String(parsed.params.scriptId);
      // Runtime sources resolve against the checkout.
      await client.next(
        "Debugger.scriptParsed",
        (params) =>
          String(params.url).endsWith(
            "packages/native-runtime/src/generational.ts",
          ),
        10000,
        0,
      );
      const breakpoint = await client.send<{
        breakpointId: string;
        locations: { lineNumber: number }[];
      }>("Debugger.setBreakpointByUrl", {
        url,
        lineNumber: fixtureLines.weight - 1,
      });
      assert.ok(breakpoint.locations.length >= 1);
      let mark = client.events.length;
      await client.send("Runtime.runIfWaitingForDebugger");
      const paused = await client.next(
        "Debugger.paused",
        () => true,
        60000,
        mark,
      );
      const frames = paused.params.callFrames as Frame[];
      // weight is inlined into scale, and scale into run: separate call
      // frames, callee first. (The compiler folds weight's first line into
      // its return, where the breakpoint resolves.)
      const resolved = breakpoint.locations[0]?.lineNumber ?? -1;
      assert.ok(
        resolved === fixtureLines.weight - 1 ||
          resolved === fixtureLines.weight,
      );
      assert.match(frames[0]?.functionName ?? "", /weight/);
      assert.equal(frames[0]?.location.lineNumber, resolved);
      assert.equal(frames[0]?.location.scriptId, scriptId);
      assert.match(frames[1]?.functionName ?? "", /scale/);
      assert.ok(
        [fixtureLines.scale - 1, fixtureLines.scale].includes(
          frames[1]?.location.lineNumber ?? -1,
        ),
      );
      assert.match(frames[2]?.functionName ?? "", /:run\b/);
      const weightLocals = await properties(client, localScope(frames[0]));
      assert.ok(
        weightLocals.some((property) => property.name === "value"),
        JSON.stringify(weightLocals),
      );
      const scaleLocals = await properties(client, localScope(frames[1]));
      const factor = scaleLocals.find((property) => property.name === "factor");
      assert.deepEqual(factor?.value, {
        type: "number",
        value: 2,
        description: "2",
      });
      // Step over weight's return: execution continues in scale.
      mark = client.events.length;
      await client.send("Debugger.stepOver");
      const stepped = await client.next(
        "Debugger.paused",
        () => true,
        30000,
        mark,
      );
      const top = (stepped.params.callFrames as Frame[])[0];
      assert.ok(
        top?.functionName !== frames[0]?.functionName ||
          top?.location.lineNumber !== frames[0]?.location.lineNumber,
        "stepping moved",
      );
      // Pause the allocation-heavy tail while it runs.
      await client.send("Debugger.removeBreakpoint", {
        breakpointId: breakpoint.breakpointId,
      });
      mark = client.events.length;
      await client.send("Debugger.resume");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await client.send("Debugger.pause");
      const interrupted = await client.next(
        "Debugger.paused",
        () => true,
        30000,
        mark,
      );
      assert.ok(
        (interrupted.params.callFrames as Frame[]).some((frame) =>
          /makeChain|churn/.test(frame.functionName),
        ),
      );
      mark = client.events.length;
      await client.send("Debugger.resume");
      await client.next(
        "Runtime.executionContextDestroyed",
        () => true,
        120000,
        mark,
      );
      await client.next(
        "Runtime.consoleAPICalled",
        (params) =>
          (params.args as { value: string }[])[0]?.value ===
          "Process exited with status 42",
        10000,
        mark,
      );
    } finally {
      await close();
    }
  },
);
