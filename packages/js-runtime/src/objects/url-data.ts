import {
  createUTF8Decoder,
  decodeUTF8,
  encodeUTF8,
} from "@tint/foundation/text/text-encoding";
import { mapURLDomain, validURLLabel } from "./url-idna.ts";

export interface URLData {
  scheme: string;
  username: string;
  password: string;
  hostname: string | undefined;
  port: string;
  path: string;
  opaque: boolean;
  query: string | undefined;
  fragment: string | undefined;
}

export function specialPort(scheme: string): string | undefined {
  if (scheme === "http" || scheme === "ws") return "80";
  if (scheme === "https" || scheme === "wss") return "443";
  if (scheme === "ftp") return "21";
  if (scheme === "file") return "";
  return undefined;
}

function alpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
function digit(code: number): boolean {
  return code >= 48 && code <= 57;
}
function hex(code: number): number {
  if (digit(code)) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

export function urlEncode(text: string, set: string): string {
  const bytes = encodeUTF8(text);
  const alphabet = "0123456789ABCDEF";
  let result = "";
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    if (byte === undefined) break;
    const char = String.fromCharCode(byte);
    if (set === "form" && byte === 32) result += "+";
    else if (
      set === "form"
        ? alpha(byte) || digit(byte) || "*-._".includes(char)
        : byte >= 32 && byte < 127 && !set.includes(char)
    )
      result += char;
    else
      result += "%" + alphabet.charAt(byte >> 4) + alphabet.charAt(byte & 15);
  }
  return result;
}

export function percentDecode(text: string, plus: boolean): string {
  const bytes = encodeUTF8(text);
  const output = new Uint8Array(bytes.length);
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i];
    if (value === undefined) break;
    if (value === 37 && i + 2 < bytes.length) {
      const a = hex(bytes[i + 1] ?? 0),
        b = hex(bytes[i + 2] ?? 0);
      if (a >= 0 && b >= 0) {
        output[count++] = a * 16 + b;
        i += 2;
        continue;
      }
    }
    output[count++] = value === 43 && plus ? 32 : value;
  }
  return (
    decodeUTF8(createUTF8Decoder(false, true), output.subarray(0, count)) ?? ""
  );
}

function ipv4Number(part: string): number {
  let base = 10,
    start = 0;
  if (part.length >= 2 && part.charAt(0) === "0") {
    if (part.charAt(1).toLowerCase() === "x") {
      base = 16;
      start = 2;
    } else {
      base = 8;
      start = 1;
    }
  }
  if (part.length === 0) return -1;
  let value = 0;
  for (let i = start; i < part.length; i++) {
    const digitValue = hex(part.charCodeAt(i));
    if (digitValue < 0 || digitValue >= base) return -1;
    value = value * base + digitValue;
  }
  return value;
}
function ipv4(host: string): string | undefined {
  const parts = host.split(".");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  const last = parts[parts.length - 1] ?? "";
  let decimal = last.length !== 0;
  for (let i = 0; i < last.length; i++)
    if (!digit(last.charCodeAt(i))) decimal = false;
  if (!decimal && ipv4Number(last) < 0) return host;
  if (parts.length > 4) return undefined;
  let result = 0;
  for (let i = 0; i < parts.length; i++) {
    const value = ipv4Number(parts[i] ?? "");
    const place = i === 0 ? 16777216 : i === 1 ? 65536 : i === 2 ? 256 : 1;
    if (value < 0) return undefined;
    if (i === parts.length - 1) {
      if (value >= 256 * place) return undefined;
      result += value;
    } else {
      if (value > 255) return undefined;
      result += value * place;
    }
  }
  return (
    String(result >>> 24) +
    "." +
    String((result >>> 16) & 255) +
    "." +
    String((result >>> 8) & 255) +
    "." +
    String(result & 255)
  );
}

function ipv6Pieces(text: string, withIPv4: boolean): number[] | undefined {
  const values: number[] = [];
  if (text === "") return values;
  const fields = text.split(":");
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index] ?? "";
    if (withIPv4 && index === fields.length - 1 && field.includes(".")) {
      const bytes = field.split(".");
      if (bytes.length !== 4) return undefined;
      let address = 0;
      for (const byte of bytes) {
        if (
          byte === undefined ||
          byte.length === 0 ||
          byte.length > 3 ||
          (byte.length > 1 && byte.charAt(0) === "0")
        )
          return undefined;
        for (let i = 0; i < byte.length; i++)
          if (!digit(byte.charCodeAt(i))) return undefined;
        const n = Number(byte);
        if (n > 255) return undefined;
        address = address * 256 + n;
      }
      values.push(address >>> 16, address & 65535);
    } else {
      if (field.length === 0 || field.length > 4) return undefined;
      let value = 0;
      for (let i = 0; i < field.length; i++) {
        const n = hex(field.charCodeAt(i));
        if (n < 0) return undefined;
        value = value * 16 + n;
      }
      values.push(value);
    }
  }
  return values;
}
function ipv6(text: string): string | undefined {
  const split = text.indexOf("::");
  const head = ipv6Pieces(split < 0 ? text : text.slice(0, split), split < 0);
  if (head === undefined) return undefined;
  if (split < 0 && head.length !== 8) return undefined;
  if (split >= 0) {
    const tail = ipv6Pieces(text.slice(split + 2), true);
    if (tail === undefined || head.length + tail.length >= 8) return undefined;
    while (head.length + tail.length < 8) head.push(0);
    for (const piece of tail) if (piece !== undefined) head.push(piece);
  }
  let longest = 1,
    best = -1,
    start = 0,
    size = 0;
  for (let i = 0; i < 8; i++) {
    if (head[i] === 0) {
      if (size === 0) start = i;
      if (++size > longest) {
        longest = size;
        best = start;
      }
    } else size = 0;
  }
  const chunks: string[] = [];
  for (const word of head) {
    let value = word ?? 0;
    let digits = "";
    do {
      digits = "0123456789abcdef".charAt(value & 15) + digits;
      value >>>= 4;
    } while (value !== 0);
    chunks.push(digits);
  }
  return (
    "[" +
    (best < 0
      ? chunks.join(":")
      : chunks.slice(0, best).join(":") +
        "::" +
        chunks.slice(best + longest).join(":")) +
    "]"
  );
}

/** RFC 3492 Bootstring encoding for a normalized non-ASCII label. */
function punycode(label: string): string {
  const codes: number[] = [];
  let result = "";
  for (let i = 0; i < label.length;) {
    const code = label.codePointAt(i) ?? 0;
    i += code > 65535 ? 2 : 1;
    codes.push(code);
    if (code < 128) result += String.fromCharCode(code);
  }
  let handled = result.length;
  const basic = handled;
  if (basic !== 0) result += "-";
  let next = 128,
    delta = 0,
    bias = 72;
  const letters = "abcdefghijklmnopqrstuvwxyz0123456789";
  while (handled < codes.length) {
    let minimum = 1114112;
    for (const code of codes)
      if (code !== undefined && code >= next && code < minimum) minimum = code;
    delta += (minimum - next) * (handled + 1);
    next = minimum;
    for (const code of codes) {
      if (code === undefined) continue;
      if (code < next) delta++;
      if (code !== next) continue;
      let q = delta;
      for (let k = 36; ; k += 36) {
        const t = Math.max(1, Math.min(26, k - bias));
        if (q < t) break;
        result += letters.charAt(t + ((q - t) % (36 - t)));
        q = Math.floor((q - t) / (36 - t));
      }
      result += letters.charAt(q);
      q = handled === basic ? Math.floor(delta / 700) : Math.floor(delta / 2);
      q += Math.floor(q / (handled + 1));
      let adjustment = 0;
      while (q > 455) {
        q = Math.floor(q / 35);
        adjustment += 36;
      }
      bias = adjustment + Math.floor((36 * q) / (q + 38));
      delta = 0;
      handled++;
    }
    delta++;
    next++;
  }
  return "xn--" + result;
}

const commonForbiddenHost = " #/:<>?@[\\]^|";
function domain(host: string): string | undefined {
  const text = mapURLDomain(percentDecode(host, false));
  if (text === undefined) return undefined;
  const output: string[] = [];
  for (const label of text.split(".")) {
    if (label === undefined) continue;
    let nonASCII = false;
    for (let i = 0; i < label.length; i++) {
      const code = label.charCodeAt(i);
      const c = label.charAt(i);
      if (
        code <= 32 ||
        code === 127 ||
        commonForbiddenHost.includes(c) ||
        c === "%"
      )
        return undefined;
      if (code >= 128) nonASCII = true;
    }
    if (nonASCII && !validURLLabel(label)) return undefined;
    output.push(nonASCII ? punycode(label) : label);
  }
  return ipv4(output.join("."));
}

export const userInfoEncodeSet = ' "#<>?`{}/:;=@[\\]^|';
const pathEncodeSet = ' "#<>?`{}^';
const fragmentEncodeSet = ' "<>`';
function encodeQuery(value: string, special: boolean): string {
  return urlEncode(value, special ? " \"#<>'" : ' "#<>');
}

function drive(path: string): boolean {
  return (
    path.length === 2 &&
    alpha(path.charCodeAt(0)) &&
    (path.charAt(1) === ":" || path.charAt(1) === "|")
  );
}
function schemeEnd(value: string): number {
  if (!alpha(value.charCodeAt(0))) return -1;
  for (let i = 1; i < value.length; i++) {
    const c = value.charAt(i),
      code = value.charCodeAt(i);
    if (c === ":") return i;
    if (!alpha(code) && !digit(code) && !"+-.".includes(c)) break;
  }
  return -1;
}

function newData(scheme: string): URLData {
  return {
    scheme,
    username: "",
    password: "",
    hostname: undefined,
    port: "",
    path: "",
    opaque: false,
    query: undefined,
    fragment: undefined,
  };
}
function copyURL(base: URLData): URLData {
  return {
    scheme: base.scheme,
    username: base.username,
    password: base.password,
    hostname: base.hostname,
    port: base.port,
    path: base.path,
    opaque: base.opaque,
    query: base.query,
    fragment: undefined,
  };
}

export function updateHost(
  data: URLData,
  input: string,
  hostnameOnly: boolean,
  setter: boolean = false,
): boolean {
  const special = specialPort(data.scheme) !== undefined;
  let host = input,
    port = "";
  let portPresent = false;
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close < 0) return false;
    if (close + 1 < host.length) {
      if (hostnameOnly || host.charAt(close + 1) !== ":") return false;
      portPresent = true;
      port = host.slice(close + 2);
      host = host.slice(0, close + 1);
    }
  } else {
    const colon = host.indexOf(":");
    if (colon >= 0) {
      if (hostnameOnly) return false;
      portPresent = true;
      port = host.slice(colon + 1);
      host = host.slice(0, colon);
    }
  }
  if (data.scheme === "file" && portPresent) return false;
  if (
    host === "" &&
    ((special && data.scheme !== "file") ||
      data.username !== "" ||
      data.password !== "" ||
      data.port !== "" ||
      portPresent)
  )
    return false;
  let normalized: string | undefined;
  if (host.startsWith("[")) normalized = ipv6(host.slice(1, -1));
  else if (special) normalized = domain(host);
  else {
    for (let i = 0; i < host.length; i++) {
      const c = host.charAt(i);
      if (
        commonForbiddenHost.includes(c) ||
        c === "\0" ||
        c === "\t" ||
        c === "\r" ||
        c === "\n"
      )
        return false;
    }
    normalized = urlEncode(host, "");
  }
  if (normalized === undefined) return false;
  if (special && host !== "" && normalized === "") return false;
  if (portPresent && port !== "") {
    if (setter) setPort(data, port);
    else if (!updatePort(data, port)) return false;
  }
  data.hostname =
    data.scheme === "file" && normalized === "localhost" ? "" : normalized;
  return true;
}

function updatePort(data: URLData, value: string): boolean {
  if (value === "") {
    data.port = "";
    return true;
  }
  let end = 0;
  while (end < value.length && digit(value.charCodeAt(end))) end++;
  if (end !== value.length) return false;
  const n = Number(value);
  if (n > 65535) return false;
  const text = String(n);
  data.port = specialPort(data.scheme) === text ? "" : text;
  return true;
}

export function setPort(data: URLData, value: string): void {
  let end = 0;
  while (end < value.length && digit(value.charCodeAt(end))) end++;
  if (end !== 0 || value === "") updatePort(data, value.slice(0, end));
}

function authority(data: URLData, text: string): boolean {
  const at = text.lastIndexOf("@");
  if (at < 0) return updateHost(data, text, false);
  if (data.scheme === "file") return false;
  const userInfo = text.slice(0, at);
  const colon = userInfo.indexOf(":");
  data.username = urlEncode(
    colon < 0 ? userInfo : userInfo.slice(0, colon),
    userInfoEncodeSet,
  );
  if (colon >= 0)
    data.password = urlEncode(userInfo.slice(colon + 1), userInfoEncodeSet);
  const host = text.slice(at + 1);
  return host !== "" && updateHost(data, host, false);
}

export function normalizePath(path: string, file: boolean): string {
  const parts = path.split("/");
  const output: string[] = [];
  if (path.startsWith("/")) output.push("");
  for (let i = output.length; i < parts.length; i++) {
    const part = parts[i] ?? "";
    const dot = part.toLowerCase().split("%2e").join(".");
    if (dot === "." || dot === "..") {
      if (
        dot === ".." &&
        output.length > 1 &&
        !(file && output.length === 2 && drive(output[1] ?? ""))
      )
        output.pop();
      if (i === parts.length - 1) output.push("");
    } else if (file && output.length === 1 && drive(part))
      output.push(part.charAt(0) + ":");
    else output.push(urlEncode(part, pathEncodeSet));
  }
  const joined = output.join("/");
  return joined === "" && path.startsWith("/") ? "/" : joined;
}

function clean(text: string): string {
  let start = 0,
    end = text.length;
  while (start < end && text.charCodeAt(start) <= 32) start++;
  while (end > start && text.charCodeAt(end - 1) <= 32) end--;
  return stripURLTabs(text.slice(start, end));
}
export function stripURLTabs(text: string): string {
  return text.split("\t").join("").split("\r").join("").split("\n").join("");
}

export function parseURL(
  input: string,
  base: URLData | undefined,
): URLData | undefined {
  const source = clean(input),
    colon = schemeEnd(source);
  const scheme =
    colon < 0 ? base?.scheme : source.slice(0, colon).toLowerCase();
  if (scheme === undefined) return undefined;
  const special = specialPort(scheme) !== undefined,
    file = scheme === "file";
  let body = colon < 0 ? source : source.slice(colon + 1);
  let query: string | undefined, fragment: string | undefined;
  const hash = body.indexOf("#");
  if (hash >= 0) {
    fragment = urlEncode(body.slice(hash + 1), fragmentEncodeSet);
    body = body.slice(0, hash);
  }
  const q = body.indexOf("?");
  if (q >= 0) {
    query = encodeQuery(body.slice(q + 1), special);
    body = body.slice(0, q);
  }
  if (special) body = body.split("\\").join("/");
  const relative =
    base !== undefined &&
    (colon < 0 ||
      (special && scheme === base.scheme && !body.startsWith("//")));
  if (relative && base !== undefined && base.opaque) {
    if (body !== "" || query !== undefined || fragment === undefined)
      return undefined;
    const data = copyURL(base);
    data.fragment = fragment;
    return data;
  }
  const data = relative && base !== undefined ? copyURL(base) : newData(scheme);
  if (body.startsWith("//") || (special && !file && !relative)) {
    let start = 2;
    if (special && !file) {
      start = 0;
      while (body.charAt(start) === "/") start++;
    }
    const slash = body.indexOf("/", start);
    const host = slash < 0 ? body.slice(start) : body.slice(start, slash);
    let path = slash < 0 ? "" : body.slice(slash);
    data.hostname = undefined;
    data.username = "";
    data.password = "";
    data.port = "";
    if (file && drive(host)) {
      data.hostname = "";
      path = "/" + host + path;
    } else if (!authority(data, host)) return undefined;
    data.path = normalizePath(path === "" && special ? "/" : path, file);
  } else if (relative && base !== undefined) {
    if (body === "") {
      data.query = query === undefined ? base.query : query;
      data.fragment = fragment;
      return data;
    }
    if (
      file &&
      drive(body.slice(0, 2)) &&
      (body.length === 2 || body.charAt(2) === "/")
    ) {
      data.path = normalizePath("/" + body, true);
    } else if (body.startsWith("/")) {
      const baseDrive = base.path.slice(1, 3);
      const prefix =
        file && drive(baseDrive) && !drive(body.slice(1, 3))
          ? "/" + baseDrive
          : "";
      data.path = normalizePath(prefix + body, file);
    } else {
      data.path = normalizePath(
        (base.path === "" && base.hostname !== undefined
          ? "/"
          : base.path.slice(0, base.path.lastIndexOf("/") + 1)) + body,
        file,
      );
    }
  } else if (file) {
    data.hostname = "";
    data.path = normalizePath(body.startsWith("/") ? body : "/" + body, true);
  } else if (body.startsWith("/")) {
    data.path = normalizePath(body, false);
  } else {
    data.opaque = true;
    data.path = urlEncode(body, "");
    if (
      (query !== undefined || fragment !== undefined) &&
      data.path.endsWith(" ")
    )
      data.path = data.path.slice(0, -1) + "%20";
  }
  data.query = query;
  data.fragment = fragment;
  return data;
}

export function serializeURL(data: URLData): string {
  let result = data.scheme + ":";
  const hostname = data.hostname;
  if (hostname !== undefined) {
    result += "//";
    if (data.username !== "" || data.password !== "")
      result +=
        data.username + (data.password !== "" ? ":" + data.password : "") + "@";
    result += hostname + (data.port !== "" ? ":" + data.port : "");
  } else if (!data.opaque && data.path.startsWith("//")) result += "/.";
  const query = data.query,
    fragment = data.fragment;
  return (
    result +
    data.path +
    (query === undefined ? "" : "?" + query) +
    (fragment === undefined ? "" : "#" + fragment)
  );
}

export function origin(data: URLData): string {
  if (data.scheme === "blob") {
    const inner = parseURL(data.path, undefined);
    if (
      inner === undefined ||
      (inner.scheme !== "http" && inner.scheme !== "https")
    )
      return "null";
    return origin(inner);
  }
  const special = specialPort(data.scheme);
  const host = data.hostname;
  if (special === undefined || data.scheme === "file" || host === undefined)
    return "null";
  return data.scheme + "://" + host + (data.port === "" ? "" : ":" + data.port);
}

export function setSearch(data: URLData, value: string): void {
  if (value === "") data.query = undefined;
  else
    data.query = encodeQuery(
      stripURLTabs(value.startsWith("?") ? value.slice(1) : value),
      specialPort(data.scheme) !== undefined,
    );
}
export function setHash(data: URLData, value: string): void {
  if (value === "") data.fragment = undefined;
  else
    data.fragment = urlEncode(
      stripURLTabs(value.startsWith("#") ? value.slice(1) : value),
      fragmentEncodeSet,
    );
}
export function setProtocol(data: URLData, value: string): void {
  const text = stripURLTabs(value) + ":";
  const end = schemeEnd(text);
  if (end < 0) return;
  const scheme = text.slice(0, end).toLowerCase();
  if (
    (specialPort(data.scheme) === undefined) !==
    (specialPort(scheme) === undefined)
  )
    return;
  if (
    scheme === "file" &&
    (data.username !== "" || data.password !== "" || data.port !== "")
  )
    return;
  if (data.scheme === "file" && data.hostname === "") return;
  data.scheme = scheme;
  if (specialPort(scheme) === data.port) data.port = "";
}

export interface URLParameter {
  readonly name: string;
  value: string;
}
export function readParameters(query: string | undefined): URLParameter[] {
  const pairs: URLParameter[] = [];
  if (query === undefined) return pairs;
  for (const part of query.split("&")) {
    if (part === undefined || part === "") continue;
    const equals = part.indexOf("=");
    pairs.push({
      name: percentDecode(equals < 0 ? part : part.slice(0, equals), true),
      value: equals < 0 ? "" : percentDecode(part.slice(equals + 1), true),
    });
  }
  return pairs;
}
export function serializeParameters(pairs: readonly URLParameter[]): string {
  let result = "";
  for (const pair of pairs) {
    if (pair !== undefined)
      result +=
        (result === "" ? "" : "&") +
        urlEncode(pair.name, "form") +
        "=" +
        urlEncode(pair.value, "form");
  }
  return result;
}
