import { errors } from '../errors/errors.ts';
import type { AnyField } from '../fields/field-def.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import { defaultRandomSource } from '../keys/default-random-source.ts';
import type { RandomSource } from '../keys/random-source.ts';
import { sealKwe } from '../keys/seal-kwe.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { Unit } from '../storage/unit.ts';
import { memberSubjectOf } from './member-subject-of.ts';
import type { MemberSealer } from './seal-members.ts';

const encoder = new TextEncoder();

/** What sealing the personal members of one stored input needs. */
export interface PersonalMemberSealing {
  readonly unit: Unit;
  /** Describes the entities a dotted subject path walks through. */
  readonly registry: Registry;
  /** The module the input's references are read in. */
  readonly module: string;
  /** The action or effect the input belongs to, `the action "x"` or `the effect "x"`, and its reference. */
  readonly owner: { readonly label: string; readonly ref: string };
  /** The input's fields, to follow a reference of a dotted path. */
  readonly fields: Readonly<Record<string, AnyField>>;
  /** The values whose members name the subjects. */
  readonly input: unknown;
  /** The id every envelope is bound to: the command id of a job, the id of an effect. */
  readonly id: string;
  /** Default `defaultRandomSource`; a golden test passes a fixed one. */
  readonly random?: RandomSource;
  /** The plain value as it is sealed: the JSON of the member itself, or its event form. */
  readonly encode?: (value: unknown) => unknown;
  /** Runs once for each subject whose key the pass uses first, for example to record a reference. */
  readonly onSubject?: (subject: string) => Promise<void>;
  /**
   * The subject path a member names: `undefined` when the member holds no personal value, `null`
   * when it does and names no subject (a registry built without compose; refused).
   */
  readonly pathOf: (name: string, field: AnyField) => string | null | undefined;
}

/**
 * The sealer of the personal members of a stored input (14.7.4, 14.7.5): each selected member whole
 * as a `$kwe` envelope under the data key of the subject its path names, bound to the id and the
 * member. Erasure reaches only tenant units, so a unit of another scope is `internal`: a key made
 * there would never be destroyed. Throws `core.request_not_allowed` when a member names no subject,
 * `validation` when the path resolves to nothing and `forbidden` when the subject was erased.
 */
export function personalMemberSealer(
  sealing: PersonalMemberSealing,
): MemberSealer<{ readonly path: string | null }> {
  const { unit, owner, id } = sealing;
  const random = sealing.random ?? defaultRandomSource;
  const keys = new Map<string, DataKey>();
  return {
    select: (name, field) => {
      const path = sealing.pathOf(name, field);
      return path === undefined ? undefined : { path };
    },
    seal: async (name, _field, original, { path }) => {
      if (path === null) {
        throw refuseRequest(
          owner.label,
          `its input declares the personal field "${name}" and names no data subject`,
        );
      }
      if (unit.scope.level !== 'tenant') {
        throw errors.internal(
          `${owner.ref}.${name} is personal and is stored outside a tenant: erasure cannot reach it`,
        );
      }
      const subject = await memberSubjectOf(
        {
          unit,
          registry: sealing.registry,
          module: sealing.module,
          input: sealing.input,
          fields: sealing.fields,
          owner: owner.ref,
        },
        path,
      );
      if (subject === undefined) {
        throw errors.validation(
          `${owner.ref}.${name} is personal and needs its data subject "${path}".`,
          { issues: [{ path: [name], message: `Needs the data subject "${path}".` }] },
        );
      }
      let key = keys.get(subject);
      if (key === undefined) {
        key = await unit.keys.dataKey(subject, { create: true });
        if (key === undefined) {
          throw errors.forbidden('The data subject was erased: personal values cannot be written.');
        }
        keys.set(subject, key);
        await sealing.onSubject?.(subject);
      }
      const plain = sealing.encode === undefined ? original : sealing.encode(original);
      return sealKwe(
        key,
        encoder.encode(JSON.stringify(plain)),
        { namespace: unit.namespace.id, streamId: id, eventId: id, field: `input.${name}` },
        random,
      );
    },
  };
}
