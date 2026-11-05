# @tint/foundation/text/string-builder

Balanced accumulation of immutable JavaScript strings. No encoding, host, or
compiler dependencies. `appendString` merges runs of equal append counts; each
code unit is copied at most logarithmically many times, even with flat native
strings. `finishString` returns a reusable snapshot without consuming state.

The builder retains at most logarithmically many partial strings. Callers own its
state exclusively and must not mutate `parts` directly. Empty appends do nothing;
unpaired surrogates and chunk boundaries preserve exact UTF-16 code units.
