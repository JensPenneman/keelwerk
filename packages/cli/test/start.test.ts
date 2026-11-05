import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../src/run-cli.ts';
import { environmentOf } from './support/environment-of.ts';
import { createFakeHost } from './support/fake-host.ts';
import { useInitProjects } from './support/init-project.ts';
import { runCliWith } from './support/run-cli-with.ts';

const project = useInitProjects();

/** A deployment on the in-memory adapter, the HTTP host on a free port and a short operator socket. */
const deployment = (socket: string): string => `import { byHeader, secret } from '@keelwerk/core';
import { memoryAdapter, schemaPlanner } from '@keelwerk/data';
import { httpHost } from '@keelwerk/transport-http';
import { shop } from '../apps/shop/src/app.ts';

export default {
  apps: [shop],
  infrastructure: [memoryAdapter(), schemaPlanner(), httpHost({ listen: { port: 0 } })],
  control: { adapter: 'memory' },
  placements: { main: { adapter: 'memory', strategy: 'shared-tables' } },
  operator: { socket: '${socket}' },
  tenantResolution: [byHeader('x-tenant')],
  keys: { masterKey: secret('KW_MASTER') },
};
`;

describe('keelwerk start', () => {
  test('runs a process of the deployment, logs JSON lines and stops on the interrupt', async () => {
    const made = await project();
    await mkdir(join(made.root, 'test-deployment'), { recursive: true });
    const socket = join(made.root, 'test-deployment', 'operator.sock');
    const file = join(made.root, 'test-deployment', 'deployment.ts');
    await writeFile(file, deployment(socket));
    const stop = new AbortController();
    const out: string[] = [];
    const err: string[] = [];
    let heard: () => void = () => undefined;
    const listening = new Promise<void>((resolve) => {
      heard = resolve;
    });
    const fake = createFakeHost({
      cwd: made.root,
      env: environmentOf(['KW_MASTER', Buffer.alloc(32, 3).toString('base64')]),
      files: { [file]: '' },
    });
    const running = runCli(['start', '--config', file, '--role', 'all'], {
      host: fake.host,
      signal: stop.signal,
      process: {
        stdout: {
          write: (text: string) => {
            out.push(text);
            if (text.includes('"msg":"listening"')) heard();
            return true;
          },
        },
        stderr: { write: (text: string) => err.push(text) > 0 },
        env: fake.host.env,
      },
    });
    await Promise.race([listening, running]);
    expect(err.join('')).toBe('');
    stop.abort();
    const code = await running;
    const logged = out
      .join('')
      .split('\n')
      .filter((line) => line.startsWith('{'));
    const started = logged
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'listening');
    expect(started).toMatchObject({ level: 30 });
    expect(typeof started?.port).toBe('number');
    expect(typeof started?.operatorSocket).toBe('string');
    expect(err.join('')).toBe('');
    expect(code).toBe(0);
  }, 120_000);

  test('says what is missing when there is no deployment file', async () => {
    const run = await runCliWith(['start'], createFakeHost({ cwd: '/nowhere' }).host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('found no deployment file');
  });
});
