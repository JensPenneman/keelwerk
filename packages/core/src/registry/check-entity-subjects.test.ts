import { describe, expect, test } from 'vitest';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { checkEntitySubjects } from './check-entity-subjects.ts';
import type { EntityEntry } from './entity-entry.ts';

function descriptorField(
  kind: FieldDescriptor['kind'],
  extra: Partial<FieldDescriptor> = {},
): FieldDescriptor {
  return {
    kind,
    personal: false,
    sealed: false,
    ref: null,
    inner: null,
    ...extra,
  } as FieldDescriptor;
}

const personal = (subject: string): FieldDescriptor['personal'] =>
  ({ subject }) as unknown as FieldDescriptor['personal'];

function entities(
  fields: Record<string, FieldDescriptor>,
  dataSubject: string | null,
): ReadonlyMap<string, EntityEntry> {
  const entity = (
    ref: string,
    entityFields: Record<string, FieldDescriptor>,
    subject: string | null,
  ) =>
    [
      ref,
      {
        ref,
        module: 'courier',
        descriptor: {
          ref,
          dataSubject: subject,
          fields: entityFields,
        } as unknown as EntityDescriptor,
      } as unknown as EntityEntry,
    ] as const;
  return new Map([
    entity('courier.message', fields, dataSubject),
    entity(
      'courier.account',
      {
        owner: descriptorField('subject'),
        token: descriptorField('secret', { sealed: true }),
        mail: descriptorField('string', { personal: personal('id') }),
      },
      null,
    ),
  ]);
}

const accountId = descriptorField('ref', { ref: { entity: 'courier.account', foreignKey: true } });

function messages(
  fields: Record<string, FieldDescriptor>,
  dataSubject: string | null,
): readonly string[] {
  return checkEntitySubjects(entities(fields, dataSubject)).map((problem) => problem.message);
}

describe('checkEntitySubjects', () => {
  test('id, a subject field and a path through references resolve', () => {
    const body = descriptorField('string', { personal: personal('accountId.owner') });
    expect(messages({ accountId, body }, 'accountId.owner')).toEqual([]);
    expect(
      messages({ body: descriptorField('string', { personal: personal('id') }) }, 'id'),
    ).toEqual([]);
  });

  test('a secret or personal segment and an unknown hop are refused', () => {
    const body = (subject: string) => descriptorField('string', { personal: personal(subject) });
    expect(messages({ accountId, body: body('accountId.token') }, null)).toEqual([
      "'courier.message' names the data subject 'accountId.token', whose segment 'token' of courier.account is a sealed field, which holds no subject id.",
    ]);
    expect(messages({ accountId, body: body('accountId.mail') }, null)).toEqual([
      "'courier.message' names the data subject 'accountId.mail', whose segment 'mail' of courier.account is a personal field.",
    ]);
    expect(messages({ accountId, body: body('accountId.ownr') }, null)).toEqual([
      "'courier.message' names the data subject 'accountId.ownr', whose segment 'ownr' is not a field of courier.account.",
    ]);
    expect(
      messages(
        {
          accountId,
          body: body('secretRef'),
          secretRef: descriptorField('secret', { sealed: true }),
        },
        null,
      ),
    ).toEqual([
      "'courier.message' names the data subject 'secretRef', whose first segment is a sealed field, which holds no subject id.",
    ]);
  });

  test('the dataSubject of the entity is checked once, not once per field', () => {
    const body = descriptorField('string', { personal: personal('accountId.nope') });
    expect(messages({ accountId, body, other: body }, 'accountId.nope')).toHaveLength(1);
  });

  test('the personal element of a list is checked', () => {
    const list = descriptorField('list', {
      personal: false,
      inner: descriptorField('string', { personal: personal('missing') }),
    });
    expect(messages({ list }, null)).toEqual([
      "'courier.message' names the data subject 'missing', whose first segment is not a field of courier.message.",
    ]);
  });
});
