import type { Invocation, InvocationDecision } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { ada, call, failure, kit, publicQuery } from './support/invoker-kit.ts';

function recorder() {
  const decisions: InvocationDecision[] = [];
  return { decisions, onDecision: (decision: InvocationDecision) => decisions.push(decision) };
}

describe('the decision hook of the invoker', () => {
  test('reports stage complete and the allow rules of an allowed invocation', async () => {
    const { decisions, onDecision } = recorder();
    const { invoker } = kit({ onDecision });
    const outcome = await invoker.invoke(
      call('library.findByIsbn', { isbn: 'isbn-2' }, { carrier: ada }),
    );
    expect(outcome.ok).toBe(true);
    expect(decisions).toHaveLength(1);
    const [decision] = decisions;
    expect(decision).toMatchObject({
      kind: 'invoke',
      requestId: 'req-1',
      action: 'library.findByIsbn',
      transport: 'test',
      stage: 'complete',
    });
    expect(decision?.error).toBeUndefined();
    expect(decision?.rules).toEqual([{ id: 'library.findByIsbn.signedIn', effect: 'allow' }]);
  });

  test('reports the denying rule ids and stage authorize of a forbidden invocation', async () => {
    const { decisions, onDecision } = recorder();
    const probe = publicQuery('gated', () => 1, { auth: 'policy' });
    const denyId = 'library.gated.deny';
    const gated = {
      ref: probe.ref,
      registry: {
        ...probe.registry,
        rules: new Map([
          ...probe.registry.rules,
          [
            denyId,
            {
              id: denyId,
              module: 'library',
              effect: 'deny' as const,
              subject: { kinds: ['query' as const] },
              actions: ['gated'],
              reason: 'The probe is closed.',
              disabled: false,
            },
          ],
        ]),
      },
    };
    const { invoker } = kit({ registry: gated.registry, onDecision });
    const error = failure(await invoker.invoke(call(gated.ref, {}, { carrier: ada })));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.stage).toBe('authorize');
    expect(decisions[0]?.rules).toEqual([{ id: denyId, effect: 'deny' }]);
    expect(error.rules).toEqual(decisions[0]?.rules);
    expect(decisions[0]?.error?.code).toBe(error.code);
  });

  test('reports the stage a failure stopped at', async () => {
    const { decisions, onDecision } = recorder();
    const { invoker } = kit({ onDecision });
    await invoker.invoke(call('library.findByIsbn', { isbn: 7 }, { carrier: ada }));
    await invoker.invoke(call('library.nothing', {}, { carrier: ada }));
    await invoker.invoke(
      call(
        'library.findByIsbn',
        { isbn: 'x' },
        { carrier: { transport: 'test', headers: { 'x-tenant': 'tnt-unknown' } } },
      ),
    );
    expect(decisions.map((decision) => decision.stage)).toEqual(['validate', 'locate', 'open']);
    expect(decisions.every((decision) => decision.error !== undefined)).toBe(true);
  });

  test('a hook that throws changes no outcome', async () => {
    const calls: Invocation<unknown>[] = [
      call('library.findByIsbn', { isbn: 'isbn-2' }, { carrier: ada }),
      call('library.findByIsbn', { isbn: 7 }, { carrier: ada }),
      call('library.nothing', {}, { carrier: ada }),
    ];
    const throwing = kit({
      onDecision: () => {
        throw new Error('broken hook');
      },
    });
    const plain = kit();
    for (const one of calls) {
      const withHook = await throwing.invoker.invoke(one);
      const without = await plain.invoker.invoke(one);
      expect(withHook).toEqual(without);
    }
  });
});
