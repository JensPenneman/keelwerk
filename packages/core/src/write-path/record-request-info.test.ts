import { describe, expect, test } from 'vitest';
import { keysUnit } from '../../test/request-keys-kit.ts';
import type { DecisionRecord } from '../events/decision-record.ts';
import type { Principal } from '../principals/principal.ts';
import { recordedRequestOf } from '../replay/recorded-request-of.ts';
import { recordRequestInfo } from './record-request-info.ts';

const subject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';
const user = { kind: 'user', subject, via: 'session' } as unknown as Principal;
const service = {
  kind: 'service',
  id: 'module:probe',
  via: 'module',
  ref: { resolver: 'keys', principalId: 'row-1' },
} as unknown as Principal;
const anonymous = { kind: 'anonymous', via: 'direct' } as unknown as Principal;
const record = (request: DecisionRecord['request']) =>
  ({
    part: 'x.y',
    inputDigest: 'd',
    reads: [],
    answers: [],
    effects: [],
    request,
  }) as DecisionRecord;

describe('recordRequestInfo', () => {
  test('a user principal in a tenant gets a $kwe 2 envelope under the subject data key that opens to what was read', async () => {
    const kit = keysUnit();
    const sealed = await recordRequestInfo(kit.unit, 'cmd-1', user, {
      transport: 'rest',
      userAgent: 'curl/8.7.1',
    });
    const key = await kit.unit.keys.dataKey(subject, { create: false });
    expect(sealed).toMatchObject({ $kwe: 2, k: key?.id });
    expect(kit.valueKeys.size).toBe(0);
    const opened = await recordedRequestOf(kit.unit, record(sealed), 'cmd-1', 'req-1', undefined);
    expect(opened.kept).toEqual(['transport', 'userAgent']);
    expect(opened.request).toEqual({
      transport: 'rest',
      requestId: 'req-1',
      userAgent: 'curl/8.7.1',
    });
    expect(JSON.stringify(sealed)).not.toContain('curl');
  });

  test('after the subject is shredded the record no longer opens: core.replay_key_destroyed naming the recorded request', async () => {
    const kit = keysUnit();
    const sealed = await recordRequestInfo(kit.unit, 'cmd-1', user, { userAgent: 'curl/8.7.1' });
    kit.shred(subject);
    await expect(
      recordedRequestOf(kit.unit, record(sealed), 'cmd-1', 'req-1', undefined),
    ).rejects.toMatchObject({
      code: 'core.replay_key_destroyed',
      message: expect.stringContaining('the recorded request'),
    });
  });

  test('an envelope sealed for another command does not open for this one', async () => {
    const kit = keysUnit();
    const sealed = await recordRequestInfo(kit.unit, 'cmd-1', user, { userAgent: 'curl/8.7.1' });
    await expect(
      recordedRequestOf(kit.unit, record(sealed), 'cmd-2', 'req-1', undefined),
    ).rejects.toMatchObject({ kind: 'internal', message: expect.stringContaining('cmd-2') });
  });

  test('a user principal whose subject was shredded first is refused with forbidden', async () => {
    const kit = keysUnit();
    await kit.unit.keys.dataKey(subject, { create: true });
    kit.shred(subject);
    await expect(
      recordRequestInfo(kit.unit, 'cmd-1', user, { transport: 'rest' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('an anonymous principal gets a value sealed under core.decision/<id>/request, canonical, only the members read', async () => {
    const kit = keysUnit();
    const sealed = await recordRequestInfo(kit.unit, 'cmd-1', anonymous, {
      userAgent: 'curl/8.7.1',
      transport: 'rest',
    });
    await recordRequestInfo(kit.unit, 'cmd-2', anonymous, { transport: 'local' });
    expect('$kwe' in sealed).toBe(false);
    expect([...kit.valueKeys.values()]).toEqual([
      {
        binding: { entity: 'core.decision', id: 'cmd-1', field: 'request' },
        plain: '{"transport":"rest","userAgent":"curl/8.7.1"}',
      },
      {
        binding: { entity: 'core.decision', id: 'cmd-2', field: 'request' },
        plain: '{"transport":"local"}',
      },
    ]);
  });

  test('a decision that read only the connection seals exactly {"connection":true}, and a re-decide is given the address, never the record', async () => {
    const kit = keysUnit();
    const sealed = await recordRequestInfo(kit.unit, 'cmd-1', anonymous, { connection: true });
    expect([...kit.valueKeys.values()].map((held) => held.plain)).toEqual(['{"connection":true}']);
    const connection = {
      id: 'conn-1',
      listener: 'http',
      remote: { address: '10.0.0.1', port: 5000 },
      local: { address: '10.0.0.2', port: 443 },
    };
    const opened = await recordedRequestOf(kit.unit, record(sealed), 'cmd-1', 'r', undefined);
    expect(opened.kept).toEqual(['connection']);
    expect(opened.request).toEqual({ transport: 'replay', requestId: 'r' });
    const given = await recordedRequestOf(kit.unit, record(sealed), 'cmd-1', 'r', { connection });
    expect(given.request).toEqual({ transport: 'replay', requestId: 'r', connection });
  });

  test('a sealed value opened for another command id is refused, and a destroyed key is core.replay_key_destroyed', async () => {
    const kit = keysUnit();
    const sealed = await recordRequestInfo(kit.unit, 'cmd-1', anonymous, { transport: 'rest' });
    const opened = await recordedRequestOf(kit.unit, record(sealed), 'cmd-1', 'r', undefined);
    expect(opened.kept).toEqual(['transport']);
    expect(opened.request).toEqual({ transport: 'rest', requestId: 'r' });
    await expect(
      recordedRequestOf(kit.unit, record(sealed), 'cmd-2', 'r', undefined),
    ).rejects.toMatchObject({ kind: 'internal', message: expect.stringContaining('cmd-2') });
    if ('keyId' in sealed) kit.valueKeys.delete(sealed.keyId);
    await expect(
      recordedRequestOf(kit.unit, record(sealed), 'cmd-1', 'r', undefined),
    ).rejects.toMatchObject({ code: 'core.replay_key_destroyed' });
  });

  test('a user principal in a backend unit gets a value sealed under a key of its own', async () => {
    const kit = keysUnit({ level: 'backend', backendId: 'b1' });
    const sealed = await recordRequestInfo(kit.unit, 'cmd-1', user, { transport: 'rest' });
    expect('$kwe' in sealed).toBe(false);
    expect(kit.valueKeys.size).toBe(1);
  });

  test('a principal with an id seals under the long-lived key of ref.principalId, not of principal.id: one key for all its commands, the command inside', async () => {
    const kit = keysUnit();
    const first = await recordRequestInfo(kit.unit, 'cmd-1', service, { userAgent: 'agent/1' });
    const second = await recordRequestInfo(kit.unit, 'cmd-2', service, { transport: 'rest' });
    expect([first, second].map((sealed) => 'keyId' in sealed && sealed.keyId)).toEqual([
      'principal:row-1',
      'principal:row-1',
    ]);
    expect([...kit.valueKeys.keys()]).toEqual(['principal:row-1']);
    const opened = await recordedRequestOf(kit.unit, record(first), 'cmd-1', 'r', undefined);
    expect(opened.request).toEqual({ transport: 'replay', requestId: 'r', userAgent: 'agent/1' });
    await expect(
      recordedRequestOf(kit.unit, record(first), 'cmd-2', 'r', undefined),
    ).rejects.toMatchObject({ kind: 'internal', message: expect.stringContaining('cmd-2') });
    kit.valueKeys.delete('principal:row-1');
    await expect(
      recordedRequestOf(kit.unit, record(second), 'cmd-2', 'r', undefined),
    ).rejects.toMatchObject({ code: 'core.replay_key_destroyed' });
  });

  test('two principals with different ids seal under two keys, and a user outside a tenant under the key of its id', async () => {
    const kit = keysUnit({ level: 'backend', backendId: 'b1' });
    const other = { ...user, ref: { resolver: 'sessions', principalId: 'session-9' } } as Principal;
    await recordRequestInfo(kit.unit, 'cmd-1', service, { transport: 'rest' });
    await recordRequestInfo(kit.unit, 'cmd-2', other, { transport: 'rest' });
    expect([...kit.valueKeys.keys()]).toEqual(['principal:row-1', 'principal:session-9']);
  });
});
