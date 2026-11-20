import { expect, test } from 'vitest';
import { keysUnit } from '../../test/request-keys-kit.ts';
import type { DecisionRecord } from '../events/decision-record.ts';
import { recordedInputOf } from './recorded-input-of.ts';

const sealedFor = async (kit: ReturnType<typeof keysUnit>, commandId: string, field: string) =>
  kit.unit.keys.sealValue(
    { entity: 'core.decision', id: commandId, field },
    new TextEncoder().encode('{"title":"Dune"}'),
  );
const recordOf = (input: DecisionRecord['input']) =>
  ({ part: 'x.y', inputDigest: 'd', reads: [], answers: [], effects: [], input }) as DecisionRecord;

test('the sealed input opens for its own command', async () => {
  const kit = keysUnit();
  const sealed = await sealedFor(kit, 'cmd-1', 'input');
  expect(await recordedInputOf(kit.unit, recordOf(sealed), 'cmd-1', undefined)).toEqual({
    title: 'Dune',
  });
});

test('a value sealed for another command, or for another field, is refused naming the record, not handed on', async () => {
  const kit = keysUnit();
  const other = await sealedFor(kit, 'cmd-2', 'input');
  await expect(
    recordedInputOf(kit.unit, recordOf(other), 'cmd-1', undefined),
  ).rejects.toMatchObject({ kind: 'internal', message: expect.stringContaining('cmd-1') });
  const request = await sealedFor(kit, 'cmd-1', 'request');
  await expect(
    recordedInputOf(kit.unit, recordOf(request), 'cmd-1', undefined),
  ).rejects.toMatchObject({ kind: 'internal' });
});

test('a destroyed key is core.replay_key_destroyed naming the recorded input', async () => {
  const kit = keysUnit();
  const sealed = await sealedFor(kit, 'cmd-1', 'input');
  kit.valueKeys.delete(sealed.keyId);
  await expect(
    recordedInputOf(kit.unit, recordOf(sealed), 'cmd-1', undefined),
  ).rejects.toMatchObject({
    code: 'core.replay_key_destroyed',
    message: expect.stringContaining('the recorded input'),
  });
});
