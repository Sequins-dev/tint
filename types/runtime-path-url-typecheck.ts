import path, { parse } from "node:path";
import posix from "node:path/posix";
import win32 from "node:path/win32";
import {
  URL as NodeURL,
  URLSearchParams as NodeParams,
  fileURLToPath,
  pathToFileURL,
} from "node:url";

const pathname: string = path.join(
  posix.sep,
  parse(win32.basename("C:\\f.txt")).base,
);
const url: NodeURL = pathToFileURL(pathname);
const parsed: URL | null = NodeURL.parse(url.href);
const query: NodeParams = new URLSearchParams([["a", "b"]]);
const pathString: string = fileURLToPath(url, { windows: true });
const entries: IterableIterator<[string, string]> = query.entries();
void [parsed, pathString, entries];
// @ts-expect-error A URL constructor requires an input.
new NodeURL();
// @ts-expect-error Path arguments must be strings.
posix.join(5);
// @ts-expect-error The Windows option has a boolean contract.
fileURLToPath(url, { windows: "true" });
// @ts-expect-error Parameters are string pairs.
query.append("page", 5);
