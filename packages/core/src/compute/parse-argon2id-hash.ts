import type { Argon2idParams } from './argon2id-params.ts';

const pattern = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** A parsed PHC string. */
export interface ParsedArgon2id {
  readonly params: Argon2idParams;
  readonly salt: Uint8Array;
  readonly tag: Uint8Array;
}

/** Parses the PHC string `argon2idHash` writes; `undefined` for anything else or for parameters out of sane bounds. */
export function parseArgon2idHash(phc: string): ParsedArgon2id | undefined {
  const match = pattern.exec(phc);
  if (match === null) return undefined;
  const memoryKib = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  const salt = new Uint8Array(Buffer.from(match[4] ?? '', 'base64'));
  const tag = new Uint8Array(Buffer.from(match[5] ?? '', 'base64'));
  if (
    memoryKib < 8 * parallelism ||
    memoryKib > 4_194_304 ||
    passes < 1 ||
    passes > 64 ||
    parallelism < 1 ||
    parallelism > 64 ||
    salt.length < 16 ||
    tag.length < 16 ||
    tag.length > 64
  ) {
    return undefined;
  }
  return { params: { memoryKib, passes, parallelism, tagLength: tag.length }, salt, tag };
}
