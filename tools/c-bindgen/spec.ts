// Binding generator specs (docs/native-ffi.md, "Binding generator"): what
// one `tint:c/<library>` declaration module binds, read from the C headers
// by clang. A spec only selects declarations and states the binding choices
// C cannot express (borrowed views versus raw addresses, errno results,
// records C passes as words); every width, offset and constant comes from
// clang.
import {
  darwinArm64CTarget,
  linuxArm64CTarget,
  type CTarget,
} from "@tint/abi/c";
import { linuxX86_64CTarget } from "@tint/abi/c/sysv";

export type TargetName = "darwin-arm64" | "linux-arm64" | "linux-x86_64";
export const targetNames: readonly TargetName[] = [
  "darwin-arm64",
  "linux-arm64",
  "linux-x86_64",
];
export function cTargetOf(name: TargetName): CTarget {
  if (name === "linux-x86_64") return linuxX86_64CTarget;
  return name === "darwin-arm64" ? darwinArm64CTarget : linuxArm64CTarget;
}

/** How a C pointer parameter crosses the boundary:
 * - `Ptr`: a byte view the call borrows (the default, except for
 *   `const char *`);
 * - `Address`: a raw address C may keep (also an opaque function pointer);
 * - `CString`: a string copied NUL-terminated (the `const char *` default);
 * - `CStringBytes`: bytes that already end in NUL. */
export type PointerMode = "Ptr" | "Address" | "CString" | "CStringBytes";

export interface ParameterSpec {
  /** The TypeScript parameter name (default: the header's, else `argN`). */
  readonly name?: string;
  readonly as?: PointerMode;
  /** Point to this emitted record instead of the C pointee: a record of the
   * pointee's own layout, or an array of the C pointee (an out-parameter
   * such as `struct ifaddrs **` as a one-member record). */
  readonly pointee?: string;
  /** Pass a pointer-sized C value as this emitted record, which must
   * occupy exactly one general register like the C value (a `void *`
   * handle no number holds exactly, as two 32-bit halves). */
  readonly record?: string;
}

export interface ResultSpec {
  /** `OrErrno<T>`: a negative result becomes -errno. A pointer result is
   * read as `isize` (MAP_FAILED is -1). */
  readonly errno?: boolean;
  /** Ignore the C result (`void`). */
  readonly discard?: boolean;
  /** As for a parameter: the pointer-sized result as this record. */
  readonly record?: string;
}

export interface FunctionSpec {
  /** The C function (its symbol). */
  readonly name: string;
  /** Emit `name$variant`: another prototype of the same symbol. */
  readonly variant?: string;
  /** Parameter choices, keyed by index ("0") or header name. */
  readonly parameters?: Readonly<Record<string, ParameterSpec | PointerMode>>;
  readonly result?: ResultSpec | "OrErrno" | "void";
  /** For a variadic C function: the C types of this prototype's variadic
   * arguments (each passed after default promotion). Required for
   * variadic functions; `[]` binds the call shape with none. */
  readonly variadic?: readonly string[];
  /** The call class. By default a function is may-callback when an
   * argument hands C a record with callback members (directly, nested or
   * behind a pointer), since C may call them during the call; `leaf`
   * overrides that for functions documented never to call them. `async`
   * is Phase 5's (the declaration parser rejects it until then). */
  readonly callClass?: "leaf" | "may-callback" | "async";
  readonly doc?: string;
}

export interface RecordSpec {
  /** A struct/union tag or a typedef naming one; the interface's name. */
  readonly name: string;
  /** Export a `Layout<R>` constant (default true). */
  readonly layout?: boolean;
  /** Function-pointer members bound as opaque `Address<void>` instead of
   * their callback type (`type name = Callback<…>`, the typedef's name or
   * `<record>_<member>`). Members whose prototype no callback can express
   * are opaque anyway, and reported. */
  readonly opaque?: readonly string[];
  readonly doc?: string;
}

export interface AvailabilitySpec {
  readonly name: string;
  readonly function: string;
}

export interface BindingSpec {
  /** The module is `tint:c/<library>`; it must be in the C library
   * manifest (or a build's additions) to be compiled. */
  readonly library: string;
  /** Comment lines at the top of the module (what the library is, who
   * uses it). */
  readonly summary: readonly string[];
  readonly targets: readonly TargetName[];
  /** This spec's selected Linux declarations use the same LP64 data model
   * on arm64 and x86-64. Emit x86-64 choices from the Linux facts, with
   * any authored target marker constants specified here. */
  readonly linuxX86_64?: {
    readonly constants?: Readonly<Record<string, string>>;
  };
  /** Headers to include, for every target or per target. */
  readonly headers:
    | readonly string[]
    | Readonly<Partial<Record<TargetName, readonly string[]>>>;
  /** Preprocessor definitions (`-D`), e.g. feature-test macros. */
  readonly defines?: readonly string[];
  /** C declarations compiled after the headers: records Tint defines
   * itself (out-parameter holders, frames), so clang verifies them too. */
  readonly prelude?: string;
  /** Typedef names kept as `type` aliases (scalar typedefs only). */
  readonly aliases?: readonly string[];
  readonly records?: readonly (string | RecordSpec)[];
  readonly functions?: readonly (string | FunctionSpec)[];
  /** `#define`s and enumerators that evaluate to integers. */
  readonly constants?: readonly string[];
  /** Availability queries (`(): Available<"f">`). With `optional`, every
   * function without one gets `has<Name>`. */
  readonly availability?: readonly AvailabilitySpec[];
  readonly optional?: boolean;
}

export function recordSpec(item: string | RecordSpec): RecordSpec {
  return typeof item === "string" ? { name: item } : item;
}
export function functionSpec(item: string | FunctionSpec): FunctionSpec {
  return typeof item === "string" ? { name: item } : item;
}
export function headersFor(
  spec: BindingSpec,
  target: TargetName,
): readonly string[] {
  const headers = spec.headers;
  if (Array.isArray(headers)) return headers as readonly string[];
  return (
    (headers as Partial<Record<TargetName, readonly string[]>>)[target] ?? []
  );
}
/** The emitted TypeScript name of a function spec. */
export function exportedName(item: FunctionSpec): string {
  return item.variant === undefined
    ? item.name
    : item.name + "$" + item.variant;
}
