import { describe, expect, test } from 'vitest';
import { fieldDescriptor, rule } from '../../test/authorization/fixtures.ts';
import { runtimeOperator } from '../principals/runtime-operator.ts';
import { exportCaslRules } from './export-casl-rules.ts';

const principal = { ...runtimeOperator, id: 'ops' };
const scope = { level: 'deployment' } as const;

describe('the order of the exported rules', () => {
  test('allow rules come first and deny rules after them, each group by id', () => {
    const rules = [
      rule({
        id: 'a-deny',
        effect: 'deny',
        reason: 'frozen',
        entity: 'doc.post',
        actions: ['delete'],
      }),
      rule({ id: 'z-allow', effect: 'allow', entity: 'doc.post', actions: ['*'] }),
      rule({
        id: 'b-deny',
        effect: 'deny',
        reason: 'frozen',
        entity: 'doc.post',
        actions: ['update'],
      }),
      rule({ id: 'c-allow', effect: 'allow', entity: 'doc.post', actions: ['read'] }),
    ];
    const out = exportCaslRules({ rules, principal, scope });
    expect(out.map((one) => [one.action[0], one.inverted === true])).toEqual([
      ['read', false],
      ['manage', false],
      ['delete', true],
      ['update', true],
    ]);
  });
});

describe('the actions, selectors and contains of the export (section 8.7)', () => {
  const kinds = { title: 'string', tags: 'set', score: 'integer' } as const;
  const fieldKind = (_entity: string, name: string) =>
    name in kinds ? fieldDescriptor(kinds[name as keyof typeof kinds]).kind : undefined;
  const run = (rules: ReturnType<typeof rule>[]) =>
    exportCaslRules({ rules, principal, scope, fieldKind });

  test('exports the expanded action names, never the raw aliases', () => {
    const [read] = run([rule({ id: 'a', effect: 'allow', actions: ['read'] })]);
    expect(read?.action[0]).toBe('read');
    expect(read?.action).toContain('query');
    const [write] = run([rule({ id: 'b', effect: 'allow', actions: ['write', 'publish'] })]);
    expect(write?.action).toEqual(['archive', 'create', 'publish', 'restore', 'set', 'update']);
    const [all] = run([rule({ id: 'c', effect: 'allow', actions: ['*'] })]);
    expect(all?.action).toEqual(['manage']);
  });

  test('contains is membership on a list or set, a pattern on a string, else the server', () => {
    const contains = (field: string, value: unknown) =>
      run([
        rule({ id: field, effect: 'allow', where: () => ({ [field]: { contains: value } }) }),
      ])[0];
    expect(contains('tags', 'blue')?.conditions).toEqual({ tags: 'blue' });
    expect(contains('title', 'a.b')?.conditions).toEqual({ title: { $regex: 'a\\.b' } });
    expect(contains('title', 5)).toMatchObject({ serverOnly: true });
    expect(contains('score', 5)).toMatchObject({ serverOnly: true });
    expect(contains('unknown', 'x')).toMatchObject({ serverOnly: true });
  });

  test('a selector rule is serverOnly', () => {
    const [one] = run([
      rule({ id: 's', effect: 'allow', subject: { kinds: ['query'] }, actions: ['*'] }),
    ]);
    expect(one).toMatchObject({ serverOnly: true });
  });
});
