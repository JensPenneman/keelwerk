import { personalInputField } from '../effects/personal-input-field.ts';
import { errors } from '../errors/errors.ts';
import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { holdsCredential } from '../keys/holds-credential.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The sealed input of a decision record for an action with `trace: { input: 'sealed' }` (decision
 * 79, section 7.9.6): the action's input as canonical JSON under its own value key, bound to the
 * command and the decision, so the record can replay the decision for a holder of the key and
 * show the input to nobody else. `field.secret()` and `field.verifier()` inputs are stripped
 * before sealing. Personal fields belong under the subject's key, which arrives with WP-53: until
 * then an action that declares one is refused instead of recorded in a form the spec does not
 * allow. Destroying the key (retention, erasure) makes the input unreadable.
 */
export async function sealDecisionInput(
  unit: Unit,
  commandId: string,
  schema: StandardSchemaV1,
  input: unknown,
): Promise<SealedValue> {
  const personal = personalInputField(schema);
  if (personal !== undefined) {
    throw errors.not_implemented(
      `The input field "${personal}" is personal, and sealing it under the subject's key arrives with WP-53.`,
    );
  }
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  let kept = input;
  if (fields !== undefined && typeof input === 'object' && input !== null) {
    const stripped: Record<string, unknown> = { ...input };
    for (const [name, field] of Object.entries(fields)) {
      if (holdsCredential(field)) delete stripped[name];
    }
    kept = stripped;
  }
  return unit.keys.sealValue(
    { entity: 'core.decision', id: commandId, field: 'input' },
    new TextEncoder().encode(canonicalizeJson(kept)),
  );
}
