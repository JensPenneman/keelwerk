import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { core } from '../core-module/module.ts';
import { composeApp } from '../registry/compose-app.ts';
import { defineApiVersions } from './define-api-versions.ts';
import { defineApp } from './define-app.ts';
import { defineQuery } from './define-query.ts';

describe('defineApp (section 4.5)', () => {
  test('puts the core module first and keeps the author order after it', () => {
    const app = defineApp({ id: 'portal', modules: [accounts, auth] });
    expect(app.kind).toBe('app');
    expect(app.id).toBe('portal');
    expect(app.modules.map((module) => module.id)).toEqual(['core', 'accounts', 'auth']);
    expect(app.modules[0]).toBe(core);
  });

  test('keeps the options the compose seam reads', () => {
    const health = defineQuery([accounts] as const, { read: () => undefined });
    const api = defineApiVersions({ '2026-11-04': {} });
    const app = defineApp({
      id: 'portal',
      modules: [accounts],
      actions: { health },
      execution: { 'accounts.profile.deactivate': 'either' },
      authorization: { mode: 'strict', decisionLog: 'denials' },
      policies: { disable: ['accounts.profile.operator'] },
      api,
      flags: {},
    });
    expect(app.appActions.health).toBe(health);
    expect(app.execution).toEqual({ 'accounts.profile.deactivate': 'either' });
    expect(app.authorization).toEqual({ mode: 'strict', decisionLog: 'denials' });
    expect(app.policies).toEqual({ disable: ['accounts.profile.operator'] });
    expect(app.api).toBe(api);
  });

  test('defaults every option to empty', () => {
    const app = defineApp({ id: 'bare', modules: [] });
    expect(app.modules).toEqual([core]);
    expect(app.execution).toEqual({});
    expect(app.appActions).toEqual({});
    expect(app.authorization).toEqual({});
    expect(app.policies).toEqual({});
    expect(app.api).toBeNull();
    expect(app.flags).toEqual({});
  });

  test('carries the composed registry, with no error problems', () => {
    const app = defineApp({ id: 'portal', modules: [accounts, auth] });
    expect(app.registry.app).toBe('portal');
    expect(app.registry.entities.has('accounts.profile')).toBe(true);
    expect(app.registry.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
  });

  test('the compose seam passes a valid app through', () => {
    const value = defineApp({ id: 'bare', modules: [] });
    expect(composeApp(value)).toBe(value);
  });
});
