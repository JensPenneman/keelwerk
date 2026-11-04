import { describe, expect, test } from 'vitest';
import { login } from '../../test/fixtures/modules/auth/src/actions/login.ts';
import { revokeSubject } from '../../test/fixtures/modules/auth/src/actions/revoke-subject.ts';
import { authBase } from '../../test/fixtures/modules/auth/src/base.ts';
import { resetPassword } from '../../test/fixtures/modules/auth/src/contributions/to-accounts/actions/profile/reset-password.ts';
import { whoami as accountsWhoami } from '../../test/fixtures/modules/auth/src/contributions/to-accounts/actions/whoami.ts';
import { toAccounts } from '../../test/fixtures/modules/auth/src/contributions/to-accounts/contribution.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { recordOutcome } from '../../test/fixtures/modules/hooks/src/actions/delivery/record-outcome.ts';
import { post } from '../../test/fixtures/modules/hooks/src/effects/post.ts';
import { hooks } from '../../test/fixtures/modules/hooks/src/module.generated.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { cancelTimer } from './cancel-timer.ts';
import { contracts } from './contracts.ts';
import { defineCommand } from './define-command.ts';
import { defineContract } from './define-contract.ts';
import { defineFlag } from './define-flag.ts';
import { defineSchedule } from './define-schedule.ts';
import { enqueue } from './enqueue.ts';
import { extensionPoint } from './extension-point.ts';
import { invoke } from './invoke.ts';
import { mapItems } from './map-items.ts';
import { mountName } from './mount-name.ts';
import { pageOf } from './page-of.ts';
import { rowOf } from './row-of.ts';
import { setTimer } from './set-timer.ts';
import { settle } from './settle.ts';
import { system } from './system.ts';
import { within } from './within.ts';

describe('the mounting records references', () => {
  test('module-level, entity, contributed and effect parts get the reference of their path', () => {
    expect(login.ref).toBe('auth.login');
    expect(auth.entities.credential.actions.revoke.ref).toBe('auth.credential.revoke');
    expect(accountsWhoami.ref).toBe('accounts.whoami');
    expect(resetPassword.ref).toBe('accounts.profile.resetPassword');
    expect(hooks.effects.post.ref).toBe('hooks.post');
    expect(auth.actions.login).toBe(login);
  });
});

describe('each constructor returns its F-07 payload', () => {
  test('invoke names an own action by value and a required module by reference', () => {
    const effect = invoke(revokeSubject, { subject: 's' as never, reason: 'why' });
    expect(effect).toEqual({
      kind: 'invoke',
      type: 'invoke',
      action: 'auth.revokeSubject',
      input: { subject: 's', reason: 'why' },
    });
    expect(Object.isFrozen(effect)).toBe(true);
    expect(invoke('accounts.profile.archive', { id: 'p' }, { prefer: 'async' })).toEqual({
      kind: 'invoke',
      type: 'invoke',
      action: 'accounts.profile.archive',
      input: { id: 'p' },
      prefer: 'async',
    });
  });

  test('invoke as the system principal carries the reason; an empty reason is refused', () => {
    const effect = invoke('accounts.profile.archive', { id: 'p' }, { as: system('clean up') });
    expect(effect.as).toEqual({ kind: 'system', reason: 'clean up' });
    expect(Object.isFrozen(system('x'))).toBe(true);
    const blank = '  ';
    expect(() => system(blank)).toThrow(KeelwerkError);
  });

  test('enqueue', () => {
    const runAt = Temporal.Instant.from('2026-11-04T10:00:00Z');
    const effect = enqueue(
      revokeSubject,
      { subject: 's' as never, reason: 'r' },
      { runAt, key: 'k' },
    );
    expect(effect).toEqual({
      kind: 'enqueue',
      type: 'enqueue',
      action: 'auth.revokeSubject',
      input: { subject: 's', reason: 'r' },
      runAt,
      key: 'k',
    });
    expect(Object.isFrozen(effect)).toBe(true);
    expect(enqueue('mail.send', 1)).toEqual({
      kind: 'enqueue',
      type: 'enqueue',
      action: 'mail.send',
      input: 1,
    });
  });

  test('setTimer, in both forms, and cancelTimer', () => {
    const effect = setTimer({
      key: 'node-offline:1',
      after: '45s',
      invoke: revokeSubject,
      input: { subject: 's' as never, reason: 'r' },
    });
    expect(effect).toEqual({
      kind: 'setTimer',
      type: 'setTimer',
      key: 'node-offline:1',
      after: '45s',
      action: 'auth.revokeSubject',
      input: { subject: 's', reason: 'r' },
    });
    const at = Temporal.Instant.from('2026-11-04T10:00:00Z');
    expect(setTimer({ key: 'k', at, invoke: 'core.noop', input: null })).toEqual({
      kind: 'setTimer',
      type: 'setTimer',
      key: 'k',
      at,
      action: 'core.noop',
      input: null,
    });
    expect(cancelTimer('k')).toEqual({ kind: 'cancelTimer', type: 'cancelTimer', key: 'k' });
    expect(Object.isFrozen(effect)).toBe(true);
  });

  test('settle', () => {
    expect(settle('eff_1', { ok: true, value: { status: 204 } })).toEqual({
      kind: 'settle',
      type: 'settle',
      effect: 'eff_1',
      outcome: { ok: true, value: { status: 204 } },
    });
  });

  test('an external effect carries its type, input and continuation by reference', () => {
    expect(hooks.effects.post).toBe(post);
    const deadline = Temporal.Instant.from('2026-11-05T00:00:00Z');
    const effect = post(
      { url: 'https://example.test', signingKey: 'sr' as never, body: '{}' },
      { continueWith: recordOutcome, with: { id: 'hdl_1' }, key: 'k', deadline },
    );
    expect(effect).toEqual({
      kind: 'external',
      type: 'hooks.post',
      input: { url: 'https://example.test', signingKey: 'sr', body: '{}' },
      continueWith: 'hooks.delivery.recordOutcome',
      with: { id: 'hdl_1' },
      key: 'k',
      deadline,
    });
    expect(Object.isFrozen(effect)).toBe(true);
  });

  test('a part that no module mounts has no reference, so an effect cannot name it', () => {
    const loose = defineCommand(authBase, { decide: () => [] });
    expect(() => invoke(loose, {})).toThrowError(KeelwerkError);
    expect(() => invoke(loose, {})).toThrowError(/no module mounts/);
  });
});

describe('declarations are plain data', () => {
  test('contracts, extension points, flags, schedules and outputs', () => {
    expect(defineContract('live', 'app')).toEqual(contracts.live);
    expect(extensionPoint.single().mode).toBe('single');
    expect(extensionPoint.set({ min: 1 })).toEqual({
      kind: 'extensionPoint',
      mode: 'set',
      options: { min: 1 },
    });
    expect(extensionPoint.ordered().mode).toBe('ordered');
    expect(
      defineFlag({ kind: 'boolean', default: true, level: 'tenant', purpose: 'kill-switch' }),
    ).toEqual({ kind: 'boolean', default: true, level: 'tenant', purpose: 'kill-switch' });
    const schedule = defineSchedule(authBase, {
      every: '5m',
      invoke: revokeSubject,
      scope: 'each-tenant',
    });
    expect(schedule.kind).toBe('schedule');
    expect(schedule.spec.every).toBe('5m');
  });

  test('within, mountName, pageOf, rowOf and mapItems', () => {
    expect(within(authBase, toAccounts).key).toBe('toAccounts');
    expect(within(authBase, toAccounts).section).toBe('contributions');
    expect(mountName(authBase, authBase.entities.credential)).toBe('credential');
    expect(mountName(authBase, 'profile')).toBe('profile');
    expect(pageOf(authBase.entities.session).form).toBe('page');
    expect(rowOf(authBase.entities.session).form).toBe('row');
    const source = { kind: 'liveSource' as const };
    expect(mapItems(source, (item) => item)).toMatchObject({ kind: 'liveSource', source });
  });
});
