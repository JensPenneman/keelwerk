import { settleReactions, startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { portal } from '../src/app.ts';
import { credentialsOf, freshPerson } from './support/people.ts';
import { portalConfig } from './support/portal-config.ts';
import { portalDispatcher } from './support/portal-event-workers.ts';
import { portalRest } from './support/portal-rest.ts';

describe.each(['memory', 'pglite'] as const)('a login over REST on %s', (adapter) => {
  const dispatcher = portalDispatcher();
  const started = startTransportRuntime({
    app: portal,
    host: httpHost(),
    config: portalConfig,
    adapter,
    eventWorkers: [dispatcher],
  });
  afterAll(async () => (await started).stop());

  test('sets lastLoginAt on the profile the user reads, once the job has run', async () => {
    const runtime = await started;
    const rest = portalRest(runtime.fetch, runtime.domains.acme ?? '');
    const ada = freshPerson();
    expect((await rest.send('POST', '/api/auth/sign-up', { body: ada })).status).toBe(200);
    const login = await rest.send('POST', '/api/auth/login', { body: credentialsOf(ada) });
    expect(login.status).toBe(200);
    const headers = { authorization: `Bearer ${String(login.body.sessionToken)}` };
    // Whether the job ran before the first read depends on the workers, so nothing is asserted of
    // the profile until the job has certainly run (module-auth's record-login test holds the jobs
    // and pins the state before it).
    await settleReactions(dispatcher, runtime.drainJobs);
    const recorded = await rest.send('GET', '/api/accounts/profiles', { headers });
    expect(JSON.stringify(recorded.body)).toMatch(/"lastLoginAt":"\d{4}-\d{2}-\d{2}T/);
  }, 120_000);
});
