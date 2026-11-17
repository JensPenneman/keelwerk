import { describe, expect, test } from 'vitest';
import {
  actionOf,
  callOf,
  carrier,
  invokerOf,
  registryOf,
} from '../../test/invoker/invoker-kit.ts';
import type { CommandRun } from './command-runner.ts';

const preparing = actionOf('doc.preparing', {
  kind: 'command',
  auth: 'public',
  prepare: () => ({}),
});
const registry = registryOf([preparing]);

/** The boot nonce the command runner of one invoker is handed by two commands. */
async function nonceSeenBy(
  environment: 'development' | 'test' | 'production',
  times = 2,
): Promise<readonly (string | undefined)[]> {
  const seen: (string | undefined)[] = [];
  const invoker = invokerOf(registry, {
    environment,
    commands: (run: CommandRun) => {
      seen.push(run.bootNonce);
      return Promise.resolve({ output: {} });
    },
  });
  for (let call = 0; call < times; call += 1) {
    await invoker.invoke(callOf('doc.preparing', { n: 1 }, { carrier }));
  }
  return seen;
}

describe('the boot nonce of an invoker', () => {
  test('a development invoker hands the same new text to every command it runs; another invoker hands another', async () => {
    const [first, again] = await nonceSeenBy('development');
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(again).toBe(first);
    const [other] = await nonceSeenBy('development', 1);
    expect(other).toMatch(/^[0-9a-f-]{36}$/);
    expect(other).not.toBe(first);
  });

  test('a test or production invoker hands none', async () => {
    expect(await nonceSeenBy('test')).toEqual([undefined, undefined]);
    expect(await nonceSeenBy('production')).toEqual([undefined, undefined]);
  });
});
