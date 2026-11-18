import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("x86-64 encoder fixture requires TINT_BUILD_ONLY=1");

verifyHostedFixture(
  `import {encode, type Instruction} from '@tint/codegen/x86_64/isa';
export function run(): number {
  const instructions: Instruction[] = [
    {op:"label", name:"entry"},
    {op:"jcc", cc:"ne", target:{kind:"label", label:"end"}},
    {op:"mov", dst:{kind:"gpr", width:64, index:9}, src:{kind:"mem", width:64, address:{kind:"base", base:12, index:13, scale:2, disp:128}}},
    {op:"mov", dst:{kind:"gpr", width:8, index:4}, src:{kind:"imm8", value:255}},
    {op:"mov", dst:{kind:"gpr", width:64, index:0}, src:{kind:"imm64", value:{lo:0x76543210, hi:0xfedcba98}}},
    {op:"add", dst:{kind:"gpr", width:64, index:11}, src:{kind:"imm8", value:-128}},
    {op:"addsd", dst:{kind:"xmm", index:15}, src:{kind:"xmm", index:9}},
    {op:"mov", dst:{kind:"mem", width:32, address:{kind:"rip", disp:{kind:"label", label:"entry", addend:1}}}, src:{kind:"imm32", value:123}},
    {op:"call", target:{kind:"label", label:"entry"}},
    {op:"label", name:"end"},
    {op:"ret"}
  ];
  const actual = encode(instructions);
  const expected: number[] = [
    0x0f,0x85,0x2d,0,0,0,
    0x4f,0x8b,0x8c,0x6c,0x80,0,0,0,
    0x40,0xb4,0xff,
    0x48,0xb8,0x10,0x32,0x54,0x76,0x98,0xba,0xdc,0xfe,
    0x49,0x83,0xc3,0x80,
    0xf2,0x45,0x0f,0x58,0xf9,
    0xc7,0x05,0xd3,0xff,0xff,0xff,0x7b,0,0,0,
    0xe8,0xcd,0xff,0xff,0xff,
    0xc3
  ];
  if (actual.length !== expected.length) return 1;
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) return 100 + i;
  }
  return 42;
}`,
  "x64-encoder",
  [["@tint/codegen/x86_64/isa", "packages/codegen/src/x86_64/isa.ts"]],
  [],
  [],
  [],
  { managedBytes: 4194304, allocationCapacity: 65536, requireTyped: true },
);
