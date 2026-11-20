import {
  dup,
  fcntl$setFlags,
  pipe,
  pthread_detach,
} from "tint:c/worker-thread-host";
import {
  nativeTargetOSDarwin,
  nativeTargetOSLinux,
  nodeWorkerLaunchRecordBytes,
  nodeWorkerLaunchReplyOffset,
} from "@tint/abi/host";
import { readSigned, writeUnsigned } from "@tint/foundation/binary/bytes";
import { read, write, close } from "@tint/native-runtime/intrinsics/fs";
import {
  hostedThreadEntry,
  startNativeThread,
} from "@tint/native-runtime/intrinsics/memory";
import { targetOperatingSystem } from "@tint/native-runtime/intrinsics/process";
import type {
  NativeWorkerThreadHost,
  WorkerControlPipe,
  WorkerExitPipe,
} from "@tint/native-runtime/workers";

const SET_DESCRIPTOR_FLAGS = 2;
const SET_STATUS_FLAGS = 4;
const CLOSE_ON_EXEC = 1;
const INTERRUPTED = -4;

function setFlags(fd: number, command: number, flags: number): void {
  let status = fcntl$setFlags(fd, command, flags);
  while (status === INTERRUPTED) status = fcntl$setFlags(fd, command, flags);
  if (status < 0)
    throw new Error("worker pipe fcntl failed: " + String(status));
}

function openPipe(): WorkerControlPipe {
  const ends = new Uint8Array(8);
  const status = pipe(ends);
  if (status < 0) throw new Error("worker pipe failed: " + String(status));
  const input = readSigned(ends, 0, 4, "little");
  const output = readSigned(ends, 4, 4, "little");
  if (!input.ok || !output.ok) throw "NATIVE_WORKER_PIPE_LAYOUT";
  try {
    setFlags(input.value, SET_DESCRIPTOR_FLAGS, CLOSE_ON_EXEC);
    setFlags(output.value, SET_DESCRIPTOR_FLAGS, CLOSE_ON_EXEC);
    return { input: input.value, output: output.value };
  } catch (error) {
    close(input.value);
    close(output.value);
    throw error;
  }
}

export function createNativeWorkerThreadHost(): NativeWorkerThreadHost {
  const os = targetOperatingSystem();
  if (os !== nativeTargetOSDarwin && os !== nativeTargetOSLinux)
    throw "unknown worker platform";
  const nonblocking = os === nativeTargetOSDarwin ? 4 : 2048;

  function controlPipe(): WorkerControlPipe {
    const { input, output } = openPipe();
    try {
      setFlags(input, SET_STATUS_FLAGS, nonblocking);
      setFlags(output, SET_STATUS_FLAGS, nonblocking);
      return { input, output };
    } catch (error) {
      close(input);
      close(output);
      throw error;
    }
  }

  function exitPipe(): WorkerExitPipe {
    const ends = controlPipe();
    let guard = -1;
    try {
      guard = dup(ends.input);
      if (guard < 0)
        throw new Error("worker pipe dup failed: " + String(guard));
      setFlags(guard, SET_DESCRIPTOR_FLAGS, CLOSE_ON_EXEC);
      return {
        input: ends.input,
        childOutput: ends.output,
        childReadGuard: guard,
      };
    } catch (error) {
      if (guard >= 0) close(guard);
      close(ends.input);
      close(ends.output);
      throw error;
    }
  }

  return {
    entry: hostedThreadEntry(),
    wouldBlock: os === nativeTargetOSDarwin ? -35 : -11,
    controlPipe,
    exitPipe,
    read: (fd, bytes): number => read(fd, bytes),
    write: (fd, bytes): number => write(fd, bytes),
    close: (fd): void => {
      const status = close(fd);
      if (status < 0)
        throw new Error("worker pipe close failed: " + String(status));
    },
    start: (entry, argument): number => startNativeThread(entry, argument),
    detach: (thread): number => pthread_detach(thread),
  };
}

/** The broker calls Node's Worker constructor from JS on its own thread.
 * Tint retains its existing raw isolate records, ports and exit path. */
export function createNodeHostedWorkerThreadHost(
  broker: number,
): NativeWorkerThreadHost {
  if (!Number.isInteger(broker) || broker < 0 || broker > 2147483647)
    throw new RangeError("invalid Node worker broker descriptor");
  const host = createNativeWorkerThreadHost();
  return {
    ...host,
    start: (_entry, argument): number => {
      const request = new Uint8Array(nodeWorkerLaunchRecordBytes);
      const reply = new Uint8Array(4);
      const { input, output } = openPipe();
      try {
        if (
          !writeUnsigned(request, 0, 4, argument % 4294967296, "little").ok ||
          !writeUnsigned(
            request,
            4,
            4,
            Math.floor(argument / 4294967296),
            "little",
          ).ok ||
          !writeUnsigned(
            request,
            nodeWorkerLaunchReplyOffset,
            4,
            output,
            "little",
          ).ok
        )
          throw "NODE_WORKER_BROKER_RECORD";
        let count = write(broker, request);
        while (count === INTERRUPTED) count = write(broker, request);
        if (count !== request.length) return -1;
        count = read(input, reply);
        while (count === INTERRUPTED) count = read(input, reply);
        const result = readSigned(reply, 0, 4, "little");
        return count === reply.length && result.ok ? result.value : -1;
      } finally {
        close(input);
        close(output);
      }
    },
    detach: (_thread): number => 0,
  };
}
