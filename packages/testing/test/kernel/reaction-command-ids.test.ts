import { kernelCommandId } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { bootReactions, relayOwner, tenantEventsOf } from './support/reactions-kit.ts';

const kit = await bootReactions({ watched: true });
afterAll(() => kit.stop());
const { runtime } = kit;

const reserved = { kind: 'validation', code: 'core.command_id_reserved' };
const echoesOf = async (reaction: string) =>
  (await kit.rows('acme', 'relay.echo')).filter((row) => row.reaction === reaction);
const deadOf = () => kit.spy?.completions.filter((one) => one.outcome.kind === 'dead') ?? [];
const createdOf = async (signalId: string) => {
  const created = (await tenantEventsOf(kit, 'acme')).find(
    (event) => event.type === 'relay.signal.created' && event.stream.id === signalId,
  );
  if (created === undefined) throw new Error('the signal event is missing');
  return created;
};
const sendSignal = async (channel: string): Promise<string> => {
  const sent = await kit.send('acme', { channel });
  if (!sent.ok) throw sent.error;
  return sent.value.signalId;
};
/** What a transport hands the invoker: an invocation that carries the id the client chose. */
const invokeWith = (action: string, input: unknown, commandId: string) =>
  runtime.invoker.invoke({
    action,
    input,
    commandId,
    carrier: testCarrier(runtime.tenants.acme, testPrincipal(relayOwner)),
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });

describe('the command ids the kernel makes itself', () => {
  test('an enqueue that claims the id of a reaction job, of a continuation or of an effect is refused, and the reaction still decides', async () => {
    const signalId = await sendSignal('claimed');
    const created = await createdOf(signalId);
    for (const id of [
      kernelCommandId('reaction', 'relay.echo', created.eventId),
      kernelCommandId('continuation', created.eventId),
      kernelCommandId('effect', created.eventId),
    ]) {
      const outcome = await kit.call('acme', 'relay.claim', { commandId: id });
      expect(outcome).toMatchObject({ ok: false, error: reserved });
    }
    await kit.settle();
    expect((await echoesOf('relay.echo')).filter((row) => row.signal === signalId)).toHaveLength(1);
    expect(deadOf()).toEqual([]);
    // Nothing of the claim was recorded: no receipt under the id of the reaction job but its own.
    const mine = await runtime.adapter.unit(runtime.namespace, kit.scopeOf('acme'), (unit) =>
      unit.receipts.get(kernelCommandId('reaction', 'relay.echo', created.eventId)),
    );
    expect(mine).toMatchObject({ action: 'relay.echo', status: 'completed' });
  });

  test('a client command id in the kernel form is refused for any command, and no receipt is written', async () => {
    const id = kernelCommandId('reaction', 'relay.echo', 'e1');
    const input = { channel: 'x', text: 'y', owner: relayOwner };
    expect(await invokeWith('relay.send', input, id)).toMatchObject({ ok: false, error: reserved });
    const receipt = await runtime.adapter.unit(runtime.namespace, kit.scopeOf('acme'), (unit) =>
      unit.receipts.get(id),
    );
    expect(receipt).toBeUndefined();
    // Any other id passes.
    expect(await invokeWith('relay.send', input, 'relay.echo:e1')).toMatchObject({ ok: true });
  });

  test('the form that was the id of a reaction job before is an ordinary id now, and claims nothing of the kernel', async () => {
    const signalId = await sendSignal('old-form');
    const created = await createdOf(signalId);
    const claimed = await kit.call('acme', 'relay.claim', {
      commandId: `relay.echo:${created.eventId}`,
    });
    expect(claimed.ok).toBe(true);
    await kit.settle();
    expect((await echoesOf('relay.echo')).filter((row) => row.signal === signalId)).toHaveLength(1);
    expect((await echoesOf('relay.note')).some((row) => row.signal === 'claimed')).toBe(true);
    expect(deadOf()).toEqual([]);
  });
});
