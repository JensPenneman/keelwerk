import { describe, expect, test } from 'vitest';
import { bootFlags, variables } from './support/flags-kit.ts';
import { gatedInvokeApp } from './support/gated-invoke-kit.ts';

const closed = {
  ok: false,
  error: {
    kind: 'forbidden',
    code: 'core.feature_disabled',
    rules: [{ id: 'pipes.target.gate', effect: 'deny' }],
  },
};
const openEnv = () => variables(['KEELWERK_FLAG_PIPES_OPEN', 'true']);

describe('a closed gate on every path to an action', () => {
  test('(a) an external call of the gated action is refused with forbidden core.feature_disabled', async () => {
    const { call, events } = await bootFlags(gatedInvokeApp);
    expect(await call('pipes.target', {}, crypto.randomUUID())).toMatchObject(closed);
    expect(await events()).toEqual([]);
  });

  test('(b) a command whose decision invokes the gated action is refused with forbidden core.feature_disabled and writes nothing', async () => {
    const { call, events } = await bootFlags(gatedInvokeApp);
    expect(await call('pipes.relay', {}, crypto.randomUUID())).toMatchObject(closed);
    expect(await events()).toEqual([]);
  });

  test('(c) an inline reaction that invokes the gated action is refused with forbidden core.feature_disabled and writes nothing', async () => {
    const { call, events } = await bootFlags(gatedInvokeApp);
    expect(await call('pipes.put', {}, crypto.randomUUID())).toMatchObject(closed);
    expect(await events()).toEqual([]);
  });

  test('(d) with the gate open the external call, the invoke effect and the inline reaction all run', async () => {
    const { call, events } = await bootFlags(gatedInvokeApp, { env: openEnv() });
    expect(await call('pipes.target', {}, crypto.randomUUID())).toMatchObject({ ok: true });
    expect(await call('pipes.relay', {}, crypto.randomUUID())).toMatchObject({ ok: true });
    expect(await call('pipes.put', {}, crypto.randomUUID())).toMatchObject({ ok: true });
    const types = (await events()).map((event) => event.type);
    expect(types.filter((type) => type === 'pipes.mark.created')).toHaveLength(3);
  });
});
