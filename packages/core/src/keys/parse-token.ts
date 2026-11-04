const tokenPattern = /^([a-z][a-z0-9]{0,15})_([a-z2-7]{26})_([a-z2-7]{26,205})$/;

/** The parts of a token `<prefix>_<public id>_<secret>` (S-32). */
export interface ParsedToken {
  readonly prefix: string;
  readonly publicId: string;
  readonly secret: string;
}

/** Splits a presented token; `undefined` when it does not have the format (public id: 128 bits, 26 base32 characters). */
export function parseToken(token: string): ParsedToken | undefined {
  const match = tokenPattern.exec(token);
  if (match === null) return undefined;
  return { prefix: match[1] ?? '', publicId: match[2] ?? '', secret: match[3] ?? '' };
}
