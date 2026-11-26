import { describe, expect, test } from 'vitest';
import { answered, context } from '../../../test/authorization/fixtures.ts';
import type { Principal } from '../../principals/principal.ts';
import type { Carrier } from '../carrier.ts';
import type { ResolverKit } from './resolver-kit.ts';
import { runPrincipalEnrichers } from './run-principal-enrichers.ts';
import { runPrincipalResolvers } from './run-principal-resolvers.ts';

const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;
const clock = { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') };
const carrier = { transport: 'http' } as unknown as Carrier;
const user = answered(context('user', 'u1').principal);

class Handle {
  resolver = 'evil.keys';
  principalId = 'u1';
}

class Tagged {
  principalId = 'u1';
  resolver = 'evil.keys';
  get [Symbol.toStringTag]() {
    return 'Temporal.Instant';
  }
}

class Lazy {
  principalId = 'u1';
  get resolver() {
    return 'evil.keys';
  }
}

function kitOf(answer: unknown, enricher?: unknown): ResolverKit {
  return {
    fills: (point) =>
      point === 'core.principalResolvers'
        ? [{ module: 'evil', value: { id: 'evil.keys', resolve: () => ({ principal: answer }) } }]
        : enricher === undefined
          ? []
          : [{ module: 'other', value: enricher }],
    drive: (generator) => Promise.resolve(generator as never),
  };
}

const run = (answer: unknown) => runPrincipalResolvers(kitOf(answer), carrier, scope, clock);

describe('runPrincipalResolvers: what a resolver answers is plain data or it is refused', () => {
  test.each([
    ['an instance of a class as the reference', 'ref', { ...user, ref: new Handle() }],
    ['a getter on the prototype of the reference', 'ref', { ...user, ref: new Lazy() }],
    ['a subject that is not text', 'subject', { ...user, subject: { text: 'u1' } }],
    [
      'a reference member that is not text',
      'ref',
      { ...user, ref: { resolver: 1, principalId: 'u1' } },
    ],
    ['a scope member that is not text', 'scope', { ...user, scope: { backend: 1, tenant: null } }],
    [
      'an instance of a class inside the claims',
      'claims.holder',
      { ...user, claims: { holder: new Handle() } },
    ],
    [
      'a function inside the claims',
      'claims.fn',
      { ...user, claims: { fn: () => 'secret-value' } },
    ],
    ['a role that is not text', 'roles', { ...user, roles: [{}] }],
    ['a kind that is not text', 'kind', { ...user, kind: 1 }],
    ['a via that is not text', 'via', { ...user, via: {} }],
    [
      'an id that is not text',
      'id',
      { ...answered(context('service', 'loans.system').principal), id: 1 },
    ],
    ['a subject reference that is not text', 'subject', { ...user, subjectRef: 1 }],
    ['a principal that is an instance of a class', 'principal', Object.assign(new Handle(), user)],
    [
      'a function the answer brings for the subject',
      'subjectAs',
      { ...user, subjectAs: () => 'u1' },
    ],
    [
      'an object that answers the tag of a Temporal value, as the reference',
      'ref',
      { ...user, ref: new Tagged() },
    ],
    [
      'an object that answers the tag of a Temporal value, in the claims',
      'claims.when',
      { ...user, claims: { when: new Tagged() } },
    ],
    [
      'a real Temporal value in the claims',
      'claims.when',
      { ...user, claims: { when: Temporal.Now.instant() } },
    ],
    ['an expiry that only answers the tag', 'expiresAt', { ...user, expiresAt: new Tagged() }],
  ])('%s is internal and names its path, never a value', async (_title, path, answer) => {
    await expect(run(answer)).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      message: `A principal carries "${path}", which is not what its type declares: a principal is plain data.`,
    });
  });

  test('plain data, a Temporal value and the declared functions are taken', async () => {
    const answer = {
      ...user,
      claims: { scopes: ['read'], nested: { n: 1, ok: true, none: null } },
      expiresAt: Temporal.Instant.from('2026-03-02T00:00:00Z'),
    } as Principal;
    const resolved = await run(answer);
    expect(resolved.principal).toMatchObject({ kind: 'user', claims: { scopes: ['read'] } });
    expect(typeof (resolved.principal as { subjectAs?: unknown }).subjectAs).toBe('function');
  });
});

describe('runPrincipalResolvers: a principal holds only objects the kernel built', () => {
  test('the expiry is built anew from its value, and what the answer hung on it is not kept', async () => {
    const given = Temporal.Instant.from('2026-03-02T00:00:00Z');
    Object.assign(given, { handle: 'kept' });
    const resolved = await run({ ...user, expiresAt: given });
    const expiry = resolved.principal.expiresAt;
    expect(expiry).not.toBe(given);
    expect(expiry?.toString()).toBe(given.toString());
    expect(expiry).not.toHaveProperty('handle');
  });

  test('a proxy is read once and the principal keeps none of it', async () => {
    const reads: string[] = [];
    const proxy = new Proxy(
      { resolver: 'evil.keys', principalId: 'u1' },
      {
        get(target, key, receiver) {
          reads.push(String(key));
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const resolved = await run({ ...user, ref: proxy });
    expect(resolved.principal.ref).not.toBe(proxy);
    expect(Object.isFrozen(resolved.principal.ref)).toBe(true);
    const before = reads.length;
    expect(resolved.principal.ref?.resolver).toBe('evil.keys');
    expect(reads).toHaveLength(before);
  });

  test('the kernel builds the two functions from the data: the subject as another module sees it, and the id', async () => {
    const withRef = {
      ...user,
      subject: 'u9',
      subjectRef: 'accounts.profile',
    } as unknown as Principal;
    const principal = (await run(withRef)).principal as unknown as {
      subjectAs(ref: string): string | null;
    };
    expect(principal.subjectAs('accounts.profile')).toBe('u9');
    expect(principal.subjectAs('other.thing')).toBeNull();
    const unlinked = (await run(user)).principal as unknown as { subjectAs(ref: string): unknown };
    expect(unlinked.subjectAs('accounts.profile')).toBeNull();
    const service = answered(context('service', 'loans.system').principal);
    const built = (await run(service)).principal as unknown as { idAs(ref: string): unknown };
    expect(built.idAs('loans.thing')).toBeNull();
    const node = { ...service, id: 'n1', idRef: 'nodes.node' } as unknown as Principal;
    const standing = (await run(node)).principal as unknown as { idAs(ref: string): unknown };
    expect(standing.idAs('nodes.node')).toBe('n1');
    expect(standing.idAs('other.thing')).toBeNull();
  });
});

describe('runPrincipalEnrichers: what an enricher returns is plain data or it is refused', () => {
  test.each([
    ['a membership that is an instance of a class', { memberships: [new Handle()] }],
    ['a membership whose kind is not text', { memberships: [{ kind: {}, id: 'm', role: 'r' }] }],
  ])('%s is internal', async (_title, returned) => {
    const kit = kitOf(user, { enrich: () => returned });
    const resolved = await runPrincipalResolvers(kit, carrier, scope, clock);
    await expect(runPrincipalEnrichers(kit, resolved.principal)).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.internal',
    });
  });

  test('a role that is not text is internal and names the path', async () => {
    const kit = kitOf(user, { enrich: () => ({ roles: [{ name: 'admin' }] }) });
    const resolved = await runPrincipalResolvers(kit, carrier, scope, clock);
    await expect(runPrincipalEnrichers(kit, resolved.principal)).rejects.toMatchObject({
      message: expect.stringContaining('"roles"'),
    });
  });
});
