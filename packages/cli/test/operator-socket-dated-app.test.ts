import { defineApiVersions, defineApp } from '@keelwerk/core';
import { httpHost } from '@keelwerk/transport-http';
import { describe, expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { startFixtureDeployment } from './support/fixture-deployment.ts';
import { runCliWith } from './support/run-cli-with.ts';

const dated = defineApp({ id: 'dated', modules: [], api: defineApiVersions({ '2026-11-05': {} }) });

describe('the operator socket of a deployment whose one app is dated after the core calendar', () => {
  test('backend create answers a prefixed id, as the core surface at the session version presents it', async () => {
    const deployment = await startFixtureDeployment({ app: dated, host: httpHost() });
    try {
      const host = createFakeHost({ handler: deployment.handler });
      const run = await runCliWith(
        [
          'backend',
          'create',
          'only',
          '--app',
          'dated',
          '--placement',
          'main',
          '--command-id',
          crypto.randomUUID(),
          '--socket',
          deployment.socket,
          '--output',
          'json',
        ],
        host.host,
      );
      expect(run.stderr).toBe('');
      expect(run.code).toBe(0);
      expect((JSON.parse(run.stdout) as { id: string }).id).toMatch(/^bknd_/);
    } finally {
      await deployment.stop();
    }
  });
});
