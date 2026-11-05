import { chmodSync, mkdirSync } from 'node:fs';

/**
 * Creates `path` and the missing parents with mode 0700. The mode of `mkdir` is subject to the
 * umask, so a directory this call created is set to 0700 again; one that already exists is left
 * as it is (the operator socket listener refuses it when it is wider, section 16.9).
 */
export function makePrivateDirectory(path: string): void {
  const created = mkdirSync(path, { recursive: true, mode: 0o700 });
  if (created !== undefined) chmodSync(created, 0o700);
}
