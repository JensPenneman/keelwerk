import { parseSealedValueText } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { runInMemory } from '../../src/drive/run-in-memory.ts';
import { vaultApp } from '../../src/fixtures/index.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';

type Run = Awaited<ReturnType<typeof runInMemory>>;
const runs: Run[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((run) => run.stop()));
});

const ada = testPrincipal('ada');
const input = { label: 'ci', apiKey: 'sk-plain-0123456789' };

async function stored(): Promise<Run> {
  const run = await runInMemory(vaultApp, 'vault.store', { input, principal: ada });
  runs.push(run);
  return run;
}

describe('decision records of a command that issues a secret (7.9.3, 7.9.6, 14.7.4)', () => {
  test('the record keeps the verifier sealed as the row does, and no plaintext', async () => {
    const run = await stored();
    expect(run.outcome.ok).toBe(true);
    if (!run.outcome.ok) return;
    const { token } = run.outcome.value as { token: string };
    const [event] = run.events;
    const decision = event?.decision;
    const issued = decision?.answers.find((answer) => answer.kind === 'secret');
    const created = event?.data as { values: Record<string, string> };
    expect(issued?.kind === 'secret' && issued.verifier).toMatch(/^kwv1\.[^.]+\.[^.]+\.[^.]+$/);
    expect(issued?.kind === 'secret' && issued.verifier).toBe(created.values.tokenVerifier);
    const wire = JSON.stringify(decision);
    expect(wire).not.toContain(token.split('_')[2] ?? 'x');
    expect(wire).not.toContain(input.apiKey);
    expect(parseSealedValueText(created.values.tokenVerifier ?? '')).toBeDefined();
  });

  test('a re-decide reproduces the command, issued secret included', async () => {
    // A plain secret input is sealed on the way in and is not re-sealed by a re-decide: leave it out.
    const bare = { label: 'ci' };
    const run = await runInMemory(vaultApp, 'vault.store', { input: bare, principal: ada });
    runs.push(run);
    const result = await expectReproduces(run.runtime, { commandId: run.commandId, input: bare });
    expect(result.reproduced).toBe(true);
  });

  test('trace: sealed input stores a sealed input without credentials; a command without stores none', async () => {
    const run = await stored();
    const decision = run.events[0]?.decision;
    expect(decision?.input?.keyId).toEqual(expect.any(String));
    expect(JSON.stringify(decision)).not.toContain(input.apiKey);
    const id = (run.outcome.ok ? run.outcome.value : undefined) as { credentialId: string };
    const replaced = await runInMemory(vaultApp, 'vault.replace', {
      input: { credentialId: id.credentialId, apiKey: 'sk-other-0123456789' },
      principal: ada,
    });
    runs.push(replaced);
    expect(replaced.events[0]?.decision?.input).toBeUndefined();
  });
});
