import {
  defineApp,
  defineCommand,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  invoke,
  shape,
  system,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { asOperator } from './support/targeting-kit.ts';

const base = defineModuleBase({ id: 'nested', version: '0.1.0' });
const input = shape({
  backendId: field.string(),
  tenantId: field.string(),
  asSystem: field.boolean(),
});
const setLimit = defineCommand(base, {
  input,
  scope: 'deployment',
  principal: 'operator',
  decide: (given) => ({
    events: [],
    effects: [
      invoke(
        'core.quota.set',
        {
          dimension: 'core.requestRate',
          backendId: given.backendId,
          tenantId: given.tenantId,
          limit: '100/1m',
          reason: 'nested',
        },
        given.asSystem ? { as: system('a reaction of the deployment') } : {},
      ),
    ],
  }),
});
const app = defineApp({
  id: 'nested-app',
  modules: [
    defineModule(base, {
      actions: { setLimit },
      policies: {
        setLimit: {
          operators: defineRule(base, setLimit, { effect: 'allow', principal: 'operator' }),
        },
      },
    }),
  ],
});

describe('a nested invoke of core.quota.set', () => {
  test.each([
    ['as the operator who called', false],
    ['as the system', true],
  ])('is refused %s, and no row exists', async (_name, asSystem) => {
    const runtime = await startTestRuntime(app, { operators: true, tenants: ['acme'] });
    try {
      const outcome = await asOperator(runtime, 'nested.setLimit', {
        backendId: runtime.backendId,
        tenantId: runtime.tenants.acme.id,
        asSystem,
      });
      // Both reach the write path's own refusal of a nested core.quota.set (the system principal passes
      // the invoke gate, and the operator's gate admits core.quota.set); the caller sees the public text
      // of core.forbidden, the refusal's own text ('operator socket') is pinned in refuse-generated-write.test.ts.
      expect(outcome).toMatchObject({
        ok: false,
        error: {
          kind: 'forbidden',
          code: 'core.forbidden',
          message: 'The caller is not allowed to do this.',
        },
      });
      const rows = await asOperator(runtime, 'core.quota.query', {});
      expect(rows.ok && (rows.value as { items?: unknown[] }).items).toEqual([]);
    } finally {
      await runtime.stop();
    }
  });
});
