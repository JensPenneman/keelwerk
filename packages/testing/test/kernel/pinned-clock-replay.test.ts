import { describe, expect, test } from 'vitest';
import { call, callWithId, local, ok, operatorHost } from './support/core-actions-kit.ts';
import { boot, deploymentOf, type Kind } from './support/runtime-kit.ts';

const kinds: readonly Kind[] = ['memory', 'pglite'];
const pins = [
  { name: 'far in the past', at: '2020-01-01T00:00:00Z' },
  { name: 'far in the future', at: '2040-01-01T00:00:00Z' },
] as const;

/**
 * A runtime started with an injected clock gives that clock to its data adapter too: a receipt
 * written at the pinned instant is still live when the same command id comes again, whatever the
 * wall clock says (architecture 7.9, decision 77). The deployment lists the adapter factory
 * without a clock of its own, as a real deployment does.
 */
describe.each(kinds)('a replay under a pinned clock on %s', (kind) => {
  test.each(pins)(
    '$name: the replay answers from the receipt and runs nothing again',
    {
      timeout: 60_000,
    },
    async ({ at }) => {
      const pinned = Temporal.Instant.from(at);
      const runtime = await boot(deploymentOf(kind, { operator: { hosts: [operatorHost] } }), {
        clock: { now: () => pinned },
      });

      const issue = () =>
        runtime.invoker.invoke<unknown, { id: string; token: string }>({
          action: 'core.operatorToken.issue',
          input: { label: 'laptop' },
          carrier: local,
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
          commandId: 'pinned-issue',
        });
      const first = await issue();
      expect(first).toMatchObject({ ok: true });
      // The token is shown once, so a replay is a conflict and issues no second token.
      expect(await issue()).toMatchObject({ ok: false, error: { kind: 'conflict' } });
      const tokens = await ok(call(runtime.invoker, local, 'core.operatorToken.query'));
      expect(tokens.items as unknown[]).toHaveLength(1);

      const input = { name: 'pinned', app: 'library', placement: 'main' };
      const created = await ok(
        callWithId(runtime.invoker, 'core.backend.create', input, 'pinned-create'),
      );
      const again = await ok(
        callWithId(runtime.invoker, 'core.backend.create', input, 'pinned-create'),
      );
      expect(again.id).toBe(created.id);
      const backends = await ok(call(runtime.invoker, local, 'core.backend.query', {}));
      expect(backends.items as unknown[]).toHaveLength(1);
    },
  );
});
