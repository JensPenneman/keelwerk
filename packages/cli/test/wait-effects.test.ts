import { newUuidV7, renderTypeId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { createFakeHost, type SentRequest } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const token = (n: number): string => `v2.0.${n}.00000000.${'0'.repeat(32)}`;
const head = (n: number): string =>
  `id: ${token(n)}\nevent: head\ndata: {"state":"${token(n)}"}\n\n`;

interface Scripted {
  readonly status: string;
  readonly error?: { readonly kind: string; readonly code: string };
}

/**
 * A deployment whose `app.health` answers with one requested effect, and whose status watch says what
 * `script` does with it: the statuses it reports (before head and after), and whether the stream stays open.
 */
function deployment(script: {
  readonly before?: Scripted;
  readonly after?: Scripted;
  readonly open?: boolean;
  readonly effects?: boolean;
}) {
  const effect = newUuidV7();
  const wireId = renderTypeId('eff', effect);
  const watched: Record<string, unknown>[] = [];
  const status = (n: number, scripted: Scripted): string =>
    `id: ${token(n)}\nevent: data\ndata: ${JSON.stringify({
      id: wireId,
      type: 'hooks.post',
      status: scripted.status,
      requestedAt: '2026-11-19T10:00:00Z',
      ...(scripted.error !== undefined && { error: scripted.error }),
    })}\n\n`;
  const handler = portalServer({
    invoke: (body, sent: SentRequest) => {
      if (sent.url.endsWith('/subscribe')) {
        watched.push(body);
        const text = `${script.before === undefined ? '' : status(1, script.before)}${head(2)}${script.after === undefined ? '' : status(3, script.after)}`;
        const stream =
          script.open === true
            ? new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode(text));
                },
              })
            : text;
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return json({
        ok: true,
        value: null,
        ...(script.effects === false ? {} : { effects: [effect] }),
      });
    },
  });
  return { fake: createFakeHost({ files: remoteProfileFiles, handler }), watched, wireId };
}

describe('call --wait-effects', () => {
  test('returns once the effect settled: one note per status, standard output keeps only the value', async () => {
    const { fake, watched, wireId } = deployment({
      before: { status: 'requested' },
      after: { status: 'succeeded' },
    });
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('null\n');
    expect(run.stderr).toContain(`effect ${wireId} hooks.post succeeded`);
    expect(watched).toEqual([{ action: 'core.effectStatusWatch', input: { ids: [wireId] } }]);
  });

  test('a failed effect ends the command with its own kind and code', async () => {
    const { fake } = deployment({
      before: { status: 'failed', error: { kind: 'unavailable', code: 'hooks.endpoint_down' } },
    });
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(run.code).toBe(10);
    expect(run.stderr).toContain('hooks.endpoint_down');
  });

  test('an abandoned effect without an error is cli.effect_failed (1)', async () => {
    const { fake } = deployment({ before: { status: 'abandoned' } });
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('cli.effect_failed');
  });

  test('an effect the watch does not know is cli.effect_not_found (6)', async () => {
    const { fake } = deployment({});
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(run.code).toBe(6);
    expect(run.stderr).toContain('cli.effect_not_found');
  });

  test('past the limit the status is noted and the command ends with cli.wait_timeout (10)', async () => {
    const { fake, wireId } = deployment({ before: { status: 'requested' }, open: true });
    const run = await runCliWith(['call', 'app.health', '--wait-effects', '1'], fake.host);
    expect(run.code).toBe(10);
    expect(run.stderr).toContain(`effect ${wireId} hooks.post requested`);
    expect(run.stderr).toContain('cli.wait_timeout');
  });

  test('an answer that lists no effects waits for nothing', async () => {
    const { fake, watched } = deployment({ effects: false });
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(run.code).toBe(0);
    expect(watched).toEqual([]);
  });
});
