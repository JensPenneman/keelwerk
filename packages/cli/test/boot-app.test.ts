import type { DeploymentDefinition, Logger, Runtime, RuntimeOptions } from '@keelwerk/core';
import { startRuntime } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { bootApp } from '../src/serve/boot-app.ts';

vi.mock('@keelwerk/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@keelwerk/core')>()),
  startRuntime: vi.fn(),
}));

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};
const definition = { apps: [], infrastructure: [] } as unknown as DeploymentDefinition;
const options = { role: 'all', environment: 'development', env: {}, logger } as const;

function fakeRuntime(stop: Runtime['stop']): Runtime {
  return { port: 4123, operatorSocket: '/tmp/kw.sock', stop } as unknown as Runtime;
}

describe('bootApp', () => {
  test('starts the runtime with listen on and reports the runtime port and operator socket', async () => {
    const start = vi.mocked(startRuntime);
    start.mockResolvedValueOnce(fakeRuntime(async () => undefined));
    const booted = await bootApp(definition, options);
    const [passed, runtimeOptions] = start.mock.calls.at(-1) as [
      DeploymentDefinition,
      RuntimeOptions,
    ];
    expect(passed).toBe(definition);
    expect(runtimeOptions).toMatchObject({ role: 'all', listen: true, environment: 'development' });
    expect(booted.port).toBe(4123);
    expect(booted.operatorSocket).toBe('/tmp/kw.sock');
  });

  test("stop delegates to the runtime's stop with the deadline", async () => {
    const stop = vi.fn(async () => undefined);
    vi.mocked(startRuntime).mockResolvedValueOnce(fakeRuntime(stop));
    const booted = await bootApp(definition, options);
    await booted.stop(750);
    expect(stop).toHaveBeenCalledExactlyOnceWith(750);
  });
});
