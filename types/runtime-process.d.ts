declare module "node:process" {
  export const argv: string[];
  export const argv0: string;
  export const arch: string;
  export const platform: string;
  export const pid: number;
  export function cwd(): string;
  export function uptime(): number;
  export function nextTick<Args extends unknown[]>(
    callback: (...args: Args) => void,
    ...args: Args
  ): void;
  const process: {
    argv: typeof argv;
    argv0: typeof argv0;
    arch: typeof arch;
    platform: typeof platform;
    pid: typeof pid;
    exitCode: number | undefined;
    cwd: typeof cwd;
    uptime: typeof uptime;
    nextTick: typeof nextTick;
  };
  export default process;
}
