import { defineApp, defineModule, defineModuleBase, field, shape } from '@keelwerk/core';
import { afterAll, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { dumpDatabase } from '../../src/index.ts';
import { pgliteQuery } from './support/dump-sections.ts';

// A module configuration holds no personal data (compose refuses it); a secret at its top level is sealed.
const base = defineModuleBase({
  id: 'cf',
  version: '0.1.0',
  config: shape({ label: field.string(), key: field.secret() }),
} as never);
const app = defineApp({
  id: 'cf-app',
  modules: [defineModule(base as never, {} as never)] as never,
});

let stop: (() => Promise<void>) | undefined;
afterAll(async () => stop?.());

test('the top-level secret of a configuration is not stored in clear, the plain member is', {
  timeout: 120_000,
}, async () => {
  const runtime = (await startTestRuntime(
    app as never,
    {
      adapter: 'pglite',
      config: { cf: { label: 'CONFIG-LABEL-PLAIN', key: 'CONFIG-SECRET-9911' } },
    } as never,
  )) as never as { control: { adapter: never }; stop: () => Promise<void> };
  stop = () => runtime.stop();
  const text = await dumpDatabase(pgliteQuery(runtime.control.adapter));
  expect(text).toContain('CONFIG-LABEL-PLAIN');
  expect(text).not.toContain('CONFIG-SECRET-9911');
});
