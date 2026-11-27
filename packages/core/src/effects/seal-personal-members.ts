import type { AnyField } from '../fields/field-def.ts';
import { personalFlagAt } from '../fields/personal-flag-at.ts';
import type { RandomSource } from '../keys/random-source.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import { personalMemberSealer } from './personal-member-sealer.ts';
import { sealMembers } from './seal-members.ts';

/** What sealing the personal members of one job input reads. */
export interface SealPersonalMembersInput {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly action: ActionEntry;
  readonly commandId: string;
  /** The input whose secret members are sealed already; its other members are the validated ones. */
  readonly input: unknown;
  /** Default `defaultRandomSource`; a golden test passes a fixed one. */
  readonly random?: RandomSource;
}

/**
 * The personal members of a command job's input (14.7.4, 14.7.5): each present member, whole, as a
 * `$kwe` envelope under the data key of the subject its `.personal({ subject })` names (a member of
 * the input, or a path through references), bound to the job's command id and the member name
 * (`personalMemberSealer`). The shred of that subject therefore makes the stored value unreadable
 * wherever the job row, its dead letter or a backup holds it, whoever started the job. Throws
 * `core.request_not_allowed` when a personal member names no subject, `validation` when the path
 * resolves to nothing, `forbidden` when the subject was erased and `internal` outside a tenant
 * unit. `openPersonalMembers` is the counterpart. Answers the input itself when the action has no
 * personal member.
 */
export async function sealPersonalMembers(input: SealPersonalMembersInput): Promise<unknown> {
  const { unit, action, commandId } = input;
  const { fields } = action.input as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined) return input.input;
  return sealMembers(
    action.input,
    input.input,
    personalMemberSealer({
      unit,
      registry: input.registry,
      module: action.module,
      owner: { label: `the action "${action.ref}"`, ref: action.ref },
      fields,
      input: input.input,
      id: commandId,
      encode: encodeEventValue,
      ...(input.random === undefined ? {} : { random: input.random }),
      pathOf: (_name, field) => {
        const flag = personalFlagAt('commandInput', field);
        return flag === false ? undefined : (flag.subject ?? null);
      },
    }),
  );
}
