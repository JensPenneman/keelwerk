import { hidesMemberAt } from '../fields/hides-member-at.ts';
import type { MarkedField, MarkSite } from '../fields/mark-types.ts';

/**
 * Replaces the value of every member that is `.hidden()` or holds a mark `site` does not refuse
 * (personal, secret, verifier: `hidesMemberAt`, a list of secrets included) with a marker, so
 * explain output never shows what the fields keep out of reads (section 16.11.3). Names that are no
 * field stay.
 */
export function redactKeys(
  site: MarkSite,
  fields: Readonly<Record<string, MarkedField>>,
  value: unknown,
): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const redacted: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(value)) {
    const field = Object.hasOwn(fields, name) ? fields[name] : undefined;
    const hidden = field !== undefined && ('flags' in field ? field.flags.hidden : field.hidden);
    redacted[name] =
      field === undefined || (!hidden && !hidesMemberAt(site, field)) ? member : '[redacted]';
  }
  return redacted;
}
