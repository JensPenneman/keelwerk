import { createHash } from 'node:crypto';
import { canonicalizeJson } from '@keelwerk/core';

/** The SHA-256 of a text as 64 lower-case hexadecimal characters. */
export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * The plain SHA-256 form of the input of a command that 0.1.0 stored in the receipt and in the
 * meta of every event: no key, the password or the address inside.
 */
export const plainFingerprint = (action: string, apiVersion: string, input: unknown): string =>
  sha256Hex(canonicalizeJson({ action, apiVersion, input }));
