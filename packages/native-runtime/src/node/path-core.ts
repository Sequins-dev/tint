import { invalidArgument } from "./coded-errors.ts";

export interface ParsedPath {
  readonly root: string;
  readonly dir: string;
  readonly base: string;
  readonly ext: string;
  readonly name: string;
}
export interface PathFormat {
  readonly root?: string;
  readonly dir?: string;
  readonly base?: string;
  readonly ext?: string;
  readonly name?: string;
}
export interface PathAPI {
  sep: string;
  delimiter: string;
  resolve: (...paths: string[]) => string;
  normalize: (path: string) => string;
  isAbsolute: (path: string) => boolean;
  join: (...paths: string[]) => string;
  relative: (from: string, to: string) => string;
  toNamespacedPath: (path: string) => string;
  dirname: (path: string) => string;
  basename: (path: string, suffix?: string) => string;
  extname: (path: string) => string;
  format: (pathObject: PathFormat) => string;
  parse: (path: string) => ParsedPath;
  posix: PathAPI | undefined;
  win32: PathAPI | undefined;
}
interface Root {
  readonly device: string;
  readonly end: number;
  readonly absolute: boolean;
}

function check(path: unknown, name: string): string {
  if (typeof path !== "string")
    throw invalidArgument(name, "of type string", path);
  return path;
}

function letter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export function createPath(
  windows: boolean,
  currentDirectory: () => string,
): PathAPI {
  const sep = windows ? "\\" : "/";
  function separator(char: string): boolean {
    return char === "/" || (windows && char === "\\");
  }
  function root(path: string): Root {
    if (separator(path.charAt(0))) {
      if (windows && separator(path.charAt(1))) {
        let end = 2;
        while (end < path.length && !separator(path.charAt(end))) end++;
        const server = path.slice(2, end);
        while (separator(path.charAt(end))) end++;
        const start = end;
        while (end < path.length && !separator(path.charAt(end))) end++;
        if (server !== "" && end !== start) {
          const device = "\\\\" + server + "\\" + path.slice(start, end);
          return {
            device,
            end: separator(path.charAt(end)) ? end + 1 : end,
            absolute: true,
          };
        }
      }
      return { device: "", end: 1, absolute: true };
    }
    if (windows && letter(path.charCodeAt(0)) && path.charAt(1) === ":") {
      const absolute = separator(path.charAt(2));
      return { device: path.slice(0, 2), end: absolute ? 3 : 2, absolute };
    }
    return { device: "", end: 0, absolute: false };
  }

  function reduce(path: string, absolute: boolean): string {
    const parts: string[] = [];
    let start = 0;
    for (let end = 0; end <= path.length; end++) {
      if (end !== path.length && !separator(path.charAt(end))) continue;
      const part = path.slice(start, end);
      start = end + 1;
      if (part === "" || part === ".") continue;
      if (part !== "..") parts.push(part);
      else if (parts.length > 0 && parts[parts.length - 1] !== "..")
        parts.pop();
      else if (!absolute) parts.push("..");
    }
    return parts.join(sep);
  }

  function resolve(...paths: string[]): string {
    let device = "",
      tail = "";
    let absolute = false;
    for (let i = paths.length - 1; i >= -1; i--) {
      const path =
        i === -1 ? currentDirectory() : check(paths[i], "paths[" + i + "]");
      if (path.length === 0) continue;
      const parsed = root(path);
      if (parsed.device !== "") {
        if (
          device !== "" &&
          parsed.device.toLowerCase() !== device.toLowerCase()
        ) {
          if (i !== -1) continue;
          absolute = true;
          break;
        }
        if (device === "") device = parsed.device;
      }
      if (!absolute) {
        tail = path.slice(parsed.end) + sep + tail;
        absolute = parsed.absolute;
      }
      if (absolute && (!windows || device !== "")) break;
    }
    const body = reduce(tail, absolute);
    if (
      body === "" &&
      (device.startsWith("\\\\?\\") || device.startsWith("\\\\.\\"))
    )
      return device;
    return device + (absolute ? sep : "") + body || ".";
  }

  function normalize(path: string): string {
    path = check(path, "path");
    const parsed = root(path);
    let body = reduce(path.slice(parsed.end), parsed.absolute);
    if (body === "" && !parsed.absolute) body = ".";
    if (body !== "" && separator(path.charAt(path.length - 1))) body += sep;
    if (
      body === "" &&
      !separator(path.charAt(path.length - 1)) &&
      (parsed.device.startsWith("\\\\?\\") ||
        parsed.device.startsWith("\\\\.\\"))
    )
      return parsed.device;
    if (
      windows &&
      parsed.device === "" &&
      !parsed.absolute &&
      (root(body).device !== "" ||
        path.endsWith(":") ||
        path.includes(":/") ||
        path.includes(":\\"))
    )
      body = ".\\" + body;
    return parsed.device + (parsed.absolute ? sep : "") + body;
  }

  function join(...paths: string[]): string {
    let joined = "";
    let first = "";
    for (let i = 0; i < paths.length; i++) {
      const path = check(paths[i], "paths[" + i + "]");
      if (path === "") continue;
      if (first === "") first = path;
      joined += (joined === "" ? "" : sep) + path;
    }
    if (
      windows &&
      separator(joined.charAt(0)) &&
      separator(joined.charAt(1)) &&
      !(
        separator(first.charAt(1)) &&
        first.length > 2 &&
        !separator(first.charAt(2))
      )
    ) {
      let start = 1;
      while (separator(joined.charAt(start))) start++;
      joined = sep + joined.slice(start);
    }
    return normalize(joined);
  }

  function relative(from: string, to: string): string {
    from = check(from, "from");
    to = check(to, "to");
    if (from === to) return "";
    const a = resolve(from),
      b = resolve(to);
    if (windows && a.toLowerCase() === b.toLowerCase()) return "";
    const fromParts = relativeParts(a);
    const toParts = relativeParts(b);
    let common = 0;
    while (common < fromParts.length && common < toParts.length) {
      const x = fromParts[common],
        y = toParts[common];
      if (
        x === undefined ||
        y === undefined ||
        (windows ? x.toLowerCase() !== y.toLowerCase() : x !== y)
      )
        break;
      common++;
    }
    if (windows && common === 0 && fromParts.length > 0 && toParts.length > 0)
      return b;
    // A UNC spelling and a root-relative spelling can have identical
    // components. Win32 relative retains the final component in that case.
    if (
      windows &&
      common > 0 &&
      common === fromParts.length &&
      common === toParts.length
    )
      common--;
    const output: string[] = [];
    for (let i = common; i < fromParts.length; i++) output.push("..");
    return output.concat(toParts.slice(common)).join(sep);
  }

  function relativeParts(path: string): string[] {
    let start = 0;
    while (separator(path.charAt(start))) start++;
    const parts = path.slice(start).split(sep);
    if (parts[parts.length - 1] === "") parts.pop();
    return parts;
  }

  function scan(path: string, minimum: number): { start: number; end: number } {
    let end = path.length;
    while (end > minimum && separator(path.charAt(end - 1))) end--;
    let start = end;
    while (start > minimum && !separator(path.charAt(start - 1))) start--;
    return { start, end };
  }

  function extension(base: string): string {
    const dot = base.lastIndexOf(".");
    return dot < 1 || base === ".." ? "" : base.slice(dot);
  }

  function parse(path: string): ParsedPath {
    path = check(path, "path");
    const parsed = root(path);
    const segment = scan(path, parsed.end);
    const base = path.slice(segment.start, segment.end);
    const ext =
      !windows && base === ".." && segment.start === 1 && parsed.absolute
        ? "."
        : extension(base);
    const prefix = path.slice(0, parsed.end);
    return {
      root: prefix,
      dir:
        segment.start > parsed.end ? path.slice(0, segment.start - 1) : prefix,
      base,
      ext,
      name: base.slice(0, base.length - ext.length),
    };
  }

  return {
    sep,
    delimiter: windows ? ";" : ":",
    resolve,
    normalize,
    join,
    relative,
    parse,
    isAbsolute(path: string): boolean {
      return root(check(path, "path")).absolute;
    },
    toNamespacedPath(path: string): string {
      if (!windows || typeof path !== "string" || path.length === 0)
        return path;
      const full = resolve(path);
      if (full.length <= 2) return path;
      if (full.startsWith("\\\\?\\") || full.startsWith("\\\\.\\")) return full;
      if (full.startsWith("\\\\")) return "\\\\?\\UNC\\" + full.slice(2);
      if (letter(full.charCodeAt(0)) && full.slice(1, 3) === ":\\")
        return "\\\\?\\" + full;
      return full;
    },
    dirname(path: string): string {
      path = check(path, "path");
      const parsed = root(path);
      const segment = scan(path, parsed.end);
      if (!windows && segment.start === 2 && path.startsWith("//")) return "//";
      return (
        (segment.start > parsed.end
          ? path.slice(0, segment.start - 1)
          : path.slice(0, parsed.end)) || "."
      );
    },
    basename(path: string, suffix?: string): string {
      if (suffix !== undefined) suffix = check(suffix, "suffix");
      path = check(path, "path");
      const minimum =
        windows && letter(path.charCodeAt(0)) && path.charAt(1) === ":" ? 2 : 0;
      const segment = scan(path, minimum);
      const base = path.slice(segment.start, segment.end);
      if (suffix === path) return "";
      if (
        suffix !== undefined &&
        suffix.length > 0 &&
        base !== suffix &&
        base.endsWith(suffix)
      )
        return base.slice(0, base.length - suffix.length);
      return base;
    },
    extname(path: string): string {
      path = check(path, "path");
      const minimum =
        windows && letter(path.charCodeAt(0)) && path.charAt(1) === ":" ? 2 : 0;
      const segment = scan(path, minimum);
      return extension(path.slice(segment.start, segment.end));
    },
    format(pathObject: PathFormat): string {
      if (
        typeof pathObject !== "object" ||
        pathObject === null ||
        Array.isArray(pathObject)
      )
        throw invalidArgument("pathObject", "of type object", pathObject);
      const directory = pathObject.dir || pathObject.root;
      const ext = pathObject.ext || "";
      const base =
        pathObject.base ||
        (pathObject.name || "") +
          (ext === "" || ext.startsWith(".") ? ext : "." + ext);
      return directory
        ? directory + (directory === pathObject.root ? "" : sep) + base
        : base;
    },
    posix: undefined,
    win32: undefined,
  };
}
