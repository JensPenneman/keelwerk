import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

/** An effect's input with the values of its hidden, personal and secret fields redacted (section 16.11.3). */
export function redactEffectInput(schema: StandardSchemaV1 | undefined, input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const { fields } = (schema ?? {}) as { readonly fields?: Readonly<Record<string, AnyField>> };
  const redacted: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(input)) {
    const field = fields?.[name];
    const kept =
      field === undefined
        ? fields !== undefined
        : !field.flags.hidden && field.flags.personal === false && field.kind !== 'secret';
    redacted[name] = kept ? member : '[redacted]';
  }
  return redacted;
}
