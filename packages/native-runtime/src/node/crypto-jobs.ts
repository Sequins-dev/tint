// PBKDF2 runs on the existing blocking pool. The request mailbox carries a
// decimal address, while the isolate retains ownership of the native payload.
import { address, allocate, release } from "tint:ffi";
import {
  bytesAt,
  cStringAt,
  invoke,
  resultNumber,
  setNumber,
} from "tint:ffi/unsafe";
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import type { NativeBlockingPool } from "../blocking-pool.ts";
import type { EventLoop, EventLoopHandle } from "../event-loop.ts";
import { codedError, codedRangeError } from "./errors.ts";
import {
  digestName,
  disposeAddress,
  fetchDigest,
  systemOpenSSL,
} from "./openssl.ts";

type Callback = (error: unknown, result: Uint8Array | undefined) => void;
interface Job {
  readonly payload: Uint8Array;
  readonly resultOffset: number;
  readonly keyLength: number;
  readonly callback: Callback;
  readonly hold: EventLoopHandle;
}
export interface CryptoJobs {
  readonly pool: NativeBlockingPool;
  readonly loop: EventLoop;
  readonly pending: Map<number, Job>;
  receive(): void;
  close(): void;
}

const headerSize = 16;
let active: CryptoJobs | undefined = undefined;

function readWord(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] ?? 0) +
    (bytes[at + 1] ?? 0) * 256 +
    (bytes[at + 2] ?? 0) * 65536 +
    (bytes[at + 3] ?? 0) * 16777216
  );
}

function writeWord(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 255;
  bytes[at + 1] = (value >>> 8) & 255;
  bytes[at + 2] = (value >>> 16) & 255;
  bytes[at + 3] = value >>> 24;
}

function wipeAndRelease(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) bytes[i] = 0;
  release(bytes);
}

function releaseJob(job: Job): void {
  job.hold.close();
  wipeAndRelease(job.payload);
}

export function initializeCryptoJobs(
  loop: EventLoop,
  pool: NativeBlockingPool,
): CryptoJobs {
  if (active !== undefined)
    throw new Error("crypto jobs are already initialized");
  const pending = new Map<number, Job>();
  const jobs: CryptoJobs = {
    pool,
    loop,
    pending,
    receive(): void {
      for (;;) {
        const reply = pool.receive();
        if (reply === undefined) return;
        loop.enqueuePending((): void => {
          const job = pending.get(reply.id);
          if (job === undefined) return; // Session closed before delivery.
          pending.delete(reply.id);
          try {
            if (reply.failed) {
              job.callback(
                codedError(reply.result, "ERR_CRYPTO_OPERATION_FAILED"),
                undefined,
              );
              return;
            }
            const output = new Uint8Array(job.keyLength);
            output.set(
              job.payload.subarray(
                job.resultOffset,
                job.resultOffset + job.keyLength,
              ),
            );
            job.callback(null, output);
          } finally {
            releaseJob(job);
          }
        });
      }
    },
    close(): void {
      if (active !== jobs) return;
      pool.abort();
      active = undefined;
      for (const [id, job] of pending) {
        releaseJob(job);
        pending.delete(id);
      }
    },
  };
  active = jobs;
  return jobs;
}

function requireInteger(value: number, minimum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > 2147483647)
    throw codedRangeError(
      'The value of "' +
        name +
        '" is out of range. It must be >= ' +
        String(minimum) +
        " && <= 2147483647. Received " +
        String(value),
      "ERR_OUT_OF_RANGE",
    );
}

export function pbkdf2(
  password: string | Uint8Array,
  salt: string | Uint8Array,
  iterations: number,
  keyLength: number,
  digest: string,
  callback: Callback,
): void {
  requireInteger(iterations, 1, "iterations");
  requireInteger(keyLength, 0, "keylen");
  const jobs = active;
  if (jobs === undefined)
    throw codedError(
      "node:crypto pbkdf2 requires the Node blocking pool",
      "ERR_CRYPTO_UNSUPPORTED_OPERATION",
    );
  const ffi = systemOpenSSL();
  const digestHandle = fetchDigest(ffi, digest);
  if (digestHandle === 0)
    throw codedError("Invalid digest: " + digest, "ERR_CRYPTO_INVALID_DIGEST");
  disposeAddress(ffi.digestFree, digestHandle);

  const passBytes =
    typeof password === "string" ? encodeUTF8(password) : password;
  const saltBytes = typeof salt === "string" ? encodeUTF8(salt) : salt;
  const digestBytes = encodeUTF8(digestName(digest) + String.fromCharCode(0));
  const saltOffset = headerSize + digestBytes.length + passBytes.length;
  const resultOffset = saltOffset + saltBytes.length;
  const payload = allocate(resultOffset + keyLength);
  let submitted = false;
  try {
    writeWord(payload, 0, iterations);
    writeWord(payload, 4, keyLength);
    writeWord(payload, 8, saltOffset);
    writeWord(payload, 12, resultOffset);
    payload.set(digestBytes, headerSize);
    payload.set(passBytes, headerSize + digestBytes.length);
    payload.set(saltBytes, saltOffset);
    const hold = jobs.loop.retain();
    try {
      const result = jobs.pool.submit(String(address(payload)));
      if (!result.ok)
        throw codedError(
          "crypto helper pool is full",
          "ERR_CRYPTO_OPERATION_FAILED",
        );
      // The owner cannot drain the inbox during this synchronous submission.
      submitted = true;
      jobs.pending.set(result.value, {
        payload,
        resultOffset,
        keyLength,
        callback,
        hold,
      });
    } finally {
      if (!submitted) hold.close();
    }
  } finally {
    if (!submitted) wipeAndRelease(payload);
  }
}

export function performCryptoJob(request: string): string {
  const base = Number(request);
  const header = bytesAt(base, headerSize);
  const iterations = readWord(header, 0);
  const keyLength = readWord(header, 4);
  const saltOffset = readWord(header, 8);
  const resultOffset = readWord(header, 12);
  const name = cStringAt(base + headerSize);
  const passOffset = headerSize + encodeUTF8(name).length + 1;
  const ffi = systemOpenSSL();
  const digest = fetchDigest(ffi, name);
  if (digest === 0) throw "PBKDF2 digest is unavailable";
  setNumber(ffi.setThreadContext, 0, ffi.libraryContext);
  invoke(ffi.setThreadContext);
  const previous = resultNumber(ffi.setThreadContext);
  try {
    setNumber(ffi.pbkdf2, 0, base + passOffset);
    setNumber(ffi.pbkdf2, 1, saltOffset - passOffset);
    setNumber(ffi.pbkdf2, 2, base + saltOffset);
    setNumber(ffi.pbkdf2, 3, resultOffset - saltOffset);
    setNumber(ffi.pbkdf2, 4, iterations);
    setNumber(ffi.pbkdf2, 5, digest);
    setNumber(ffi.pbkdf2, 6, keyLength);
    setNumber(ffi.pbkdf2, 7, base + resultOffset);
    invoke(ffi.pbkdf2);
    if (resultNumber(ffi.pbkdf2) !== 1) throw "PBKDF2 failed";
    return "";
  } finally {
    setNumber(ffi.setThreadContext, 0, previous);
    invoke(ffi.setThreadContext);
    disposeAddress(ffi.digestFree, digest);
    invoke(ffi.clearErrors);
  }
}
