import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import { isKweEnvelope } from './is-kwe-envelope.ts';

function sealed(value: unknown): boolean {
  return (
    isKweEnvelope(value) || (typeof value === 'string' && parseSealedValueText(value) !== undefined)
  );
}

/**
 * Lines a re-decided payload up with the recorded one where the record holds a sealed value (a
 * personal envelope, or the `kwv1` text of a credential): a sealed value is compared by presence
 * and key, never by ciphertext, because every sealing draws a fresh nonce. Where the record is
 * sealed and the re-decided value is present, the result carries the recorded value; everything
 * else is the re-decided payload unchanged.
 */
export function alignSealedValues(recorded: unknown, redecided: unknown): unknown {
  if (sealed(recorded)) {
    return redecided === undefined || redecided === null ? redecided : recorded;
  }
  if (Array.isArray(redecided)) {
    const was: readonly unknown[] = Array.isArray(recorded) ? recorded : [];
    return redecided.map((member, index) => alignSealedValues(was[index], member));
  }
  if (typeof redecided === 'object' && redecided !== null) {
    const was: Readonly<Record<string, unknown>> =
      typeof recorded === 'object' && recorded !== null && !Array.isArray(recorded)
        ? (recorded as Readonly<Record<string, unknown>>)
        : {};
    return Object.fromEntries(
      Object.entries(redecided).map(([name, member]) => [
        name,
        alignSealedValues(was[name], member),
      ]),
    );
  }
  return redecided;
}
