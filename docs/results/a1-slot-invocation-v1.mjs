import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
export function spawnSlot(sharedWrapper, args, options = {}) {
  const directory = resolve('.tint-bootstrap/a1-slot-invocations');
  mkdirSync(directory, { recursive: true });
  const bytes = readFileSync(sharedWrapper);
  const snapshot = join(directory, randomUUID() + '.zsh');
  writeFileSync(snapshot, bytes, { flag: 'wx', mode: 0o500 });
  execFileSync('/bin/zsh', ['-n', snapshot]);
  const child = spawn(snapshot, args, options);
  child.tintSlotSnapshot = { origin: sharedWrapper, path: snapshot, sha256: createHash('sha256').update(bytes).digest('hex') };
  return child;
}
