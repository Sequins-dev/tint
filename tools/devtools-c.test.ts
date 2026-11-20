import { buildNativeFixture } from "./gate/native-fixture.ts";
// The DevTools bridge on a plain C program built with clang -g: discovery,
// scripts, breakpoints by url, inlined frames, scopes and locals, stepping,
// pause, console output, unsupported methods and process exit, all through
// the CDP calls Chrome DevTools makes (tools/devtools, lldb-dap backend).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { compileC, findLlvmTool } from "./host-tools.ts";
import { findLldbDap } from "./devtools/backend.ts";
import { startDevTools } from "./devtools/cli.ts";
import { CdpTestClient } from "./devtools/test-client.ts";

const source = `#include <stdio.h>
struct point { int x; int y; const char *label; };
static inline __attribute__((always_inline)) int weight(int v) {
  int doubled = v * 2;
  return doubled + 1;
}
int spin(int n) {
  volatile long total = 0;
  for (long i = 0; i < n * 100000L; i++) total += weight((int)i);
  return (int)total;
}
int main(int argc, char **argv) {
  struct point p = { 3, 4, "origin" };
  int rounds = argc > 1 ? 4000 : 3;
  printf("hello %d\\n", p.x);
  fflush(stdout);
  int sum = 0;
  for (int r = 0; r < rounds; r++) sum += spin(10);
  printf("sum %d\\n", sum);
  return p.y;
}
`;
const weightLine = 4; // int doubled = v * 2;  (1-based)
const spinLoopLine = 9;

const clang = findLlvmTool("clang");
const available = clang !== undefined && findLldbDap() !== undefined;

interface Frame {
  callFrameId: string;
  functionName: string;
  location: { scriptId: string; lineNumber: number; columnNumber: number };
  url: string;
  scopeChain: { type: string; name?: string; object: { objectId: string } }[];
}
interface Property {
  name: string;
  value: {
    type: string;
    value?: unknown;
    objectId?: string;
    className?: string;
  };
}

test(
  "DevTools bridge debugs a clang -g C program",
  { skip: !available && "needs clang and lldb-dap", timeout: 180000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "tint-devtools-c-"));
    const file = join(dir, "prog.c"),
      program = join(dir, "prog");
    writeFileSync(file, source);
    buildNativeFixture(program, () => {
      const built = compileC(["-g", "-O0", file, "-o", program]);
      assert.equal(built.status, 0, built.stderr);
      return program;
    });
    const session = await startDevTools({
      program,
      args: ["long"],
      port: 0,
      wait: true,
      log: () => {},
    });
    let client: CdpTestClient | undefined;
    try {
      // Discovery, as chrome://inspect polls it.
      const base = "http://127.0.0.1:" + String(session.server.port);
      const version = (await (await fetch(base + "/json/version")).json()) as {
        "Protocol-Version": string;
      };
      assert.equal(version["Protocol-Version"], "1.3");
      const list = (await (await fetch(base + "/json/list")).json()) as {
        webSocketDebuggerUrl: string;
        type: string;
        devtoolsFrontendUrl: string;
      }[];
      assert.equal(list.length, 1);
      assert.equal(list[0]?.type, "node");
      assert.equal(list[0]?.webSocketDebuggerUrl, session.server.webSocketUrl);
      assert.match(
        session.server.devtoolsUrl,
        /^devtools:\/\/devtools\/bundled\/inspector\.html\?ws=127\.0\.0\.1:\d+\//,
      );
      const protocol = (await (
        await fetch(base + "/json/protocol")
      ).json()) as {
        domains: { domain: string }[];
      };
      assert.ok(
        protocol.domains.some((domain) => domain.domain === "Debugger"),
      );
      const rebound = await new Promise<number>((resolve, reject) => {
        get(
          base + "/json/list",
          { headers: { Host: "evil.example:9229" } },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        ).on("error", reject);
      });
      assert.equal(rebound, 403, "DNS-rebinding hosts are refused");

      client = await CdpTestClient.connect(session.server.webSocketUrl);
      const cdp = client;
      await cdp.send("Runtime.enable");
      await cdp.send("Debugger.enable");
      const url = pathToFileURL(file).href;
      const parsed = await cdp.next(
        "Debugger.scriptParsed",
        (params) => params.url === url,
        10000,
        0,
      );
      const scriptId = String(parsed.params.scriptId);
      assert.equal(parsed.params.endLine, source.split("\n").length);
      const text = await cdp.send<{ scriptSource: string }>(
        "Debugger.getScriptSource",
        { scriptId },
      );
      assert.equal(text.scriptSource, source);

      // Unsupported methods answer promptly with CDP errors.
      await assert.rejects(cdp.send("Network.enable", {}, 5000), {
        code: -32601,
      });
      await assert.rejects(
        cdp.send("Runtime.evaluate", { expression: "1 + 1" }, 5000),
        { code: -32000 },
      );

      const breakpoint = await cdp.send<{
        breakpointId: string;
        locations: { scriptId: string; lineNumber: number }[];
      }>("Debugger.setBreakpointByUrl", { url, lineNumber: weightLine - 1 });
      assert.deepEqual(
        breakpoint.locations.map((location) => [
          location.scriptId,
          location.lineNumber,
        ]),
        [[scriptId, weightLine - 1]],
      );
      const possible = await cdp.send<{ locations: unknown[] }>(
        "Debugger.getPossibleBreakpoints",
        {
          start: { scriptId, lineNumber: spinLoopLine - 1, columnNumber: 0 },
          end: { scriptId, lineNumber: spinLoopLine, columnNumber: 0 },
        },
      );
      assert.ok(possible.locations.length > 0);

      let mark = cdp.events.length;
      await cdp.send("Runtime.runIfWaitingForDebugger");
      const paused = await cdp.next("Debugger.paused", () => true, 60000, mark);
      const frames = paused.params.callFrames as Frame[];
      assert.deepEqual(paused.params.hitBreakpoints, [breakpoint.breakpointId]);
      // The always_inline callee is its own frame above its caller.
      assert.deepEqual(
        frames.slice(0, 3).map((frame) => frame.functionName),
        ["weight", "spin", "main"],
      );
      assert.equal(frames[0]?.location.lineNumber, weightLine - 1);
      assert.equal(frames[1]?.location.lineNumber, spinLoopLine - 1);
      assert.equal(frames[0]?.url, url);
      const local = (frame: Frame | undefined): string => {
        const scope = frame?.scopeChain.find((entry) => entry.type === "local");
        assert.ok(scope !== undefined);
        return scope.object.objectId;
      };
      const props = async (objectId: string): Promise<Property[]> =>
        (
          await cdp.send<{ result: Property[] }>("Runtime.getProperties", {
            objectId,
            ownProperties: true,
            generatePreview: true,
          })
        ).result;
      const spinLocals = await props(local(frames[1]));
      assert.deepEqual(
        spinLocals.find((property) => property.name === "n")?.value,
        { type: "number", value: 10, description: "10" },
      );
      const mainLocals = await props(local(frames[2]));
      const point = mainLocals.find((property) => property.name === "p");
      assert.equal(point?.value.type, "object");
      assert.equal(point?.value.className, "point");
      const fields = await props(point?.value.objectId ?? "");
      assert.deepEqual(
        fields.map((field) => [field.name, field.value.value]),
        [
          ["x", 3],
          ["y", 4],
          ["label", "origin"],
        ],
      );
      // Hover-style evaluation of a variable path (no code runs).
      const hovered = await cdp.send<{ result: { value: unknown } }>(
        "Debugger.evaluateOnCallFrame",
        { callFrameId: frames[2]?.callFrameId, expression: "p.label" },
      );
      assert.equal(hovered.result.value, "origin");
      await assert.rejects(
        cdp.send("Debugger.evaluateOnCallFrame", {
          callFrameId: frames[2]?.callFrameId,
          expression: "p.x + 1",
        }),
        { code: -32000 },
      );

      // Step over within weight, then out to spin.
      mark = cdp.events.length;
      await cdp.send("Debugger.stepOver");
      await cdp.next("Debugger.resumed", () => true, 10000, mark);
      const stepped = await cdp.next(
        "Debugger.paused",
        () => true,
        30000,
        mark,
      );
      const steppedFrames = stepped.params.callFrames as Frame[];
      assert.equal(steppedFrames[0]?.functionName, "weight");
      assert.equal(steppedFrames[0]?.location.lineNumber, weightLine);
      // Old object ids die with the pause.
      await assert.rejects(props(local(frames[1])), /resumed/);
      await cdp.send("Debugger.removeBreakpoint", {
        breakpointId: breakpoint.breakpointId,
      });
      mark = cdp.events.length;
      await cdp.send("Debugger.stepOut");
      const out = await cdp.next("Debugger.paused", () => true, 30000, mark);
      assert.equal((out.params.callFrames as Frame[])[0]?.functionName, "spin");

      // Resume, then pause the running loop.
      mark = cdp.events.length;
      await cdp.send("Debugger.resume");
      await cdp.next("Debugger.resumed", () => true, 10000, mark);
      await new Promise((resolve) => setTimeout(resolve, 200));
      mark = cdp.events.length;
      await cdp.send("Debugger.pause");
      const interrupted = await cdp.next(
        "Debugger.paused",
        () => true,
        30000,
        mark,
      );
      assert.equal(interrupted.params.reason, "other");
      assert.ok(
        (interrupted.params.callFrames as Frame[]).some(
          (frame) => frame.functionName === "main",
        ),
      );

      // The program's output arrives as console messages.
      const hello = await cdp.next(
        "Runtime.consoleAPICalled",
        (params) =>
          (params.args as { value: string }[])[0]?.value === "hello 3",
        10000,
        0,
      );
      assert.equal(hello.params.type, "log");

      // Run to completion: exit status 4 (p.y) and a destroyed context.
      mark = cdp.events.length;
      await cdp.send("Debugger.resume");
      await cdp.next(
        "Runtime.executionContextDestroyed",
        () => true,
        120000,
        mark,
      );
      assert.equal(session.bridge.exitStatus(), 4);
      await cdp.next(
        "Runtime.consoleAPICalled",
        (params) =>
          /^Process exited with status 4$/.test(
            (params.args as { value: string }[])[0]?.value ?? "",
          ),
        10000,
        mark,
      );
      await assert.rejects(cdp.send("Debugger.pause", {}, 5000), /exited/);
    } finally {
      client?.close();
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
