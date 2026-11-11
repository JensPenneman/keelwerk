import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineFlag } from '../dsl/define-flag.ts';
import { placeholderPrincipal } from '../invoker/edge/placeholder-principal.ts';
import type { Logger } from '../observability/logger.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { Scope } from '../storage/scope.ts';
import { createFlagTelemetry } from './create-flag-telemetry.ts';
import { evaluateClientFlag } from './evaluate-client-flag.ts';
import type { FlagProvider } from './flag-provider.ts';
import type { FlagTelemetry } from './flag-telemetry.ts';

const registry = buildRegistry(
  appOf([
    makeModule({
      id: 'shop',
      flags: {
        layout: defineFlag({
          kind: 'variant',
          variants: ['control', 'compact'],
          default: 'control',
          level: 'principal',
          purpose: 'experiment',
          expires: '2027-06-30',
          client: true,
        }),
        bannerUrl: defineFlag({
          kind: 'string',
          default: 'https://shop.example/banner',
          level: 'tenant',
          purpose: 'operational',
          expires: '2027-06-30',
          client: true,
        }),
        hidden: defineFlag({
          kind: 'boolean',
          default: false,
          level: 'tenant',
          purpose: 'release',
          expires: '2027-06-30',
          client: false,
        }),
      },
    }),
  ]),
);
const scope: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};
const serving: FlagProvider = {
  id: 'core.targeting',
  sync: true,
  start: () => Promise.resolve(),
  resolve: <T>() =>
    ({
      value: 'compact',
      variant: 'compact',
      reason: 'TARGETING_MATCH',
      ruleId: 'secret-rule',
      ruleVersion: 7,
      provider: 'core.targeting',
    }) as never as T,
};

function ask(
  key: string,
  overrides: {
    clientId?: string | null;
    providers?: FlagProvider[];
    telemetry?: FlagTelemetry;
  } = {},
) {
  return evaluateClientFlag({
    registry,
    key,
    scope,
    principal: placeholderPrincipal(scope),
    clientId: overrides.clientId ?? null,
    providers: overrides.providers ?? [serving],
    telemetry: overrides.telemetry,
    log,
  });
}

describe('evaluateClientFlag', () => {
  test('a client flag answers its resolution without rule id or provider', async () => {
    const document = await ask('shop.layout', { clientId: 'client-1' });
    expect(document).toEqual({
      key: 'shop.layout',
      value: 'compact',
      variant: 'compact',
      reason: 'TARGETING_MATCH',
    });
  });

  test('an unknown key and a server-only key answer the same not_found', async () => {
    const unknown = await ask('shop.nothing').catch((error: unknown) => error);
    const serverOnly = await ask('shop.hidden').catch((error: unknown) => error);
    expect(unknown).toMatchObject({ kind: 'not_found', code: 'core.not_found' });
    expect(serverOnly).toMatchObject({ kind: 'not_found', code: 'core.not_found' });
    expect((unknown as Error).message.replace('nothing', 'x')).toBe(
      (serverOnly as Error).message.replace('hidden', 'x'),
    );
  });

  test('an anonymous caller without a client id gets TARGETING_KEY_MISSING for a principal-level client flag', async () => {
    const document = await ask('shop.layout', { providers: [] });
    expect(document).toMatchObject({
      key: 'shop.layout',
      value: 'control',
      reason: 'ERROR',
      errorCode: 'TARGETING_KEY_MISSING',
    });
  });

  test('the evaluation counter never carries the served value of a client string flag', async () => {
    const served = 'https://internal.example/banner';
    const targeted: FlagProvider = {
      id: 'core.targeting',
      sync: true,
      start: () => Promise.resolve(),
      resolve: <T>() =>
        ({
          value: served,
          variant: served,
          reason: 'TARGETING_MATCH',
          ruleId: 'pilot',
          provider: 'core.targeting',
        }) as never as T,
    };
    const points: unknown[] = [];
    const meter = {
      createCounter: () => ({
        add: (_value: number, attributes: unknown) => {
          points.push(attributes);
        },
      }),
    } as never;
    const document = await ask('shop.bannerUrl', {
      providers: [targeted],
      telemetry: createFlagTelemetry(meter),
    });
    expect(document).toMatchObject({ value: served });
    expect(points).toEqual([
      { flag: 'shop.bannerUrl', variant: 'rule:pilot', reason: 'TARGETING_MATCH', backend: 'b1' },
    ]);
    expect(JSON.stringify(points)).not.toContain('internal.example');
  });
});
