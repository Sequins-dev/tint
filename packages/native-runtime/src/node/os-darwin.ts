import {
  loadAveragesSnapshot,
  networkInterfaces,
  userInfo,
  arch,
} from "./os-darwin-host.ts";

export { networkInterfaces, userInfo, arch };
export function loadavg(): number[] {
  const snapshot = loadAveragesSnapshot();
  return [snapshot.one, snapshot.five, snapshot.fifteen];
}
export const EOL = "\n";
export const devNull = "/dev/null";
export function machine(): string {
  return arch() === "arm64" ? "arm64" : "x86_64";
}
export function platform(): string {
  return "darwin";
}
export function type(): string {
  return "Darwin";
}
export function endianness(): string {
  return "LE";
}

const os = {
  loadavg,
  networkInterfaces,
  userInfo,
  EOL,
  devNull,
  arch,
  machine,
  platform,
  type,
  endianness,
};
export { os as default };
