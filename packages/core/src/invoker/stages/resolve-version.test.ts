import { describe, expect, test } from 'vitest';
import type { Principal } from '../../principals/principal.ts';
import type { Carrier } from '../carrier.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ResolvedScope } from '../resolved-scope.ts';
import { resolveVersion } from './resolve-version.ts';

const env = {
  appOf: () => ({
    head: '2026-06-01',
    api: {
      dates: ['2026-03-01', '2026-06-01'],
      versions: { '2026-03-01': { deprecated: { at: '2026-04-01', sunset: '2026-05-01' } } },
    },
  }),
  options: { clock: { now: () => Temporal.Instant.from('2026-07-01T00:00:00Z') } },
} as unknown as InvokerEnv;
// The tenant is pinned to a version whose sunset has passed.
const resolved = { app: 'a', pinnedVersion: '2026-03-01' } as unknown as ResolvedScope;
const principal = { apiVersion: '2026-03-01' } as unknown as Principal;
const reactionJob = { reaction: true } as unknown as NonNullable<Carrier['job']>;
const otherJob = {} as unknown as NonNullable<Carrier['job']>;
const carrierOf = (extra: Partial<Carrier>): Carrier => ({ transport: 'rest', ...extra });

describe('the API version of an invocation', () => {
  test('a reaction job runs at the head whatever the header, the credential and the pin say', () => {
    const carrier = carrierOf({ headers: { 'keelwerk-version': '2026-03-01' }, job: reactionJob });
    expect(resolveVersion(env, resolved, carrier, principal)).toEqual({
      apiVersion: '2026-06-01',
      deprecation: null,
    });
  });

  test('the same carrier without the reaction mark is answered by the choice: the header', () => {
    const carrier = carrierOf({ headers: { 'keelwerk-version': '2026-06-01' }, job: otherJob });
    expect(resolveVersion(env, resolved, carrier, principal).apiVersion).toBe('2026-06-01');
  });

  test('another job keeps a retired version it was accepted under, with no deprecation', () => {
    expect(resolveVersion(env, resolved, carrierOf({ job: otherJob }), principal)).toEqual({
      apiVersion: '2026-03-01',
      deprecation: null,
    });
    const headed = carrierOf({ headers: { 'keelwerk-version': '2026-03-01' }, job: otherJob });
    expect(resolveVersion(env, resolved, headed, principal)).toEqual({
      apiVersion: '2026-03-01',
      deprecation: null,
    });
  });

  test("a request without a version, whose pin is retired, is served under the pin's target", () => {
    // The credential's pin, the tenant's pin and the backend's default are all pins.
    expect(resolveVersion(env, resolved, carrierOf({}), principal)).toEqual({
      apiVersion: '2026-06-01',
      deprecation: null,
    });
    const tenantOnly = {} as unknown as Principal;
    expect(resolveVersion(env, resolved, carrierOf({}), tenantOnly).apiVersion).toBe('2026-06-01');
  });

  test('a retired version that the request names is refused whatever the pin is', () => {
    const headed = carrierOf({ headers: { 'keelwerk-version': '2026-03-01' } });
    expect(() => resolveVersion(env, resolved, headed, principal)).toThrowError(
      expect.objectContaining({ code: 'core.api_version_retired' }),
    );
    expect(() =>
      resolveVersion(env, { app: 'a' } as unknown as ResolvedScope, headed, {} as Principal),
    ).toThrowError(expect.objectContaining({ code: 'core.api_version_retired' }));
  });
});
