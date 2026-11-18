import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { pinCopies } from './pin-copies.ts';
import type { PinCopy } from './pin-copy.ts';
import type { PinDrift } from './pin-drift.ts';
import { readPinSources } from './read-pin-sources.ts';

interface Found {
  readonly values: readonly string[];
  readonly spans: readonly (readonly [number, number])[];
}

function find(text: string, pattern: RegExp): Found {
  const values: string[] = [];
  const spans: (readonly [number, number])[] = [];
  for (const match of text.matchAll(pattern)) {
    const span = match.indices?.[1];
    const value = match[1];
    if (span === undefined || value === undefined) continue;
    values.push(value);
    spans.push([span[0], span[1]]);
  }
  return { values, spans };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  try {
    if (process.argv.includes('--check')) {
      const drifts = syncPins(root, false);
      if (drifts.length === 0) {
        const files = new Set(pinCopies.map((copy) => copy.file)).size;
        const copies = pinCopies.reduce((sum, copy) => sum + copy.count, 0);
        process.stdout.write(`${copies} pinned copies in ${files} files follow their sources\n`);
      } else {
        for (const drift of drifts) {
          const row = pinCopies.find(
            (copy) => copy.file === drift.file && copy.source === drift.source,
          );
          const found = drift.found.length === 0 ? 'no copy' : drift.found.join(', ');
          const count =
            row !== undefined && row.count !== drift.found.length
              ? ` (expected ${row.count} copies)`
              : '';
          process.stderr.write(
            `${drift.file}: ${drift.source} is ${drift.expected} in its source, found ${found}${count}\n`,
          );
        }
        process.stderr.write('run pnpm pins to write them\n');
        process.exitCode = 1;
      }
    } else {
      const drifts = syncPins(root, true);
      const files = [...new Set(drifts.map((drift) => drift.file))];
      if (files.length === 0) process.stdout.write('every pinned copy follows its source\n');
      for (const file of files) process.stdout.write(`wrote ${file}\n`);
    }
  } catch (error) {
    // A stale pattern or an unreadable source is a message for the maintainer, not a stack trace.
    process.stderr.write(`pins: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

/**
 * Compares every copy of `copies` under `root` with `readPinSources(root)` and returns one drift
 * per row whose captures differ from the source or whose match count differs from the row's
 * count, in table order. With `write` true it then rewrites the captured text of every drifting
 * row (only the bytes of capture group 1, by `match.indices[1]`; every other byte kept) and writes
 * only files whose text changed. Throws, before writing anything, when a drift has a count
 * mismatch (a stale pattern cannot be written). Throws the Error of readPinSources, or the read
 * error of a missing file. Returns the drifts found before writing.
 */
export function syncPins(
  root: string,
  write: boolean,
  copies: readonly PinCopy[] = pinCopies,
): readonly PinDrift[] {
  const sources = readPinSources(root);
  const texts = new Map<string, string>();
  const drifts: PinDrift[] = [];
  const edits: { copy: PinCopy; expected: string }[] = [];
  const mismatched: string[] = [];
  for (const copy of copies) {
    let text = texts.get(copy.file);
    if (text === undefined) {
      text = readFileSync(join(root, copy.file), 'utf8');
      texts.set(copy.file, text);
    }
    const expected = sources[copy.source];
    const { values } = find(text, copy.pattern);
    const countOk = values.length === copy.count;
    if (countOk && values.every((value) => value === expected)) continue;
    drifts.push({ file: copy.file, source: copy.source, expected, found: values });
    if (countOk) edits.push({ copy, expected });
    else
      mismatched.push(
        `${copy.file}: ${copy.source} found ${values.length}, expected ${copy.count}`,
      );
  }
  if (write) {
    if (mismatched.length > 0) {
      throw new Error(
        `a pattern no longer matches its copies, nothing was written (${mismatched.join('; ')})`,
      );
    }
    const byFile = new Map<string, string>();
    for (const { copy, expected } of edits) {
      let text = byFile.get(copy.file) ?? texts.get(copy.file) ?? '';
      // An earlier row of the same file may have moved the offsets: find the spans again.
      for (const [start, end] of [...find(text, copy.pattern).spans].reverse()) {
        text = text.slice(0, start) + expected + text.slice(end);
      }
      byFile.set(copy.file, text);
    }
    for (const [file, text] of byFile) {
      if (text !== texts.get(file)) writeFileSync(join(root, file), text);
    }
  }
  return drifts;
}
