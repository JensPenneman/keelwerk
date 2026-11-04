import { describe, expect, test } from 'vitest';
import { ruleEntry } from '../../test/authorization/fixtures.ts';
import {
  actionOf,
  callOf,
  carrier,
  countingTracer,
  failureOf,
  invokerOf,
  registryOf,
  signedIn,
} from '../../test/invoker/invoker-kit.ts';

const allowSignedIn = ruleEntry({
  id: 'doc.signedIn',
  effect: 'allow',
  subject: { module: 'doc' },
  actions: ['*'],
  principal: 'user',
});
const policy = actionOf('doc.policy');
const open = actionOf('doc.open', { auth: 'public' });
const preparing = actionOf('doc.preparing', {
  kind: 'command',
  auth: 'public',
  prepare: () => ({}),
});
const noRules = registryOf([policy, open, preparing]);
const allowed = registryOf([policy, open], { rules: new Map([[allowSignedIn.id, allowSignedIn]]) });

describe('the order of the stages', () => {
  test('resolveScope comes before locate', async () => {
    const outcome = await invokerOf(noRules).invoke(
      callOf('doc.nothing', {}, { carrier: { transport: 'test', host: 'unknown.example' } }),
    );
    expect(failureOf(outcome).kind).toBe('not_found');
  });

  test('resolvePrincipal comes before locate: an invalid token wins over an unknown action', async () => {
    const bad = { transport: 'test', headers: { 'x-tenant': 't1', authorization: 'Bearer bad' } };
    const outcome = await invokerOf(noRules).invoke(callOf('doc.nothing', {}, { carrier: bad }));
    expect(failureOf(outcome).kind).toBe('unauthenticated');
  });

  test('locate comes before validate', async () => {
    const outcome = await invokerOf(noRules).invoke(
      callOf('doc.nothing', { n: 'wrong' }, { carrier }),
    );
    expect(failureOf(outcome)).toMatchObject({
      kind: 'not_implemented',
      code: 'core.not_implemented',
    });
  });

  test('validate comes before authorize', async () => {
    const outcome = await invokerOf(noRules).invoke(
      callOf('doc.policy', { n: 'wrong' }, { carrier }),
    );
    const error = failureOf(outcome);
    expect(error.kind).toBe('validation');
    expect(error.issues?.[0]?.path).toEqual(['n']);
  });

  test('authorize comes before execute: anonymous is unauthenticated, a user without a rule forbidden', async () => {
    const invoker = invokerOf(noRules);
    expect(failureOf(await invoker.invoke(callOf('doc.policy', { n: 1 }, { carrier }))).kind).toBe(
      'unauthenticated',
    );
    expect(
      failureOf(await invoker.invoke(callOf('doc.policy', { n: 1 }, { carrier: signedIn }))),
    ).toMatchObject({ kind: 'forbidden', code: 'core.forbidden' });
  });

  test('an allowed call reaches execute, where a failure is redacted outside development', async () => {
    const call = callOf('doc.policy', { n: 1 }, { carrier: signedIn });
    const production = failureOf(
      await invokerOf(allowed, { environment: 'production' }).invoke(call),
    );
    expect(production).toMatchObject({ kind: 'internal', code: 'core.internal' });
    expect(production.message).toBe('An internal error occurred.');
    const development = failureOf(
      await invokerOf(allowed, { environment: 'development' }).invoke(call),
    );
    expect(development.message).not.toBe('An internal error occurred.');
  });
});

describe('the prepare stage', () => {
  test('a command that declares prepare is refused with not_implemented before execute', async () => {
    let ran = false;
    const outcome = await invokerOf(noRules, {
      commands: async () => {
        ran = true;
        return { output: {} };
      },
    }).invoke(callOf('doc.preparing', { n: 1 }, { carrier }));
    expect(failureOf(outcome)).toMatchObject({
      kind: 'not_implemented',
      code: 'core.not_implemented',
    });
    expect(ran).toBe(false);
  });
});

describe('every invocation ends its span', () => {
  test('success and failure alike', async () => {
    const counting = countingTracer();
    const invoker = invokerOf(noRules, { tracer: counting.tracer });
    await invoker.invoke(callOf('doc.nothing', {}, { carrier }));
    await invoker.invoke(callOf('doc.policy', { n: 'x' }, { carrier }));
    await invoker.open(carrier);
    expect(counting.started()).toBeGreaterThanOrEqual(3);
    expect(counting.ended()).toBe(counting.started());
  });
});

describe('creation', () => {
  test('refuses a deployment without the core app', () => {
    expect(() =>
      invokerOf(noRules, {
        apps: new Map([['doc', { registry: noRules, head: '2026-11-01' }]]),
      }),
    ).toThrowError(expect.objectContaining({ code: 'core.internal' }));
  });

  test.each(['scopeKey', 'path'] as const)(
    'refuses the %s resolver with the named problem',
    (kind) => {
      expect(() => invokerOf(noRules, { tenantResolution: [{ kind }] })).toThrowError(
        expect.objectContaining({
          details: expect.objectContaining({ code: 'scopeDirectoryUnavailable' }),
        }),
      );
    },
  );
});
