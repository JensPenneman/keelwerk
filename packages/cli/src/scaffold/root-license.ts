import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The `license` of `<cwd>/package.json` when it is a non-empty string; undefined otherwise or when unreadable. */
export function rootLicense(cwd: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      readonly license?: unknown;
    };
    return typeof manifest.license === 'string' && manifest.license.trim() !== ''
      ? manifest.license
      : undefined;
  } catch {
    return undefined;
  }
}
