import type { CustomNormalizer } from '../fields/personal-options.ts';
import type { NormalizerRef } from '../storage/normalizer-ref.ts';
import { caseless } from './normalizers/caseless.ts';
import { email } from './normalizers/email.ts';
import { exact } from './normalizers/exact.ts';
import { nfc } from './normalizers/nfc.ts';
import { unicodeVersion } from './unicode-version.ts';

const builtIn: readonly NormalizerEntry[] = [
  { id: 'exact', version: 1, normalize: exact },
  { id: 'nfc', version: 1, normalize: nfc },
  { id: 'caseless', version: 1, normalize: caseless },
  { id: 'email', version: 1, normalize: email },
];

/** A normaliser that can be applied: its identity and the pure function. */
export interface NormalizerEntry {
  readonly id: string;
  readonly version: number;
  readonly normalize: (value: string) => string;
}

/** The normalisers an app can name, with the Unicode version their tables follow (14.7.9.3). */
export interface NormalizerRegistry {
  /** The Unicode version of the runtime; an index records it, and `keelwerk doctor` warns on a mismatch. */
  readonly unicode: string;
  /** `undefined` for an id or version nobody registered. */
  resolve(ref: NormalizerRef): NormalizerEntry | undefined;
}

/** The registry of the four built-in normalisers plus the app's custom ones (id and version identify a normaliser). */
export function normalizerRegistry(custom: readonly CustomNormalizer[] = []): NormalizerRegistry {
  const entries = new Map<string, NormalizerEntry>();
  for (const entry of [...builtIn, ...custom]) entries.set(`${entry.id}@${entry.version}`, entry);
  return {
    unicode: unicodeVersion(),
    resolve: (ref) => entries.get(`${ref.id}@${ref.version}`),
  };
}
