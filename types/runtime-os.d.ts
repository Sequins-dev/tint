declare module "node:os" {
  export interface UserInfo {
    uid: number;
    gid: number;
    username: string;
    homedir: string;
    shell: string | null;
  }
  export interface NetworkInterfaceInfo {
    address: string;
    netmask: string;
    family: string;
    mac: string;
    internal: boolean;
    cidr: string | null;
    scopeid?: number;
  }
  export const EOL: "\n";
  export const devNull: "/dev/null";
  export function arch(): "arm64" | "x64";
  export function machine(): string;
  export function platform(): "darwin" | "linux";
  export function type(): "Darwin" | "Linux";
  export function endianness(): "LE";
  export function loadavg(): [number, number, number];
  export function userInfo(): UserInfo;
  export function networkInterfaces(): Record<
    string,
    NetworkInterfaceInfo[] | undefined
  >;
  const os: {
    EOL: typeof EOL;
    devNull: typeof devNull;
    arch: typeof arch;
    machine: typeof machine;
    platform: typeof platform;
    type: typeof type;
    endianness: typeof endianness;
    loadavg: typeof loadavg;
    userInfo: typeof userInfo;
    networkInterfaces: typeof networkInterfaces;
  };
  export default os;
}
