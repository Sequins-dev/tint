# Native process arguments

A finite startup capability surface: argument count, UTF-8 byte length, and byte
copy into a caller-supplied Uint8Array. Bytes exclude the terminating NUL. Invalid
indices or undersized destinations return -1. Text decoding and CLI policy belong
to callers, using the standard TextDecoder global.

The compiler caller must authorize these leaves; Node execution of the stub bodies
throws `HOST_UNAVAILABLE`. Native code reads argc/argv from startup's runtime
context and uses the platform string/copy boundary. This is not a Node process
module implementation. Environment variables, subprocesses and an event loop are
outside the current surface.
