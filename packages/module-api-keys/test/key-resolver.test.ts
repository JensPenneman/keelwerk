import { absentVerifier, type Carrier, type PrincipalResolver, type Scope } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { principalResolversFill } from '../src/contributions/to-core/fills/principal-resolvers.ts';
import { apiKeys } from '../src/module.generated.ts';
import { keyOwnerSubject } from './support/api-key-calls.ts';

const now = Temporal.Instant.from('2026-11-20T09:00:00Z');
const clock = { now: () => now };
const tenant: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const publicId = 'a'.repeat(26);
const good = `kwk_${publicId}_${'b'.repeat(52)}`;
const keyId = '01a1cfed-8108-7458-8247-5e53af69a80f';

interface Row {
  readonly id: string;
  readonly subject: string;
  readonly scopes: readonly string[];
  readonly verifier: string;
  readonly publicId: string;
  readonly lastUsedAt?: Temporal.Instant;
  readonly revokedAt?: Temporal.Instant;
  readonly expiresAt?: Temporal.Instant;
  readonly apiVersion?: string;
}

const liveRow: Row = {
  id: keyId,
  subject: keyOwnerSubject,
  scopes: ['write'],
  verifier: 'stored-verifier',
  publicId,
};

interface Request {
  readonly kind: 'load' | 'verify';
}

/** The `own` context a fill factory is given, answering from `state` and recording what the resolver asked. */
function stubOwn(state: { row: Row | undefined; verified: boolean }, asked: string[] = []) {
  return {
    load: {
      apiKeys: {
        key: {
          *one(): Generator<Request, Row | undefined, unknown> {
            yield { kind: 'load' };
            return state.row;
          },
          *byId(): Generator<Request, Row | undefined, unknown> {
            yield { kind: 'load' };
            return state.row;
          },
        },
      },
    },
    secrets: {
      *verify(_token: string, verifier: string): Generator<Request, boolean, unknown> {
        asked.push(verifier);
        yield { kind: 'verify' };
        return state.verified;
      },
    },
  };
}

/** Drives a resolver generator to its end, answering each request from the stub; reports what it yielded. */
function drive<T>(generator: Generator<Request, T, unknown>) {
  const yielded: string[] = [];
  let step = generator.next();
  while (step.done !== true) {
    yielded.push(step.value.kind);
    step = generator.next();
  }
  return { yielded, result: step.value };
}

type Factory = (own: never) => readonly PrincipalResolver[];

function resolversOver(state: { row: Row | undefined; verified: boolean }, asked?: string[]) {
  return (principalResolversFill.factory as unknown as Factory)(stubOwn(state, asked) as never);
}

function resolverOver(state: { row: Row | undefined; verified: boolean }, asked?: string[]) {
  const [resolver] = resolversOver(state, asked);
  if (resolver === undefined) throw new Error('the fill yields no resolver');
  return resolver;
}

function resolve(
  state: { row: Row | undefined; verified: boolean },
  carrier: Partial<Carrier>,
  context: {
    readonly scope?: Scope;
    readonly retiredPinTarget?: (pin: string) => string | undefined;
  } = {},
  asked?: string[],
) {
  const resolver = resolverOver(state, asked);
  return drive(
    resolver.resolve(
      { transport: 'http', ...carrier },
      { scope: tenant, clock, ...context },
    ) as unknown as Generator<Request, never, unknown>,
  );
}

const bearer: Partial<Carrier> = { token: good };

/** What a caller sees of a refusal: its kind, code and message. */
function answerOf(error: unknown): string {
  const { kind, code, message } = error as { kind: string; code: string; message: string };
  return JSON.stringify({ kind, code, message });
}

function refusalOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return answerOf(error);
  }
  throw new Error('the key was accepted');
}

describe('the key resolver', () => {
  // The module's own definition stamps the references the timers name.
  test('the resolver is the fill of the mounted module', () => {
    expect(apiKeys.id).toBe('api-keys');
    expect(
      resolversOver({ row: undefined, verified: false }).map((resolver) => resolver.id),
    ).toEqual(['api-keys.key']);
  });

  test('every presented key costs one load and one verify, found or not', () => {
    const cases: Record<string, { row: Row | undefined; verified: boolean }> = {
      unknown: { row: undefined, verified: false },
      revoked: { row: { ...liveRow, revokedAt: now.subtract({ hours: 1 }) }, verified: true },
      expired: { row: { ...liveRow, expiresAt: now }, verified: true },
      'another tenant': { row: undefined, verified: true },
      'wrong secret': { row: liveRow, verified: false },
    };
    const refusals = new Set<string>();
    for (const [name, state] of Object.entries(cases)) {
      const asked: string[] = [];
      const kinds: string[] = [];
      const generator = resolverOver(state, asked).resolve(
        { transport: 'http', ...bearer },
        { scope: tenant, clock },
      ) as unknown as Generator<Request, never, unknown>;
      try {
        let step = generator.next();
        while (step.done !== true) {
          kinds.push(step.value.kind);
          step = generator.next();
        }
        throw new Error(`${name}: the key was accepted`);
      } catch (error) {
        refusals.add(answerOf(error));
      }
      expect(kinds, name).toEqual(['load', 'verify']);
      expect(asked, name).toHaveLength(1);
    }
    expect(refusals.size).toBe(1);
    expect([...refusals][0]).toContain('The API key was not accepted.');
  });

  test('a key that no row holds is verified against the placeholder, so it costs one verification too', () => {
    const asked: string[] = [];
    refusalOf(() => resolve({ row: undefined, verified: false }, bearer, {}, asked));
    expect(asked).toEqual([absentVerifier]);
    const known: string[] = [];
    resolve({ row: liveRow, verified: true }, bearer, {}, known);
    expect(known).toEqual(['stored-verifier']);
  });

  test('a key outside a tenant is refused before any load', () => {
    const yielded: string[] = [];
    const resolver = resolverOver({ row: liveRow, verified: true });
    const generator = resolver.resolve(
      { transport: 'http', ...bearer },
      { scope: { level: 'backend', backendId: 'b1' }, clock },
    ) as unknown as Generator<Request, never, unknown>;
    expect(() => {
      const step = generator.next();
      if (step.done !== true) yielded.push(step.value.kind);
    }).toThrow('The API key was not accepted.');
    expect(yielded).toEqual([]);
  });

  test('a token of another prefix or format is left to the next resolver', () => {
    const others: readonly Partial<Carrier>[] = [
      {},
      { token: `sess_${publicId}_${'b'.repeat(52)}` },
      { token: 'garbage' },
      { token: `kwk_${publicId}` },
      { headers: { authorization: 'Basic abc' } },
    ];
    for (const carrier of others) {
      const run = resolve({ row: liveRow, verified: true }, carrier);
      expect(run.yielded).toEqual([]);
      expect(run.result).toBeNull();
    }
  });

  test('the key is read from the Authorization header too', () => {
    const run = resolve(
      { row: liveRow, verified: true },
      { headers: { authorization: `Bearer ${good}` } },
    );
    expect(run.result).toMatchObject({
      principal: { via: 'api-keys.key', subject: keyOwnerSubject },
    });
  });

  test('the last-use timer holds the key id only', () => {
    const carrier: Partial<Carrier> = {
      ...bearer,
      headers: { 'user-agent': 'SpecialAgent/7.1' },
      connection: {
        id: 'c1',
        listener: 'http',
        remote: { address: '203.0.113.9', port: 40000 },
        local: { address: '127.0.0.1', port: 8080 },
      },
    };
    const { result } = resolve({ row: liveRow, verified: true }, carrier);
    const effects = (result as { effects: readonly { key: string; input: unknown }[] }).effects;
    expect(effects.map((effect) => effect.key)).toEqual([`api-keys.lastUse:${keyId}`]);
    expect(effects[0]?.input).toEqual({ keyId });
    const text = JSON.stringify(effects);
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toContain('SpecialAgent');
  });

  test('no last-use timer is set while the last use is recent', () => {
    const recent = { ...liveRow, lastUsedAt: now.subtract({ minutes: 59 }) };
    const { result } = resolve({ row: recent, verified: true }, bearer);
    expect((result as { effects: readonly unknown[] }).effects).toEqual([]);
  });

  test('a retired pin is served at its target and moved by a keyed timer', () => {
    const pinned = { ...liveRow, apiVersion: '2026-11-04' };
    const retiredPinTarget = (pin: string) => (pin === '2026-11-04' ? '2026-11-11' : undefined);
    const { result } = resolve({ row: pinned, verified: true }, bearer, { retiredPinTarget });
    const answer = result as {
      principal: { apiVersion?: string };
      effects: readonly { key: string; input: unknown }[];
    };
    expect(answer.principal.apiVersion).toBe('2026-11-11');
    expect(
      answer.effects.find((effect) => effect.key === `api-keys.repin:${keyId}`)?.input,
    ).toEqual({
      keyId,
      apiVersion: '2026-11-11',
    });
  });

  test('a served pin stays, and without the check the stored pin is answered for the kernel to judge', () => {
    const pinned = { ...liveRow, apiVersion: '2026-11-04' };
    const served = resolve({ row: pinned, verified: true }, bearer, {
      retiredPinTarget: () => undefined,
    }).result as { principal: { apiVersion?: string }; effects: readonly { key: string }[] };
    expect(served.principal.apiVersion).toBe('2026-11-04');
    expect(served.effects.some((effect) => effect.key.startsWith('api-keys.repin:'))).toBe(false);
    const unchecked = resolve({ row: pinned, verified: true }, bearer).result as typeof served;
    expect(unchecked.principal.apiVersion).toBe('2026-11-04');
    expect(unchecked.effects.some((effect) => effect.key.startsWith('api-keys.repin:'))).toBe(
      false,
    );
  });

  test('a key that names transports is refused on another with the same refusal', () => {
    const bound = { ...liveRow, scopes: ['read', 'transport:cli'] };
    const refused = refusalOf(() =>
      resolve({ row: bound, verified: true }, { ...bearer, transport: 'http' }),
    );
    expect(refused).toBe(refusalOf(() => resolve({ row: undefined, verified: false }, bearer)));
    const accepted = resolve({ row: bound, verified: true }, { ...bearer, transport: 'cli' });
    expect(accepted.result).toMatchObject({ principal: { via: 'api-keys.key' } });
  });

  test('fromRef answers null for a revoked or expired key and the principal for a live one', () => {
    const ref = { resolver: 'api-keys.key', principalId: keyId };
    const answer = (row: Row | undefined) => {
      const [resolver] = resolversOver({ row, verified: true });
      const fromRef = resolver?.fromRef;
      if (fromRef === undefined) throw new Error('the resolver has no fromRef');
      return drive(
        fromRef(ref, { scope: tenant, clock, transport: null }) as unknown as Generator<
          Request,
          unknown,
          unknown
        >,
      );
    };
    expect(answer(undefined).result).toBeNull();
    expect(answer({ ...liveRow, revokedAt: now }).result).toBeNull();
    expect(answer({ ...liveRow, expiresAt: now }).result).toBeNull();
    const live = answer({ ...liveRow, expiresAt: now.add({ minutes: 1 }) });
    expect(live.yielded).toEqual(['load']);
    expect(live.result).toMatchObject({
      principal: {
        kind: 'user',
        subject: keyOwnerSubject,
        ref: { resolver: 'api-keys.key', principalId: keyId },
      },
    });
    expect((live.result as { effects?: unknown }).effects).toBeUndefined();
  });
});
