import { v7 } from 'uuid';

/** A fresh UUIDv7 (RFC 9562) in its canonical lower-case form; the one place ids are minted. */
export function newUuidV7(): string {
  return v7();
}
