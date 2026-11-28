import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const cwd = JSON.stringify(process.cwd());

const pathSource = `
import path, { posix, win32, sep, resolve } from "node:path";
import p, { join } from "node:path/posix";
import w, { normalize } from "node:path/win32";
export function run(node26: boolean = true): number {
  if (path !== p || p !== posix || w !== win32 || sep !== "/") return 1;
  if (p.win32 !== w || w.posix !== p || join !== p.join || normalize !== w.normalize) return 2;
  if (join("/a", "b", "../c/") !== "/a/c/" || resolve("foo", "bar") !== p.resolve() + "/foo/bar" || p.resolve() !== ${cwd}) return 3;
  if (w.join("C:/one", "..", "two/") !== "C:\\\\two\\\\") return 4;
  if (w.relative("C:/ONE/a", "c:/one/b") !== "..\\\\b") return 5;
  if (w.parse("//server/share/a.txt").root !== "//server/share/") return 6;
  if (w.toNamespacedPath("C:/foo") !== "\\\\\\\\?\\\\C:\\\\foo") return 7;
  if (p.basename("a.tar.gz", ".gz") !== "a.tar" || p.extname(".env") !== "") return 8;
  if (w.format({ dir: "C:/one", name: "a", ext: "txt" }) !== "C:/one\\\\a.txt") return 9;
  if (w.relative("//server/a/foo", "//server/b/bar") !== "..\\\\..\\\\b\\\\bar") return 11;
  if (node26 && w.normalize("//?/C:/x/..") !== "\\\\\\\\?\\\\C:") return 12;
  try { p.join("ok", 5); } catch (error) {
    if (error instanceof TypeError && error.code === "ERR_INVALID_ARG_TYPE") return 42;
  }
  return 10;
}
`;
const urlSource = `
import url, { URL as NodeURL, URLSearchParams as NodeParams, fileURLToPath, pathToFileURL, urlToHttpOptions, format } from "node:url";
export function run(node26 = true) {
  if (URL !== NodeURL || URLSearchParams !== NodeParams || url.URL !== URL) return 1;
  const parsed = new URL("../a%20b?q=two+words#frag", "https://u:p@EXAMPLE.com:443/base/item");
  if (parsed.href !== "https://u:p@example.com/a%20b?q=two+words#frag" || parsed.origin !== "https://example.com") return 2;
  const query = parsed.searchParams;
  query.append("q", "é");
  query.append("x", "~");
  query.delete("q", "two words");
  query.sort();
  if (parsed.search !== "?q=%C3%A9&x=%7E" || query !== parsed.searchParams) return 3;
  parsed.search = "?b=1&b=2";
  if (query.size !== 2 || query.getAll("b").join() !== "1,2") return 4;
  const entries = [...query];
  if (entries.length !== 2 || entries[1].join() !== "b,2" || !query.has("b", "2")) return 5;
  if (!URL.canParse("https://bücher.example") || URL.parse("not absolute") !== null) return 6;
  if (new URL("http://0x7f.1").hostname !== "127.0.0.1") return 7;
  if (new URL("https://[2001:0db8::1]:444").host !== "[2001:db8::1]:444") return 8;
  const win = pathToFileURL("C:\\\\a b#%\\\\x", { windows: true });
  if (win.href !== "file:///C:/a%20b%23%25/x" || fileURLToPath(win, {windows: true}) !== "C:\\\\a b#%\\\\x") return 9;
  if (fileURLToPath(pathToFileURL("/tmp/a?b"), { windows: false }) !== "/tmp/a?b") return 10;
  const http = urlToHttpOptions(parsed);
  if (http.path !== "/a%20b?b=1&b=2" || http.auth !== "u:p") return 11;
  if (format(parsed, { auth: false, fragment: false, search: false }) !== "https://example.com/a%20b") return 12;
  if (pathToFileURL("/").href !== "file:///") return 13;
  if (format(new URL("https://example.com/?#")) !== "https://example.com/?#") return 14;
  const unc = pathToFileURL("\\\\\\\\server\\\\share\\\\a b", {windows: true});
  if (unc.href !== "file://server/share/a%20b" || fileURLToPath(unc, {windows: true}) !== "\\\\\\\\server\\\\share\\\\a b") return 15;
  try { fileURLToPath("file:///a%2fb"); return 16; } catch (error) {
    if (!(error instanceof TypeError) || error.code !== "ERR_INVALID_FILE_URL_PATH") return 17;
  }
  parsed.host = "example.net:8080stuff";
  parsed.protocol = "http:";
  parsed.username = "a@b";
  parsed.password = "c:d";
  parsed.pathname = "/x/../y?z";
  parsed.port = "80";
  parsed.hash = "#new fragment";
  if (parsed.href !== "http://a%40b:c%3Ad@example.net/y%3Fz?b=1&b=2#new%20fragment") return 18;
  const params = new URLSearchParams([["z", "ä"], ["a", "one"], ["a", "two"]]);
  params.sort();
  params.set("a", "new");
  const visited = [];
  params.forEach((value, key) => visited.push(key + ":" + value));
  if (visited.join(",") !== "a:new,z:ä" || [...params.keys()].join() !== "a,z" || [...params.values()].join() !== "new,ä") return 19;
  if (params.entries().next !== params.keys().next || params[Symbol.iterator] !== params.entries) return 20;
  if (new URL("https://xΣ.gr").hostname !== "xn--x-0mb.gr" || (node26 && URL.canParse("http://xא.test"))) return 21;
  if (new URL("https://क्‍ष.in").hostname !== "xn--11b2ezcw70k.in" || URL.canParse("http://a‌b.test")) return 22;
  try { params.append(); return 23; } catch (error) {
    if (!(error instanceof TypeError) || error.code !== "ERR_MISSING_ARGS") return 24;
  }
  return 42;
}
`;

for (const [name, source] of [
  ["path", pathSource],
  ["url", urlSource],
] as const) {
  test(name + " matches Node", async () => {
    const fixture = (await import(
      "data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source))
    )) as { run(node26: boolean): number };
    // The bootstrap Node 24 differs on a few namespace and IDNA edges.
    assert.equal(
      fixture.run(Number(process.versions.node.split(".")[0]) >= 26),
      42,
    );
  });
}

test("path and URL run with one native ESM and global identity", () => {
  const compiled: { general?: readonly string[] } = {};
  verifyHostedFixture(
    pathSource.replace("function run", "function checkPath") +
      urlSource.replace("function run", "function checkURL") +
      "\nexport function run(): number { const path = checkPath(); return path === 42 ? checkURL() : path; }",
    "m1p4-path-url",
    [
      ["node:path", "packages/native-runtime/src/node/path.ts"],
      ["node:path/posix", "packages/native-runtime/src/node/path-posix.ts"],
      ["node:path/win32", "packages/native-runtime/src/node/path-win32.ts"],
      ["node:url", "packages/native-runtime/src/node/url.ts"],
    ],
    [],
    [],
    [],
    {
      managedBytes: 33554432,
      allocationCapacity: 524288,
      onGeneralFallback(modules) {
        compiled.general = modules;
      },
    },
  );
  const general = compiled.general;
  assert.ok(general?.includes("packages/native-runtime/src/node/url.ts"));
  assert.equal(
    general?.includes("packages/native-runtime/src/node/path-cwd.ts"),
    false,
  );
});
