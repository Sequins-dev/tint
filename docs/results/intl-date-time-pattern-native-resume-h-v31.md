# DateTimeFormat pattern core — compile-only; native pending

The hosted parser/matcher/interval fixture compiled on frozen v31. Signature and
DWARF verify for both the hosted image and prepared compiler; all 588 frozen
compiler source copies match. Gates pass 4707/4707. No native execution or
stage-image equality is claimed. Public DateTimeFormat is a later slice.

After HOST AUTHORIZATION RESTORED, use the guarded original scripts in
.tint-bootstrap, with direct launch and
heartbeat30000/stall150000:
- observe-hosted-date-time-pattern-direct-h-v31.mjs: verifies captured image/source
  hashes and requires expected initial stop and final exit42.
- intl-date-time-pattern-selfbuild-resume-driver-h-v31.mjs: use slot selfbuild 2;
  verifies native stage comparison, signature, DWARF and smoke execution.

Archive copies in docs/results preserve the scripts. Relative frozen imports are
intended to execute from the original .tint-bootstrap copies. Native measurement
of the public DateTimeFormat selection follows its full adapter implementation.
