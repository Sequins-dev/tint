# @tint/foundation/text/text-encoding

UTF-8 implementation for Tint's native standard globals. Node-hosted builds continue
using Node's TextEncoder and TextDecoder. This package has no host dependencies.

`encodeUTF8` and `encodeUTF8Into` perform the standard scalar-value conversion,
including replacement of lone UTF-16 surrogates. Partial writes never split a scalar;
`read` counts UTF-16 code units and `written` counts bytes.

`createUTF8Decoder` and `decodeUTF8` implement the UTF-8 decoder state machine,
including streaming, malformed-sequence reconsumption, fatal errors and BOM handling.
The core returns undefined on fatal input. `createNativeTextDecoder` converts that
result into TypeError and rejects unsupported labels with RangeError.

`createNativeTextEncoder` and `createNativeTextDecoder` are factory implementations
for the native constructor registry. The current strict profile supports UTF-8 and
its standard aliases, string encoder inputs and Uint8Array decoder inputs. Other
encodings and broader Web IDL argument conversion are not implemented. Mutable
prototype behavior and cross-realm identity belong to the future live profile.

`encodeURIString` and `decodeURIString` provide ECMAScript percent encoding for
whole URIs or components, selected by the `component` boolean. They return an
explicit `malformed` result; JavaScript coercion and URIError creation belong to
the runtime adapter. They reuse TextEncoder/TextDecoder, reject unpaired surrogates
when encoding, decode UTF-8 strictly, preserve BOM code points and retain reserved
escape spelling for whole-URI decoding.

Tests compare output and streaming/error behavior against Node's standard globals.
The encoder, decoder core and factories also compile through Tint's native pipeline;
separate native fixtures verify actual execution. This does not establish native
compiler source-loading or self-hosting by itself.
