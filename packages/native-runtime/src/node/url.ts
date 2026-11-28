import { codedError, invalidArgument } from "./coded-errors.ts";
import { posix, win32 } from "./path-variants.ts";

const URLConstructor = URL;
const ParamsConstructor = URLSearchParams;
export { URLConstructor as URL, ParamsConstructor as URLSearchParams };

export interface FileOptions {
  readonly windows?: boolean;
}
export interface FormatOptions {
  readonly auth?: boolean;
  readonly fragment?: boolean;
  readonly search?: boolean;
  readonly unicode?: boolean;
}
export interface LegacyFormat {
  readonly protocol?: string;
  readonly slashes?: boolean;
  readonly auth?: string;
  readonly host?: string;
  readonly hostname?: string;
  readonly port?: string | number;
  readonly pathname?: string;
  readonly search?: string;
  readonly hash?: string;
  readonly query?: Record<string, unknown>;
}

export interface HttpOptions {
  protocol: string;
  hostname: string;
  hash: string;
  search: string;
  pathname: string;
  path: string;
  href: string;
  port?: number;
  auth?: string;
}
function useWindows(options: FileOptions | undefined): boolean {
  return Boolean(options?.windows);
}
function badFilePath(message: string): Error {
  return codedError(new TypeError(message), "ERR_INVALID_FILE_URL_PATH");
}

export function fileURLToPath(
  input: string | URL,
  options?: FileOptions,
): string {
  let url: URL;
  if (typeof input === "string") url = new URL(input);
  else if (input instanceof URL) url = input;
  else
    throw invalidArgument(
      "path",
      "of type string or an instance of URL",
      input,
    );
  if (url.protocol !== "file:")
    throw codedError(
      new TypeError("The URL must be of scheme file"),
      "ERR_INVALID_URL_SCHEME",
    );
  const windows = useWindows(options);
  const escaped = url.pathname.toLowerCase();
  if (escaped.includes("%2f") || (windows && escaped.includes("%5c")))
    throw badFilePath(
      "File URL path must not include encoded " +
        (windows ? "\\ or /" : "/") +
        " characters",
    );
  const path = decodeURIComponent(url.pathname);
  const host = url.hostname;
  if (windows) {
    const local = path.split("/").join("\\");
    if (host !== "") return "\\\\" + domainToUnicode(host) + local;
    const drive = local.charCodeAt(1) | 32;
    if (drive < 97 || drive > 122 || local.charAt(2) !== ":")
      throw badFilePath("File URL path must be absolute");
    return local.slice(1);
  }
  if (host !== "")
    throw codedError(
      new TypeError('File URL host must be "localhost" or empty'),
      "ERR_INVALID_FILE_URL_HOST",
    );
  return path;
}

function escapeFilePath(path: string, windows: boolean): string {
  return path
    .split("%")
    .join("%25")
    .split("#")
    .join("%23")
    .split("?")
    .join("%3F")
    .split("\t")
    .join("%09")
    .split("\n")
    .join("%0A")
    .split("\r")
    .join("%0D")
    .split("\\")
    .join(windows ? "/" : "%5C");
}
export function pathToFileURL(input: string, options?: FileOptions): URL {
  if (typeof input !== "string")
    throw invalidArgument("path", "of type string", input);
  const windows = useWindows(options);
  let path = windows ? win32.resolve(input) : posix.resolve(input);
  const last = input.charAt(input.length - 1);
  if (
    (last === "/" || (windows && last === "\\")) &&
    (windows || !path.endsWith("/")) &&
    (!path.startsWith("\\\\") || !path.endsWith("\\"))
  )
    path += windows ? "\\" : "/";
  if (windows && path.startsWith("\\\\?\\UNC\\")) path = "\\\\" + path.slice(8);
  else if (windows && path.startsWith("\\\\?\\")) path = path.slice(4);
  if (windows && path.startsWith("\\\\")) {
    const index = path.indexOf("\\", 2);
    const hostname = path.slice(2, index);
    const encoded = escapeFilePath(path.slice(index), true);
    return new URL("file://" + hostname + encoded);
  }
  const encoded = escapeFilePath(path, windows);
  // Set the pathname directly so leading path separators never form a host.
  const url = new URL("file:///");
  url.pathname = encoded;
  return url;
}

export function urlToHttpOptions(url: URL): HttpOptions {
  const hostname = url.hostname;
  const result = Object.assign(Object.create(null), url, {
    protocol: url.protocol,
    hostname: hostname.startsWith("[") ? hostname.slice(1, -1) : hostname,
    hash: url.hash,
    search: url.search,
    pathname: url.pathname,
    path: url.pathname + url.search,
    href: url.href,
  });
  if (url.port !== "") result.port = Number(url.port);
  if (url.username !== "" || url.password !== "")
    result.auth =
      decodeURIComponent(url.username) + ":" + decodeURIComponent(url.password);
  return result;
}

export function domainToASCII(domain: string): string {
  if (arguments.length === 0)
    throw codedError(
      new TypeError('The "domain" argument must be specified'),
      "ERR_MISSING_ARGS",
    );
  const text = String(domain);
  let end = 0;
  while (end < text.length && !"/\\?#".includes(text.charAt(end))) end++;
  const hostname = text.slice(0, end);
  if (
    hostname.includes("@") ||
    (!hostname.startsWith("[") && hostname.includes(":"))
  )
    return "";
  const url = URL.parse("http://" + hostname);
  return url === null || url.port !== "" ? "" : url.hostname;
}

// RFC 3492 decoding. Validate input through the same host parser before decoding.
function decodeLabel(label: string): string {
  if (!label.startsWith("xn--")) return label;
  const text = label.slice(4);
  const chars: number[] = [];
  const delimiter = text.lastIndexOf("-");
  for (let i = 0; i < delimiter; i++) chars.push(text.charCodeAt(i));
  let bias = 72,
    n = 128,
    index = 0;
  let offset = delimiter + 1;
  while (offset < text.length) {
    const previous = index;
    let weight = 1;
    for (let k = 36; ; k += 36) {
      const code = text.charCodeAt(offset++);
      const digit =
        code >= 97 && code <= 122
          ? code - 97
          : code >= 48 && code <= 57
            ? code - 22
            : 36;
      if (digit >= 36) return label;
      index += digit * weight;
      const t = Math.max(1, Math.min(26, k - bias));
      if (digit < t) break;
      weight *= 36 - t;
      if (!Number.isSafeInteger(weight) || !Number.isSafeInteger(index))
        return label;
    }
    const length = chars.length + 1;
    let delta = Math.floor(
      (index - previous) / (previous === 0 && n === 128 ? 700 : 2),
    );
    delta += Math.floor(delta / length);
    let k = 0;
    while (delta > 455) {
      delta = Math.floor(delta / 35);
      k += 36;
    }
    bias = k + Math.floor((36 * delta) / (delta + 38));
    n += Math.floor(index / length);
    if (n > 1114111 || (n >= 55296 && n <= 57343)) return label;
    index %= length;
    chars.splice(index++, 0, n);
  }
  let result = "";
  for (const value of chars)
    if (value !== undefined) result += String.fromCodePoint(value);
  return result;
}
export function domainToUnicode(domain: string): string {
  if (arguments.length === 0)
    throw codedError(
      new TypeError('The "domain" argument must be specified'),
      "ERR_MISSING_ARGS",
    );
  return domainToASCII(domain).split(".").map(decodeLabel).join(".");
}

export function format(
  input: URL | string | LegacyFormat,
  options?: FormatOptions,
): string {
  if (typeof input === "string") {
    const parsed = URL.parse(input);
    if (parsed === null) return input.trim().split(" ").join("%20");
    input = parsed;
    options = undefined;
  }
  if (input instanceof URL) {
    if (
      options !== null &&
      options !== undefined &&
      (typeof options !== "object" || Array.isArray(options))
    )
      throw invalidArgument("options", "of type object", options);
    const href = input.href;
    const hash = href.indexOf("#");
    const beforeHash = hash < 0 ? href : href.slice(0, hash);
    const question = beforeHash.indexOf("?");
    let output = question < 0 ? beforeHash : beforeHash.slice(0, question);
    const protocol = input.protocol;
    const start = protocol.length + 2;
    if (output.slice(protocol.length, start) === "//") {
      const end = output.indexOf("/", start);
      const path = end < 0 ? "" : output.slice(end);
      const credentials = input.username !== "" || input.password !== "";
      const auth =
        (options?.auth === undefined || options.auth) && credentials
          ? input.username +
            (input.password === "" ? "" : ":" + input.password) +
            "@"
          : "";
      const host = options?.unicode
        ? domainToUnicode(input.hostname)
        : input.hostname;
      output =
        protocol +
        "//" +
        auth +
        host +
        (input.port === "" ? "" : ":" + input.port) +
        path;
    }
    if (question >= 0 && (options?.search === undefined || options.search))
      output += beforeHash.slice(question);
    if (hash >= 0 && (options?.fragment === undefined || options.fragment))
      output += href.slice(hash);
    return output;
  }
  if (input === null || typeof input !== "object")
    throw invalidArgument("urlObject", "of type object", input);
  const protocol = input.protocol || "";
  const scheme =
    protocol === "" || protocol.endsWith(":") ? protocol : protocol + ":";
  let host = input.host || input.hostname || "";
  if (!input.host && host.includes(":") && !host.startsWith("["))
    host = "[" + host + "]";
  if (!input.host && input.port) host += ":" + String(input.port);
  const auth = input.auth
    ? encodeURIComponent(input.auth).split("%3A").join(":") + "@"
    : "";
  const slashes =
    input.slashes === true ||
    (host !== "" &&
      (scheme === "" ||
        scheme === "http:" ||
        scheme === "https:" ||
        scheme === "ftp:" ||
        scheme === "ws:" ||
        scheme === "wss:"));
  let path = (input.pathname || "")
    .split("?")
    .join("%3F")
    .split("#")
    .join("%23");
  if (slashes && path !== "" && !path.startsWith("/")) path = "/" + path;
  let search = input.search || "";
  if (search === "" && input.query !== undefined) {
    const pairs: string[] = [];
    for (const key of Object.keys(input.query)) {
      const value = input.query[key];
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        const type = typeof item;
        pairs.push(
          encodeURIComponent(key) +
            "=" +
            (type === "string" ||
            type === "boolean" ||
            type === "number" ||
            type === "bigint"
              ? encodeURIComponent(String(item))
              : ""),
        );
      }
    }
    search = pairs.join("&");
  }
  if (search !== "" && !search.startsWith("?")) search = "?" + search;
  const hash = input.hash || "";
  return (
    scheme +
    (slashes ? "//" : "") +
    auth +
    host +
    path +
    search.split("#").join("%23") +
    (hash !== "" && !hash.startsWith("#") ? "#" : "") +
    hash
  );
}

export default {
  URL: URLConstructor,
  URLSearchParams: ParamsConstructor,
  domainToASCII,
  domainToUnicode,
  fileURLToPath,
  pathToFileURL,
  urlToHttpOptions,
  format,
};
