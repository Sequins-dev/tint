/** Node errors retain the standard error prototype and an enumerable code. */
export type NodeErrorCode =
  | "ABORT_ERR"
  | "ERR_AMBIGUOUS_ARGUMENT"
  | "ERR_INVALID_ARG_TYPE"
  | "ERR_INVALID_ARG_VALUE"
  | "ERR_INVALID_RETURN_VALUE"
  | "ERR_UNKNOWN_ENCODING"
  | "ERR_PARSE_ARGS_UNKNOWN_OPTION"
  | "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL"
  | "ERR_PARSE_ARGS_INVALID_OPTION_VALUE"
  | "ERR_FALSY_VALUE_REJECTION"
  | "ERR_INVALID_FILE_URL_HOST"
  | "ERR_INVALID_FILE_URL_PATH"
  | "ERR_INVALID_URL_SCHEME"
  | "ERR_MISSING_ARGS"
  | "ERR_OUT_OF_RANGE"
  | "ERR_UNHANDLED_ERROR";

export function codedError<Failure extends Error, Code extends NodeErrorCode>(
  error: Failure,
  code: Code,
): Failure & { code: Code } {
  return Object.assign(error, { code });
}

export function invalidArgument(
  name: string,
  expected: string,
  value: unknown,
) {
  let received: string;
  if (value === null || value === undefined) received = String(value);
  else if (typeof value === "object") received = "an instance of Object";
  else received = "type " + typeof value + " (" + String(value) + ")";
  return codedError(
    new TypeError(
      'The "' +
        name +
        '" argument must be ' +
        expected +
        ". Received " +
        received,
    ),
    "ERR_INVALID_ARG_TYPE",
  );
}

export function outOfRange(name: string, range: string, value: number) {
  return codedError(
    new RangeError(
      'The value of "' +
        name +
        '" is out of range. It must be ' +
        range +
        ". Received " +
        String(value),
    ),
    "ERR_OUT_OF_RANGE",
  );
}

export function abortError(reason: unknown) {
  const error = codedError(
    new Error("The operation was aborted", { cause: reason }),
    "ABORT_ERR",
  );
  error.name = "AbortError";
  return error;
}
