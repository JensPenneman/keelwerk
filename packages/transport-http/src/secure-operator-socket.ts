import { chmod } from 'node:fs/promises';

/** Restricts the bound socket file to its owner (mode 0600). */
export async function secureOperatorSocket(path: string): Promise<void> {
  await chmod(path, 0o600);
}
