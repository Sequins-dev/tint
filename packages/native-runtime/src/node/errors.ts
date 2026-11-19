/** Native layouts for Node-produced errors. The realm bridge attaches a
 * cached error view only when the value crosses into JavaScript. */
export interface NativeCodedError {
  readonly message: string;
  readonly code: string;
  readonly errno?: number;
}
export interface NativeCodedRangeError {
  readonly message: string;
  readonly code: string;
  readonly rangeErrorCodeFirst: boolean;
}
export interface SystemErrorInfo {
  errno: number;
  code: string;
  message: string;
  syscall: string;
}
export interface NativeSystemError {
  readonly message: string;
  readonly code: string;
  readonly info: SystemErrorInfo;
}

export function codedError(
  message: string,
  code: string,
  errno?: number,
): NativeCodedError {
  if (errno === undefined) return { message, code };
  return { message, code, errno };
}

export function codedRangeError(
  message: string,
  code: string,
): NativeCodedRangeError {
  return { message, code, rangeErrorCodeFirst: code === "ERR_OUT_OF_RANGE" };
}

export function systemError(
  syscall: string,
  errno: number,
  code: string,
  text: string,
): NativeSystemError {
  const info: SystemErrorInfo = { errno, code, message: text, syscall };
  return {
    message:
      "A system error occurred: " +
      syscall +
      " returned " +
      code +
      " (" +
      text +
      ")",
    code: "ERR_SYSTEM_ERROR",
    info,
  };
}
