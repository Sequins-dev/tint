# Foundation

Portable algorithms with explicit, independently reachable entrypoints.

- `@tint/foundation/binary/word64`: exact unsigned 64-bit words using two 32-bit halves, with checked arithmetic and safe-integer conversion.
- `@tint/foundation/binary/bytes`: checked integer and word reads/writes, alignment, and IEEE binary16/binary32/binary64 conversion.
- `@tint/foundation/binary/sha256`: portable SHA-256 hashing over byte arrays.

These modules have no host dependencies. SHA compression is private implementation detail.

Collection entrypoints provide reusable indices, maps, sets, lists and sorting:

- `@tint/foundation/collections/key-index`
- `@tint/foundation/collections/linked-map`
- `@tint/foundation/collections/linked-set`
- `@tint/foundation/collections/sparse-list`
- `@tint/foundation/collections/number-list`
- `@tint/foundation/collections/indexed-sort`
- `@tint/foundation/collections/list-sort`

Each entrypoint retains its own source graph. Runtime provider namespaces remain
independent from package ownership. Sorting adapters are private implementation
modules. List APIs distinguish absent indexed properties from stored undefined.

Additional generic kernels remain independent of compiler IR:

- `@tint/foundation/binary/word-buffer`: paged uint32 storage with bounded patching.
- `@tint/foundation/graph/dataflow`: a bounded monotone graph worklist solver; incomplete results do not establish facts.
- `@tint/foundation/collections/bit-vector`: finite-set bit operations and windowed intersections/copies.

Numeric algorithms remain independent entrypoints, with their preserved contracts:

- [Big integers](docs/numeric/big-integer.md): `@tint/foundation/numeric/big-integer`.
- [Integer rounding](docs/numeric/integer-rounding.md): `@tint/foundation/numeric/integer-rounding`.
- [Exact summation](docs/numeric/exact-sum.md): `@tint/foundation/numeric/exact-sum`.
- [Numeric text](docs/numeric/number-text.md): `@tint/foundation/numeric/number-text`.
- [Binary64 trigonometry](docs/numeric/binary64-trigonometry.md): `@tint/foundation/numeric/binary64-trigonometry`.

Decimal conversion/formatting and trigonometric constants are private modules.
The numeric text runtime helper namespace remains `number-text`.

Text algorithms have separate public entries:

- [Scanner](docs/text/text-scanner/README.md): `@tint/foundation/text/text-scanner`.
- [String builder](docs/text/string-builder/README.md): `@tint/foundation/text/string-builder`.
- [Text encoding](docs/text/text-encoding/README.md): `@tint/foundation/text/text-encoding`.
- Base encodings: `@tint/foundation/text/base-encoding`.
- [JSON syntax](docs/text/json-syntax/README.md): `@tint/foundation/text/json-syntax`.

The native text factory namespace remains `text-encoding`; host bindings and
standard TextEncoder/TextDecoder contracts are independent of package ownership.

Unicode 17 algorithms remain independent public entries:

- [Identifier properties](docs/unicode/identifiers.md): `@tint/foundation/unicode/identifiers`.
- [Character properties](docs/unicode/properties.md): `@tint/foundation/unicode/properties`.
- [Full casing](docs/unicode/casing.md): `@tint/foundation/unicode/casing`.

The generated tables retain their original bytes and headers. Their current
[Unicode data license](docs/unicode/LICENSE-UNICODE.txt) accompanies the preserved
contracts; ordinary builds do not regenerate tables or fetch Unicode inputs.

Layout, RegExp and calendar/time algorithms use the same foundation owner:

| Entry                                           | Responsibility                                   |
| ----------------------------------------------- | ------------------------------------------------ |
| `@tint/foundation/layout`                       | Target-parameterized storage layout planning     |
| `@tint/foundation/regexp/syntax`                | RegExp grammar, flags and Unicode alias data     |
| `@tint/foundation/regexp/engine`                | RegExp compilation and matching                  |
| `@tint/foundation/chrono/gregorian-calendar`    | Gregorian date arithmetic                        |
| `@tint/foundation/chrono/iso-date-time`         | ISO date/time parsing and arithmetic             |
| `@tint/foundation/chrono/temporal-duration`     | Duration parsing, balancing and rounding         |
| `@tint/foundation/chrono/tzif`                  | TZif data parsing and zone-transition algorithms |
| `@tint/foundation/chrono/time-zone-identifiers` | Time-zone identifier grammar                     |

These algorithms accept data; host filesystem access and runtime object adapters
remain with their callers. RegExp syntax does not depend on the matching engine.
The preserved module documentation and licenses live under `docs/regexp`,
`docs/chrono` and `docs/layout`.
