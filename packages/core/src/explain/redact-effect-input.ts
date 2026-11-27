import type { AnyField } from '../fields/field-def.ts';
import type { MarkSite } from '../fields/mark-types.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { redactKeys } from './redact-keys.ts';

/**
 * A shape's value (an effect's input, a command's output) with the members that are hidden or hold
 * a mark of `site` redacted (section 16.11.3); a schema with no keelwerk fields redacts every member.
 */
export function redactEffectInput(
  site: MarkSite,
  schema: StandardSchemaV1 | undefined,
  input: unknown,
): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const { fields } = (schema ?? {}) as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields !== undefined) return redactKeys(site, fields, input);
  return Object.fromEntries(Object.keys(input).map((name) => [name, '[redacted]']));
}
