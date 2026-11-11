import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import type { ShapeFields } from '../fields/shape.ts';
import { shape } from '../fields/shape.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { checkEffectSubjects } from './check-effect-subjects.ts';
import type { EffectEntry } from './effect-entry.ts';
import type { EntityEntry } from './entity-entry.ts';

function descriptorField(kind: FieldDescriptor['kind'], extra: Record<string, unknown>) {
  return { kind, personal: false, sealed: false, ref: null, inner: null, ...extra };
}

/** `courier.message` holds a reference to `courier.account`, which holds the subject and a credential. */
function entities(): ReadonlyMap<string, EntityEntry> {
  const entity = (ref: string, fields: Record<string, unknown>): [string, EntityEntry] => [
    ref,
    { ref, descriptor: { ref, fields } as unknown as EntityDescriptor } as unknown as EntityEntry,
  ];
  return new Map([
    entity('courier.message', {
      accountId: descriptorField('ref', { ref: { entity: 'courier.account', foreignKey: true } }),
      subject: descriptorField('string', { personal: { subject: 'id' } }),
      ghostId: descriptorField('ref', { ref: { entity: 'courier.ghost', foreignKey: true } }),
    }),
    entity('courier.account', {
      owner: descriptorField('subject', {}),
      mail: descriptorField('string', { personal: { subject: 'id' } }),
      token: descriptorField('secret', { sealed: true }),
      count: descriptorField('integer', {}),
    }),
  ]);
}

function effect(
  input: ShapeFields,
  extra: { readonly dataSubject?: string; readonly output?: ShapeFields } = {},
): ReadonlyMap<string, EffectEntry> {
  const entry: EffectEntry = {
    ref: 'courier.deliver',
    module: 'courier',
    name: 'deliver',
    performer: 'executor',
    executor: 'courier.deliver',
    input: shape(input),
    output: shape(extra.output ?? {}),
    ...(extra.dataSubject === undefined ? {} : { dataSubject: extra.dataSubject }),
  };
  return new Map([[entry.ref, entry]]);
}

const messageRef = field.ref.own('message');

describe('checkEffectSubjects', () => {
  test('no subject is effectInputNeedsSubject', () => {
    const problems = checkEffectSubjects(effect({ to: field.string().personal() }), entities());
    expect(problems).toEqual([
      {
        code: 'effectInputNeedsSubject',
        severity: 'error',
        message:
          "'courier.deliver' declares the personal input field 'to' and names no data subject; declare dataSubject (a path in its input) or .personal({ subject }).",
        module: 'courier',
        ref: 'courier.deliver',
      },
    ]);
  });

  test('a field subject wins over dataSubject', () => {
    const input = {
      owner: field.subject(),
      to: field.string().personal({ subject: 'owner' }),
    };
    expect(checkEffectSubjects(effect(input, { dataSubject: 'missing' }), entities())).toEqual([]);
    expect(checkEffectSubjects(effect(input), entities())).toEqual([]);
  });

  test('a missing, personal or non-reference first segment is effectInputNeedsSubject', () => {
    const to = field.string().personal();
    const missing = checkEffectSubjects(effect({ to }, { dataSubject: 'owner' }), entities());
    expect(missing.map((problem) => problem.message)).toEqual([
      "'courier.deliver' names the data subject 'owner', whose first segment is not a field of its input.",
    ]);
    const personal = checkEffectSubjects(
      effect({ owner: field.string().personal({ subject: 'id' }), to }, { dataSubject: 'owner' }),
      entities(),
    );
    expect(personal.map((problem) => problem.message)).toContain(
      "'courier.deliver' names the data subject 'owner', whose first segment is a personal field.",
    );
    const plain = checkEffectSubjects(
      effect({ owner: field.subject(), to }, { dataSubject: 'owner.accountId' }),
      entities(),
    );
    expect(plain.map((problem) => problem.message)).toEqual([
      "'courier.deliver' names the data subject 'owner.accountId', whose first segment is not a reference, so the path cannot continue.",
    ]);
    const hop = checkEffectSubjects(
      effect({ messageId: messageRef, to }, { dataSubject: 'messageId.accountId.owner' }),
      entities(),
    );
    expect(hop).toEqual([]);
  });

  test('a secret, verifier, json or number first segment is refused', () => {
    const to = field.string().personal();
    for (const head of [
      field.secret(),
      field.verifier(),
      field.json(shape({ a: field.string() })),
      field.integer(),
    ]) {
      const problems = checkEffectSubjects(
        effect({ apiKey: head, to }, { dataSubject: 'apiKey' }),
        entities(),
      );
      expect(problems).toHaveLength(1);
      expect(problems[0]?.message).toMatch(
        /^'courier.deliver' names the data subject 'apiKey', whose first segment (is a sealed field|is of kind (json|integer)), which holds no subject id\.$/,
      );
    }
  });

  test('every later segment resolves through the entities of the app', () => {
    const to = field.string().personal();
    const message = (path: string) =>
      checkEffectSubjects(effect({ messageId: messageRef, to }, { dataSubject: path }), entities())
        .map((problem) => problem.message)
        .join('|');
    const named = (reason: string, path: string) =>
      `'courier.deliver' names the data subject '${path}', ${reason}`;
    expect(message('messageId.accountId.owner')).toBe('');
    expect(message('messageId.accountId.id')).toBe('');
    expect(message('messageId.acountId.owner')).toBe(
      named(
        "whose segment 'acountId' is not a field of courier.message.",
        'messageId.acountId.owner',
      ),
    );
    expect(message('messageId.subject')).toBe(
      named("whose segment 'subject' of courier.message is a personal field.", 'messageId.subject'),
    );
    expect(message('messageId.accountId.mail')).toBe(
      named(
        "whose segment 'mail' of courier.account is a personal field.",
        'messageId.accountId.mail',
      ),
    );
    expect(message('messageId.accountId.token')).toBe(
      named(
        "whose segment 'token' of courier.account is a sealed field, which holds no subject id.",
        'messageId.accountId.token',
      ),
    );
    expect(message('messageId.accountId.count')).toBe(
      named(
        "whose segment 'count' of courier.account is of kind integer, which holds no subject id.",
        'messageId.accountId.count',
      ),
    );
    expect(message('messageId.accountId.owner.x')).toBe(
      named(
        "whose segment 'owner' of courier.account is not a reference, so the path cannot continue.",
        'messageId.accountId.owner.x',
      ),
    );
    expect(message('messageId.ghostId.owner')).toBe(
      named(
        "whose segment 'ghostId' of courier.message points at courier.ghost, which the app does not declare.",
        'messageId.ghostId.owner',
      ),
    );
  });

  test('a personal output field is personalEffectOutput', () => {
    const problems = checkEffectSubjects(
      effect({ url: field.string() }, { output: { mail: field.string().personal() } }),
      entities(),
    );
    expect(problems).toEqual([
      {
        code: 'personalEffectOutput',
        severity: 'error',
        message:
          "'courier.deliver' outputs the personal field 'mail'; an effect record keeps its output with secrets sealed and nothing else, so leave the field out.",
        module: 'courier',
        ref: 'courier.deliver',
      },
    ]);
  });

  test('an effect without personal members has no problem', () => {
    expect(
      checkEffectSubjects(effect({ url: field.string(), key: field.secret() }), entities()),
    ).toEqual([]);
  });
});
