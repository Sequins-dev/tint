import type { SpillBackend } from "@tint/ir/storage";
import { readFile, type FileHost } from "@tint/platform/files/service";
import { writeAll } from "@tint/platform/io/sync";
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
