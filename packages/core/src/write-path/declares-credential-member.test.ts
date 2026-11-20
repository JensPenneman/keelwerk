import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { declaresCredentialMember } from './declares-credential-member.ts';

const none = { entities: new Map() } as unknown as Pick<Registry, 'entities'>;
const entry = (input: unknown, extra: object = {}): ActionEntry =>
  ({ name: 'x.act', input, ...extra }) as unknown as ActionEntry;
const withFields = (fields: object, extra: object = {}): ActionEntry =>
  entry(shape(fields as never), extra);
const vault = (fields: object): Pick<Registry, 'entities'> =>
  ({ entities: new Map([['x.vault', { descriptor: { fields } }]]) }) as unknown as Pick<
    Registry,
    'entities'
  >;

describe('declaresCredentialMember', () => {
  test('a top-level secret, an optional secret and a verifier each declare one', () => {
    expect(declaresCredentialMember(withFields({ pin: field.secret() }), none)).toBe(true);
    expect(declaresCredentialMember(withFields({ pin: field.secret().optional() }), none)).toBe(
      true,
    );
    expect(declaresCredentialMember(withFields({ pin: field.verifier() }), none)).toBe(true);
  });

  test('a list or set of secrets declares one', () => {
    expect(declaresCredentialMember(withFields({ pins: field.list(field.secret()) }), none)).toBe(
      true,
    );
    expect(declaresCredentialMember(withFields({ pins: field.set(field.secret()) }), none)).toBe(
      true,
    );
  });

  test('a secret inside a json shape, and inside a list of json shapes, declares one', () => {
    const inner = field.json(shape({ pin: field.secret() }));
    expect(declaresCredentialMember(withFields({ guard: inner }), none)).toBe(true);
    expect(declaresCredentialMember(withFields({ guards: field.list(inner) }), none)).toBe(true);
  });

  test('plain, personal and reference members declare none, nor a json member over another schema, nor an input with no declared fields', () => {
    expect(
      declaresCredentialMember(
        withFields({
          note: field.string(),
          who: field.string().personal(),
          owner: field.ref.own('x.vault'),
          blob: field.json({ parse: (v: unknown) => v } as never),
        }),
        none,
      ),
    ).toBe(false);
    expect(declaresCredentialMember(entry(undefined), none)).toBe(false);
    expect(declaresCredentialMember(entry({}), none)).toBe(false);
  });

  test('a generated update or set of an entity with a secret field declares one; a generated create whose input declares a secret declares one; its archive and an entity without one declare none', () => {
    const secret = vault({ pin: field.secret() });
    const plain = vault({ note: field.string() });
    const gen = (generated: string): ActionEntry =>
      entry(undefined, { generated, entity: 'x.vault' });
    expect(declaresCredentialMember(gen('update'), secret)).toBe(true);
    expect(declaresCredentialMember(gen('set'), secret)).toBe(true);
    expect(declaresCredentialMember(gen('archive'), secret)).toBe(false);
    expect(
      declaresCredentialMember(
        entry(shape({ pin: field.secret() }), { generated: 'create', entity: 'x.vault' }),
        plain,
      ),
    ).toBe(true);
    expect(declaresCredentialMember(gen('update'), plain)).toBe(false);
  });

  test('an instance command input rebuilt with id and ifVersion keeps the answer of its declared members', () => {
    const declared = { pin: field.secret() };
    expect(
      declaresCredentialMember(
        withFields({ ...declared, id: field.string(), ifVersion: field.integer().optional() }),
        none,
      ),
    ).toBe(true);
    expect(
      declaresCredentialMember(
        withFields({
          note: field.string(),
          id: field.string(),
          ifVersion: field.integer().optional(),
        }),
        none,
      ),
    ).toBe(false);
  });

  test('a shape that refers to itself through a json member ends', () => {
    const fields: Record<string, unknown> = { note: field.string() };
    const self = shape(fields as never);
    fields.again = field.json(self);
    expect(declaresCredentialMember(entry(self), none)).toBe(false);
  });

  test('the answer of a complete first call is kept for the entry', () => {
    const fields: Record<string, unknown> = { note: field.string() };
    const action = entry(shape(fields as never));
    expect(declaresCredentialMember(action, none)).toBe(false);
    fields.pin = field.secret();
    expect(declaresCredentialMember(action, none)).toBe(false);
  });

  test('a generated update whose entity the registry lacks throws and keeps nothing', () => {
    const action = entry(undefined, {
      generated: 'update',
      entity: 'x.vault',
      ref: 'x.vault.update',
    });
    expect(() => declaresCredentialMember(action, none)).toThrow(
      expect.objectContaining({
        kind: 'internal',
        message: expect.stringContaining('x.vault.update'),
      }),
    );
    expect(() => declaresCredentialMember(action, none)).toThrow(/x\.vault/);
    expect(declaresCredentialMember(action, vault({ pin: field.secret() }))).toBe(true);
  });
});
