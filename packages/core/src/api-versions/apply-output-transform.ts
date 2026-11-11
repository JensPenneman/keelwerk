import type { ActionEntry } from '../registry/action-entry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import { applyTransform } from './apply-transform.ts';
import { maskedView } from './masked-view.ts';
import type { Translator } from './translator.ts';

/**
 * Runs one custom output transform (section 16.4.5). The transform gets the shaped value in which
 * no row holds a masked member (`maskedView`); `$masked` stays readable on each row, so its author
 * can tell "hidden" from "not set". What the transform answers is taken as it is: which members it
 * read decides nothing. The mechanical part that follows names an older member that is absent or
 * undefined in `$masked` (`mechanicalOutput`).
 */
export function applyOutputTransform(
  change: VersionChangeEntry,
  action: ActionEntry,
  transform: Translator,
  value: unknown,
): Readonly<Record<string, unknown>> {
  return applyTransform(change, action.ref, 'output', transform, maskedView(value));
}
