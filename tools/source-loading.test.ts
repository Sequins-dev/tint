import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { publishFile, readFile } from "@tint/platform/files/service";
import { createSourceText } from "@tint/source/text";
import { createNodeFileHost } from "./node-file-host.ts";
test("file services and source text compose without sharing filesystem policy", () => {
  const dir = mkdtempSync(join(tmpdir(), "tint-source-"));
  try {
    const path = join(dir, "source.ts"),
      text = "\ufeff// 🙂\r\nconst café = 42;\u2028",
      bytes = new TextEncoder().encode(text),
      host = createNodeFileHost();
    assert.equal(publishFile(host, path, bytes, false).ok, true);
    const loaded = readFile(host, path, bytes.length);
    assert.equal(loaded.ok, true);
    const source = createSourceText(loaded.value, bytes.length);
    assert.equal(source.ok, true);
    const offset = text.indexOf("café"),
      byte = new TextEncoder().encode(text.slice(0, offset)).length;
    assert.deepEqual(source.value.byteToUtf16(byte), {
      ok: true,
      value: offset,
    });
    assert.deepEqual(source.value.positionAt(offset), {
      ok: true,
      value: { line: 2, column: 7 },
    });
    writeFileSync(path, "changed");
    loaded.value.fill(0);
    assert.equal(source.value.text, text);
    assert.equal(
      createHash("sha256").update(source.value.copyBytes()).digest("hex"),
      createHash("sha256").update(bytes).digest("hex"),
    );
    writeFileSync(path, new Uint8Array([65, 0xf0, 0x90]));
    const malformed = readFile(host, path, 10);
    assert.equal(malformed.ok, true);
    assert.deepEqual(createSourceText(malformed.value, 10), {
      ok: false,
      error: { kind: "invalid-utf8", byteOffset: 3, sequenceStart: 1 },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
