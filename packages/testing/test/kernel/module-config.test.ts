import {
  defineApp,
  defineCommand,
  defineHook,
  defineModule,
  defineModuleBase,
  defineQuery,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createLocalClient, startTestRuntime, testPrincipal } from '../../src/index.ts';

const knobsBase = defineModuleBase({
  id: 'knobs',
  version: '0.1.0',
  config: shape({
    greeting: field.string().default('hello'),
    shout: field.boolean().default(false),
  }),
});

const peek = defineQuery(knobsBase, {
  input: shape({}),
  output: shape({ greeting: field.string(), shout: field.boolean() }),
  principal: 'user',
  read: (_input, ctx) => ({ greeting: ctx.config.greeting, shout: ctx.config.shout }),
});

const poke = defineCommand(knobsBase, {
  input: shape({}),
  output: shape({ greeting: field.string(), shout: field.boolean() }),
  execution: 'sync',
  principal: 'user',
  decide: (_input, ctx) => ({
    events: [],
    result: { greeting: ctx.config.greeting, shout: ctx.config.shout },
  }),
});

const knobs = defineModule(knobsBase, {
  actions: { peek, poke },
  policies: {
    peek: { open: defineRule(knobsBase, peek, { effect: 'allow', principal: 'user' }) },
    poke: { open: defineRule(knobsBase, poke, { effect: 'allow', principal: 'user' }) },
  },
});

const app = defineApp({ id: 'knobs-app', modules: [knobs] as const });
const ada = testPrincipal('ada');

describe('ctx.config in a running runtime (S-104a)', () => {
  test('a command and a read see the setting of their backend, the default for what is unset', async () => {
    const set = await startTestRuntime(app, {
      tenants: ['acme'],
      config: { knobs: { greeting: 'hi' } },
    });
    onTestFinished(() => set.stop());
    const client = createLocalClient(set, { principal: ada });
    expect(await client.invoke('knobs.peek', {})).toEqual({ greeting: 'hi', shout: false });
    expect(await client.invoke('knobs.poke', {})).toEqual({ greeting: 'hi', shout: false });
  });

  test('a backend without any setting reads the defaults of the module', async () => {
    const bare = await startTestRuntime(app, { tenants: ['acme'] });
    onTestFinished(() => bare.stop());
    const client = createLocalClient(bare, { principal: ada });
    expect(await client.invoke('knobs.peek', {})).toEqual({ greeting: 'hello', shout: false });
    expect(await client.invoke('knobs.poke', {})).toEqual({ greeting: 'hello', shout: false });
  });
});

describe('ctx.config beyond commands and reads (S-106)', () => {
  const claimBase = defineModuleBase({
    id: 'claims',
    version: '0.1.0',
    config: shape({ greeting: field.string().default('hello') }),
  });
  const seen: unknown[] = [];
  const claim = defineQuery(claimBase, {
    input: shape({}),
    output: shape({ greeting: field.string() }),
    principal: 'user',
    read: (_input, ctx) => ({ greeting: String(ctx.principal.claims.greeting) }),
  });
  const claims = defineModule(claimBase, {
    actions: { claim },
    policies: {
      claim: { open: defineRule(claimBase, claim, { effect: 'allow', principal: 'user' }) },
    },
    lifecycle: {
      onCreated: defineHook(claimBase, 'onTenantCreated', (_payload, ctx) => {
        seen.push(ctx.config.greeting);
        return { events: [] };
      }),
      onBackend: defineHook(claimBase, 'onBackendCreated', (_payload, ctx) => {
        seen.push(ctx.config.greeting);
        return { events: [] };
      }),
    },
  });
  const plain = defineApp({ id: 'claims-app', modules: [claims] as const });
  const resolver = (greeting: string) => ({
    id: 'claims.resolver',
    describe: () => ({ scheme: 'apiKey' as const, name: 'x-claims' }),
    *resolve() {
      return {
        principal: {
          kind: 'user' as const,
          subject: 'ada' as never,
          subjectRef: null,
          subjectAs: () => null,
          scope: { backend: null, tenant: null },
          claims: { greeting },
          roles: [],
          memberships: [],
          via: 'claims.resolver',
          ref: null,
        },
      };
    },
  });
  const app = {
    ...plain,
    registry: {
      ...plain.registry,
      fills: new Map([
        ...plain.registry.fills,
        [
          'core.principalResolvers',
          [
            {
              point: 'core.principalResolvers',
              module: 'claims',
              bound: true,
              fill: (ctx: { readonly config: { readonly greeting: string } }) =>
                resolver(ctx.config.greeting),
            },
            ...(plain.registry.fills.get('core.principalResolvers') ?? []),
          ],
        ],
      ]),
    },
  } as typeof plain;

  test('a bound principal resolver and the tenant hooks see the setting of their backend', async () => {
    seen.length = 0;
    const runtime = await startTestRuntime(app, {
      tenants: ['acme'],
      config: { claims: { greeting: 'hi' } },
    });
    onTestFinished(() => runtime.stop());
    expect(seen).toEqual(expect.arrayContaining(['hi']));
    expect(seen.every((one) => one === 'hi')).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    const client = createLocalClient(runtime, { principal: ada });
    expect(await client.invoke('claims.claim', {})).toEqual({ greeting: 'hi' });
  });
});
