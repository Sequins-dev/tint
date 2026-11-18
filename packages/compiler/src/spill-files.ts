import {
  createFunctionStore,
  type FunctionStore,
  type SpillBackend,
  type SpillPolicy,
} from "@tint/ir/storage";
import { readFile, type FileHost } from "@tint/platform/files/service";
import { writeAll } from "@tint/platform/io/sync";

/** The packed IR policy for ahead-of-time emission. The host supplies its
 * file service and an existing directory when spilling to disk. */
export interface BuildStorage {
  readonly policy: SpillPolicy;
  readonly byteBudget?: number;
  readonly directory?: string;
  readonly files?: FileHost<number>;
}

export function createEmissionStore(
  storage: BuildStorage | undefined,
): FunctionStore {
  const policy: SpillPolicy = storage?.policy ?? "memory";
  const budget = storage?.byteBudget;
  if (
    policy === "budget" &&
    (budget === undefined || !Number.isSafeInteger(budget) || budget < 0)
  )
    throw "function store budget requires a nonnegative byte budget";
  const files = storage?.files,
    directory = storage?.directory;
  if ((files === undefined) !== (directory === undefined))
    throw "function store spill directory and file host must be supplied together";
  const backend: SpillBackend | undefined =
    policy === "memory" || files === undefined || directory === undefined
      ? undefined
      : createFileSpillBackend(files, directory + "/tint-ir");
  const packedBytes: number = budget ?? Number.MAX_SAFE_INTEGER;
  const chunkBytes: number =
    policy === "budget"
      ? Math.max(1024, Math.min(budget ?? 0, 1048576))
      : 1048576;
  return createFunctionStore({
    policy,
    residentBytes: 0,
    packedBytes,
    chunkBytes,
    backend,
  });
}
/** Function-store spill segments as temporary files beside `prefix`
 * (docs/compiler-memory.md, "Spill backend"): each segment is created,
 * written and closed once, read back whole and removed when released, so
 * the host needs no positioned reads. Serves the native compiler and Node
 * hosts alike through their file hosts. */
export function createFileSpillBackend(
  host: FileHost<number>,
  prefix: string,
): SpillBackend {
  const paths = new Map<number, string>(),
    lengths = new Map<number, number>();
  let next = 0;
  function remove(segment: number): void {
    const path = paths.get(segment);
    if (path === undefined) return;
    paths.delete(segment);
    lengths.delete(segment);
    const removed = host.remove(path);
    if (!removed.ok) throw "cannot remove spill segment " + path;
  }
  return {
    write: (bytes: Uint8Array): number => {
      const created = host.createTemporary(prefix);
      if (!created.ok) throw "cannot create spill segment beside " + prefix;
      const file = created.value,
        written = writeAll((buffer) => host.write(file.handle, buffer), bytes),
        closed = host.close(file.handle);
      if (!written.ok || !closed.ok) {
        host.remove(file.path);
        throw "cannot write spill segment " + file.path;
      }
      const segment = next;
      next++;
      paths.set(segment, file.path);
      lengths.set(segment, bytes.length);
      return segment;
    },
    read: (segment: number): Uint8Array => {
      const path = paths.get(segment),
        length = lengths.get(segment);
      if (path === undefined || length === undefined)
        throw "unknown spill segment";
      const loaded = readFile<number>(host, path, length);
      if (!loaded.ok) throw "cannot read spill segment " + path;
      return loaded.value;
    },
    release: (segment: number): void => remove(segment),
    close: (): void => {
      for (let segment = 0; segment < next; segment++) remove(segment);
    },
  };
}
