import process from 'node:process';

/** The Unicode version the runtime's string tables follow; each blind index records it (14.7.9.3). */
export function unicodeVersion(): string {
  return process.versions.unicode ?? 'unknown';
}
