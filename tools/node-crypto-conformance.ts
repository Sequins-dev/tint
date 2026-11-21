// Extract the approved crypto cases from a checksum-verified Node source tree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import manifest from "./node-crypto-cases.json" with { type: "json" };

type Span = readonly number[];
interface Case {
  name: string;
  ranges: readonly Span[];
  setup?: string;
  after?: string;
  tail?: readonly Span[];
}

export function extractCryptoCases(root: string) {
  return Object.entries(manifest.files).flatMap(([file, entry]) => {
    const path = resolve(root, "test/parallel", file);
    const bytes = readFileSync(path);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256,
      path,
    );
    const lines = bytes.toString("utf8").split("\n");
    function extract(spans: readonly Span[]): string {
      return spans
        .map(([first, last]) => {
          assert.ok(
            first && last && first <= last && last < lines.length,
            path,
          );
          return lines.slice(first - 1, last).join("\n");
        })
        .join("\n");
    }
    return entry.cases.map((selection: Case) => ({
      file,
      path,
      name: selection.name,
      ranges: [...selection.ranges, ...(selection.tail ?? [])],
      source: [
        selection.setup,
        extract(selection.ranges),
        selection.after,
        extract(selection.tail ?? []),
      ]
        .filter((fragment) => fragment !== undefined)
        .join("\n"),
    }));
  });
}

if (import.meta.main) {
  const [root, oracle] = process.argv.slice(2);
  assert.ok(
    root && oracle,
    "Usage: node tools/node-crypto-conformance.ts <node-source> <node-oracle>",
  );
  const version = spawnSync(oracle, ["--version"], { encoding: "utf8" });
  assert.equal(version.stdout.trim(), "v" + manifest.version);
  const cases = extractCryptoCases(root);
  const results = cases.map(({ file, path, name, ranges, source }) => {
    const prelude = `
      const assert = require('node:assert/strict');
      const crypto = require('node:crypto');
      const common = require('../common');
      const { hasFIPS } = require('../common/crypto');
    `;
    const bootstrap = `
      import { createRequire } from 'node:module';
      const require = createRequire(process.argv[1]);
      new Function('require', process.argv[2])(require);
    `;
    const child = spawnSync(
      oracle,
      [
        "--input-type=module",
        "-e",
        bootstrap,
        path,
        '"use strict";\n' + prelude + "\n" + source,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    return {
      file,
      name,
      ranges,
      exit: child.status,
      ...(child.status === 0
        ? {}
        : { stderr: child.stderr, error: child.error?.message }),
    };
  });
  const passed = results.filter(({ exit }) => exit === 0).length;
  console.log(
    JSON.stringify(
      {
        version: manifest.version,
        selected: results.length,
        passed,
        results,
        outside: Object.fromEntries(
          Object.entries(manifest.files).map(([file, entry]) => [
            file,
            entry.outside,
          ]),
        ),
      },
      null,
      2,
    ),
  );
  process.exitCode = Number(passed !== results.length);
}
