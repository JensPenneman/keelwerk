import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import { isMemberRecord } from './is-member-record.ts';
import type { Translator } from './translator.ts';
import { versionChangeFailure } from './version-change-failure.ts';

/**
 * Runs one custom transform of a change on the value of the action at `ref`. A transform that
 * throws, or that does not return an object, is `core.version_change_failed`.
 */
export function applyTransform(
  change: VersionChangeEntry,
  ref: string,
  direction: 'input' | 'output',
  transform: Translator,
  value: unknown,
): Readonly<Record<string, unknown>> {
  let result: unknown;
  try {
    result = transform(value);
  } catch (cause) {
    throw versionChangeFailure({
      change: change.id,
      action: ref,
      direction,
      message: `The ${direction} transform of "${change.id}" for "${ref}" failed.`,
      cause,
    });
  }
  if (!isMemberRecord(result)) {
    throw versionChangeFailure({
      change: change.id,
      action: ref,
      direction,
      message: `The ${direction} transform of "${change.id}" for "${ref}" did not return an object.`,
    });
  }
  return result;
}
