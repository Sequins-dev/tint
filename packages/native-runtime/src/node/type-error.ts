/** Native layout for a TypeError with a Node error code. */
export interface NativeCodedTypeError {
  readonly message: string;
  readonly code: string;
}

export function codedTypeError(
  message: string,
  code: string,
): NativeCodedTypeError {
  return { message, code };
}
