import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants, homedir, version } from "node:os";
import { join, resolve } from "node:path";
import type { NativeTarget } from "@tint/platform/target";
import { runNativeFixture } from "./gate/native-fixture.ts";
import { admitUnderLldb } from "./native-admission.ts";

type TargetName = NativeTarget["name"] | "linux-x86_64";
export type NativeRunnerName =
  "darwin-local" | "linux-dev" | "x64-local" | "x64-qemu-dev" | "x64-ssh";

interface NativeArtifact {
  readonly target: TargetName;
  readonly path: string;
  readonly imageSha256: string;
  readonly buildManifest?: { readonly path: string; readonly sha256: string };
}

interface NativeInvocation {
  readonly artifact: NativeArtifact;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
}

interface Executor {
  readonly runner: NativeRunnerName;
  readonly identity: string;
  readonly sysrootSha256?: string;
}

interface RunOutput {
  readonly stdout: string;
  readonly stderr: string;
}

type Outcome =
  | { readonly kind: "exited"; readonly status: number }
  | { readonly kind: "signaled"; readonly signal: string }
  | { readonly kind: "timed-out" }
  | {
      readonly kind: "execution-unavailable" | "runner-error";
      readonly reason: string;
    };

type Observation = Outcome & RunOutput;
export type NativeResult = Observation & {
  readonly artifact: NativeArtifact;
  readonly executor?: Executor;
};

const runners: Readonly<Record<NativeRunnerName, TargetName>> = {
  "darwin-local": "darwin-aarch64",
  "linux-dev": "linux-aarch64",
  "x64-local": "linux-x86_64",
  "x64-qemu-dev": "linux-x86_64",
  "x64-ssh": "linux-x86_64",
};

function imageHash(path: string, target?: TargetName): string {
  const fd = openSync(path, "r");
  try {
    const hash = createHash("sha256");
    const bytes = Buffer.allocUnsafe(1024 * 1024);
    let length = readSync(fd, bytes);
    if (target !== undefined) {
      const matches =
        length >= 20 &&
        (target === "darwin-aarch64"
          ? bytes.readUInt32LE(0) === 0xfeedfacf &&
            bytes.readUInt32LE(4) === 0x0100000c &&
            bytes.readUInt32LE(12) === 2
          : bytes.readUInt32BE(0) === 0x7f454c46 &&
            bytes[4] === 2 &&
            bytes[5] === 1 &&
            (bytes.readUInt16LE(16) === 2 || bytes.readUInt16LE(16) === 3) &&
            bytes.readUInt16LE(18) === (target === "linux-x86_64" ? 62 : 183));
      if (!matches) throw Error(`artifact does not match ${target}: ${path}`);
    }
    while (length !== 0) {
      hash.update(bytes.subarray(0, length));
      length = readSync(fd, bytes);
    }
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

export function nativeArtifact(
  target: TargetName,
  path: string,
  buildManifestPath?: string,
): NativeArtifact {
  path = resolve(path);
  const imageSha256 = imageHash(path, target);
  if (buildManifestPath === undefined) return { target, path, imageSha256 };
  const manifest = readFileSync(buildManifestPath);
  const parsed = JSON.parse(manifest.toString());
  if (parsed.imageSha256 !== imageSha256 || parsed.target !== target)
    throw Error(`build manifest does not match artifact ${path}`);
  return {
    target,
    path,
    imageSha256,
    buildManifest: {
      path: resolve(buildManifestPath),
      sha256: createHash("sha256").update(manifest).digest("hex"),
    },
  };
}

function failure(
  kind: "execution-unavailable" | "runner-error",
  reason: string,
): Observation {
  return { kind, reason, stdout: "", stderr: "" };
}

function localDarwinRun(
  invocation: NativeInvocation,
  env: NodeJS.ProcessEnv,
): Observation {
  const marker = "TINT_NATIVE_" + randomUUID();
  const result = spawnSync(
    "lldb",
    [
      "--no-lldbinit",
      "--batch",
      "-o",
      "settings set target.disable-aslr false",
      "-o",
      "process launch --stop-at-entry",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateStopped",
      "-o",
      "continue",
      "-o",
      `script p = lldb.process; t = p.GetSelectedThread(); print('${marker} EXIT', p.GetExitStatus()) if p.GetState() == lldb.eStateExited else print('${marker} SIGNAL', t.GetStopReasonDataAtIndex(0)) if t.GetStopReason() == lldb.eStopReasonSignal else None`,
      "--",
      invocation.artifact.path,
      ...(invocation.args ?? []),
    ],
    { env, encoding: "utf8", timeout: invocation.timeoutMs ?? 60000 },
  );
  const streams = { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT")
    return {
      ...streams,
      kind: "execution-unavailable",
      reason: "darwin-local: lldb is missing",
    };
  if (code === "ETIMEDOUT") return { ...streams, kind: "timed-out" };
  const exit = new RegExp(`^${marker} EXIT (\\d+)$`, "m").exec(streams.stdout);
  if (result.status === 0 && exit?.[1] !== undefined)
    return { ...streams, kind: "exited", status: Number(exit[1]) };
  const signal = new RegExp(`^${marker} SIGNAL (\\d+)$`, "m").exec(
    streams.stdout,
  );
  const signalName = Object.entries(constants.signals).find(
    ([, number]) => number === Number(signal?.[1]),
  )?.[0];
  if (signalName !== undefined)
    return { ...streams, kind: "signaled", signal: signalName };
  return {
    ...streams,
    kind: "runner-error",
    reason:
      "darwin-local: LLDB did not report an inferior exit or signal: " +
      (result.error?.message ?? result.signal ?? result.status),
  };
}

function quote(argument: string): string {
  return "'" + argument.replaceAll("'", "'\\''") + "'";
}

const batchScript = new URL("./native-target-runner.sh", import.meta.url);
const sysrootManifest = new URL("./x64-sysroot.sha256", import.meta.url);

export function x64SshArguments(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=2",
    "-i",
    env.TINT_X64_SSH_KEY ?? join(homedir(), ".t3/vms/tint-vm-key"),
    "-p",
    env.TINT_X64_SSH_PORT ?? "2223",
    "--",
    env.TINT_X64_SSH_HOST ?? "tint@127.0.0.1",
  ];
}

function linuxBatch(
  runner: Exclude<NativeRunnerName, "darwin-local">,
  invocations: readonly NativeInvocation[],
  env: NodeJS.ProcessEnv,
): { observations: Observation[]; executor?: Executor } {
  const local =
    (runner === "linux-dev" && process.platform === "linux") ||
    runner === "x64-local";
  const ssh = runner === "x64-ssh";
  // The host home is mounted in dev. Stage each image once under a simple
  // basename so container machine's argument re-splitting cannot affect it.
  const scratch = join(homedir(), ".t3");
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, "tint-native-batch-"));
  try {
    copyFileSync(batchScript, join(directory, "run.sh"));
    const images = new Map<string, string>();
    const commands = invocations.map(({ artifact, args, timeoutMs }, index) => {
      let image = images.get(artifact.path);
      if (image === undefined) {
        image = `image-${images.size}`;
        images.set(artifact.path, image);
        copyFileSync(artifact.path, join(directory, image));
      }
      return [
        "run",
        String(index),
        String((timeoutMs ?? 60000) / 1000),
        image,
        ...(args ?? []).map(quote),
      ].join(" ");
    });
    writeFileSync(join(directory, "jobs"), commands.join("\n") + "\n");
    writeFileSync(
      join(directory, "images.sha256"),
      [
        ...new Set(
          invocations.map(
            ({ artifact }) =>
              artifact.imageSha256 + "  " + images.get(artifact.path),
          ),
        ),
      ].join("\n") + "\n",
    );
    const setup = [`mode=${quote(runner)}`];
    if (!ssh) setup.push(`inferior_cwd=${quote(process.cwd())}`);
    if (runner === "linux-dev" && env.TINT_LINUX_DEBUGGER_LAUNCH === "lldb")
      setup.push("debugger=lldb");
    if (env.TZ !== undefined) setup.push(`export TZ=${quote(env.TZ)}`);
    let sysrootSha256: string | undefined;
    if (runner === "x64-qemu-dev") {
      const manifest = readFileSync(sysrootManifest);
      sysrootSha256 = createHash("sha256").update(manifest).digest("hex");
      writeFileSync(join(directory, "sysroot.sha256"), manifest);
      setup.push(
        `sysroot=${quote(join(scratch, "tint-x64-sysroot"))}`,
        `qemu=${quote(env.TINT_X64_QEMU ?? join(scratch, "tint-x64-qemu/qemu-x86_64-static"))}`,
      );
    }
    writeFileSync(join(directory, "setup"), setup.join("\n") + "\n");
    const options = {
      encoding: "utf8" as const,
      env,
      timeout: invocations.reduce(
        (sum, job) => sum + (job.timeoutMs ?? 60000) + 1000,
        30000,
      ),
      maxBuffer: 32 * 1024 * 1024,
    };
    const host = env.TINT_X64_SSH_HOST ?? "tint@127.0.0.1";
    let result;
    if (ssh) {
      const archive = join(directory, "batch.tar");
      const tar = spawnSync(
        "tar",
        [
          "-cf",
          archive,
          "-C",
          directory,
          "run.sh",
          "jobs",
          "images.sha256",
          "setup",
          ...images.values(),
        ],
        options,
      );
      if (tar.status !== 0)
        throw Error(
          "cannot stage native batch: " + (tar.error?.message ?? tar.stderr),
        );
      const fd = openSync(archive, "r");
      try {
        result = spawnSync(
          "ssh",
          [
            ...x64SshArguments(env),
            'set -eu; d=$(mktemp -d); trap \'rm -rf "$d"\' EXIT; cd "$d"; tar -xf -; sh run.sh',
          ],
          { ...options, stdio: [fd, "pipe", "pipe"] },
        );
      } finally {
        closeSync(fd);
      }
    } else {
      result = local
        ? spawnSync("sh", ["run.sh"], { ...options, cwd: directory })
        : spawnSync(
            "container",
            [
              "machine",
              "run",
              "-n",
              "dev",
              "-w",
              directory,
              "--",
              "sh",
              "run.sh",
            ],
            options,
          );
    }
    const lines = (result.stdout ?? "").split("\n");
    const decode = (value: string) =>
      Buffer.from(value, "base64").toString("utf8");
    const ready = lines.find((line) => line.startsWith("READY\t"));
    const unavailable = lines.find((line) => line.startsWith("UNAVAILABLE\t"));
    const transportError = result.error?.message ?? result.stderr?.trim();
    if (ready === undefined) {
      const reason =
        unavailable?.slice(12) ||
        transportError ||
        `transport exited ${result.status}`;
      return {
        observations: invocations.map(() =>
          failure(
            unavailable !== undefined ||
              (!lines.includes("STARTED") && result.status !== 0)
              ? "execution-unavailable"
              : "runner-error",
            `${runner}: ${reason}`,
          ),
        ),
      };
    }
    const identity = decode(ready.slice(6));
    const executor = {
      runner,
      identity: ssh
        ? `${host}:${env.TINT_X64_SSH_PORT ?? "2223"} ${identity}`
        : local
          ? identity
          : `dev ${identity}`,
      ...(sysrootSha256 === undefined ? {} : { sysrootSha256 }),
    };
    const observed = new Map<number, Observation>();
    for (const line of lines) {
      const fields = line.split("\t");
      if (fields[0] !== "RESULT" || fields.length !== 6) continue;
      const [, index, kind, value, stdout, stderr] = fields as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const streams = { stdout: decode(stdout), stderr: decode(stderr) };
      let outcome: Outcome;
      if (kind === "exited") outcome = { kind, status: Number(value) };
      else if (kind === "signaled") outcome = { kind, signal: value };
      else if (kind === "timed-out") outcome = { kind };
      else outcome = { kind: "runner-error", reason: value };
      observed.set(Number(index), { ...streams, ...outcome });
    }
    return {
      executor,
      observations: invocations.map(
        (_, index) =>
          observed.get(index) ??
          failure(
            "runner-error",
            `${runner} did not report run ${index}: ${transportError || result.status}`,
          ),
      ),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Run a batch of same-target images. Linux transports stage each image once
 * and return each inferior's observation independently of the transport. */
export function runNativeBatch(
  invocations: readonly NativeInvocation[],
  env: NodeJS.ProcessEnv = process.env,
): NativeResult[] {
  const target = invocations[0]?.artifact.target;
  if (target === undefined) return [];
  const configured = env.TINT_NATIVE_RUNNER;
  const runner =
    configured ??
    (target === "darwin-aarch64" && process.platform === "darwin"
      ? "darwin-local"
      : target === "linux-aarch64"
        ? "linux-dev"
        : undefined);
  const unavailable = (reason: string): NativeResult[] =>
    invocations.map(({ artifact }) => ({
      artifact,
      ...failure("execution-unavailable", `${target}: ${reason}`),
    }));
  if (runner === undefined)
    return unavailable("select a compatible TINT_NATIVE_RUNNER");
  if (
    !Object.hasOwn(runners, runner) ||
    runners[runner as NativeRunnerName] !== target
  )
    return unavailable(`TINT_NATIVE_RUNNER=${runner} cannot run this target`);
  if (
    runner === "darwin-local" &&
    (process.platform !== "darwin" || process.arch !== "arm64")
  )
    return unavailable("darwin-local requires macOS arm64");
  if (
    runner === "x64-local" &&
    (process.platform !== "linux" || process.arch !== "x64")
  )
    return unavailable("x64-local requires Linux x86-64");
  const verified = new Set<NativeArtifact>();
  for (const { artifact, args, timeoutMs } of invocations) {
    if (artifact.target !== target)
      throw Error("native batches require one target");
    if (
      timeoutMs !== undefined &&
      (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    )
      throw Error(
        "native run timeout must be a positive integer in milliseconds",
      );
    if (args?.some((arg) => arg.includes("\0")))
      throw Error("native run arguments must not contain NUL");
    if (verified.has(artifact)) continue;
    if (imageHash(artifact.path) !== artifact.imageSha256)
      throw Error(`native artifact changed: ${artifact.path}`);
    if (
      artifact.buildManifest !== undefined &&
      imageHash(artifact.buildManifest.path) !== artifact.buildManifest.sha256
    )
      throw Error(
        `native artifact build manifest changed: ${artifact.buildManifest.path}`,
      );
    verified.add(artifact);
  }
  const execution =
    runner === "darwin-local"
      ? {
          executor: { runner, identity: version() } satisfies Executor,
          observations: (() => {
            const admission = new Map<string, Observation | undefined>();
            return invocations.map((job) => {
              const { path } = job.artifact;
              if (env.TINT_GATE_NATIVE_IMAGES) {
                const failureBeforeLaunch = admission.get(path);
                if (failureBeforeLaunch !== undefined)
                  return failureBeforeLaunch;
                let admitted = false;
                try {
                  return runNativeFixture(
                    path,
                    () => {
                      admitted = true;
                      return localDarwinRun(job, env);
                    },
                    () => admitUnderLldb(path, env),
                    env,
                  );
                } catch (error) {
                  if (admitted) throw error;
                  const outcome = failure(
                    (error as NodeJS.ErrnoException).code === "ENOENT"
                      ? "execution-unavailable"
                      : "runner-error",
                    String(error),
                  );
                  admission.set(path, outcome);
                  return outcome;
                }
              }
              if (!admission.has(path)) {
                try {
                  admitUnderLldb(path, env);
                  admission.set(path, undefined);
                } catch (error) {
                  admission.set(
                    path,
                    failure(
                      (error as NodeJS.ErrnoException).code === "ENOENT"
                        ? "execution-unavailable"
                        : "runner-error",
                      String(error),
                    ),
                  );
                }
              }
              return admission.get(path) ?? localDarwinRun(job, env);
            });
          })(),
        }
      : linuxBatch(
          runner as Exclude<NativeRunnerName, "darwin-local">,
          invocations,
          env,
        );
  return execution.observations.map((observation, index) => ({
    ...observation,
    artifact: invocations[index]!.artifact,
    ...(execution.executor === undefined
      ? {}
      : { executor: execution.executor }),
  }));
}
