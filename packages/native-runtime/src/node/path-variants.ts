import { createPath } from "./path-core.ts";
import { currentDirectory } from "./path-cwd.ts";

// The supported hosts use POSIX current directories. Windows parsing remains
// available independently of the host's path convention.
export const posix = createPath(false, currentDirectory);
export const win32 = createPath(true, currentDirectory);
posix.posix = posix;
posix.win32 = win32;
win32.posix = posix;
win32.win32 = win32;
