# @tint/native-runtime/intrinsics/random

Explicit native host entropy capability. `randomUint32()` requires a caller-granted
`random-word` binding and returns an unsigned 32-bit integer. Without that binding
it throws `HOST_UNAVAILABLE`; bootstrap Node does not supply a hidden fallback.

`randomNumber()` combines two independent words into a uniform 53-bit grid in
[0,1). Each call draws fresh host entropy, including across separate realms. It
can be supplied to the ordinary-object Math installer without coupling the object
model to a platform API. This is a Math.random provider, not a Web Crypto API.

The initial Darwin backend calls `arc4random`. The symbol belongs to the target
host ABI so later Linux/Windows adapters can supply their own entropy operation.
The unsigned word-to-double conversion must preserve the high bit. Neither C
source generation nor a platform linker is involved.
