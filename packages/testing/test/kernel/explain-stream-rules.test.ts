import { describe, expect, test } from 'vitest';
import { capturing, setup } from './support/explain-kit.ts';

const lined = (lines: readonly string[]) => lines.filter((line) => line.includes(' -> '));

async function stream() {
  const lines: string[] = [];
  const kit = await setup('memory', {
    // biome-ignore lint/style/useNamingConvention: the environment variable's own name
    env: { KEELWERK_EXPLAIN: '1' },
    logger: capturing(lines),
  });
  return { lines, ...kit };
}

describe('the rules in the explain stream line', () => {
  test('the line names the rules a real invocation matched', async () => {
    const { lines, invoke, asAda } = await stream();
    await invoke('library.addBook', { title: 'Dune', isbn: 'i-1' }, asAda);
    expect(lined(lines)).toHaveLength(1);
    expect(lined(lines)[0]).toMatch(
      /^test -> library\.addBook ok \d+ ms rules=library\.addBook\.signedIn$/,
    );
  });

  test('core.explain itself prints rules=-', async () => {
    const { lines, explain } = await stream();
    await explain({ mode: 'decision', ref: 'library.addBook', as: 'user:ada' });
    const written = lined(lines);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^cli -> core\.explain ok \d+ ms rules=-$/);
  });

  test('a subscription writes one line', async () => {
    const { lines, runtime, asAda } = await stream();
    const frames = runtime.invoker.subscribe({
      action: 'library.findByIsbn',
      input: { isbn: 'i-1' },
      carrier: asAda,
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    await expect(async () => {
      for await (const _frame of frames) {
        // never reached
      }
    }).rejects.toMatchObject({ code: 'core.live_unavailable' });
    const written = lined(lines);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/rules=- kind=subscribe$/);
  });
});
