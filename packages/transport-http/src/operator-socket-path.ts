import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The longest socket path that fits `sun_path` on the platforms keelwerk runs on, with margin. */
const maxSocketPath = 100;

/** The path the operator socket is bound to: the configured one, or a short fallback when it is too long. */
export function operatorSocketPath(
  configured: string,
  uid: number,
  fallbackDirectory: string = join(tmpdir(), `keelwerk-${uid}`),
): string {
  if (Buffer.byteLength(configured) <= maxSocketPath) {
    return configured;
  }
  const digest = createHash('sha256').update(configured).digest('hex').slice(0, 16);
  return join(fallbackDirectory, `${digest}.sock`);
}
