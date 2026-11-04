import { readFileSync } from 'node:fs';
import type { DataAdapterFactory, DeploymentDefinition, Logger, Runtime } from '@keelwerk/core';
import { KeelwerkError, secret, startRuntime } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { afterEach, expect } from 'vitest';
import { libraryApp } from '../../../src/fixtures/index.ts';
import { schemaPlanner } from '../../../src/harness/schema-planner.ts';
import { testMasterKeyName } from '../../../src/harness/test-master-key-name.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import { testSecrets } from '../../../src/harness/test-secrets.ts';
import { withTestResolver } from '../../../src/harness/with-test-resolver.ts';
import { fallbackReporter } from './fallback-reporter.ts';
import { pgliteFactory } from './pglite-factory.ts';

const running: Runtime[] = [];

afterEach(async () => {
  await Promise.allSettled(running.splice(0).map((runtime) => runtime.stop(1000)));
});

export const app = withTestResolver(libraryApp);

export type Kind = 'memory' | 'pglite';

export function factoryOf(kind: Kind): DataAdapterFactory {
  return kind === 'memory' ? memoryAdapter() : pgliteFactory();
}

export function deploymentOf(
  kind: Kind,
  over: Partial<DeploymentDefinition> & { readonly factory?: DataAdapterFactory } = {},
): DeploymentDefinition {
  const { factory, ...rest } = over;
  return {
    apps: [app],
    infrastructure: [factory ?? factoryOf(kind), schemaPlanner(), fallbackReporter(), testSecrets],
    control: { adapter: kind },
    placements: { main: { adapter: kind, strategy: 'shared-tables' } },
    tenantResolution: [{ kind: 'hostname' }, { kind: 'header', header: 'x-tenant' }],
    keys: { masterKey: secret(testMasterKeyName) },
    ...rest,
  };
}

export async function boot(
  deployment: DeploymentDefinition,
  over: Partial<Parameters<typeof startRuntime>[1]> = {},
): Promise<Runtime> {
  const runtime = await startRuntime(deployment, {
    role: 'all',
    listen: false,
    environment: 'test',
    ...over,
  });
  running.push(runtime);
  return runtime;
}

export async function refusal(work: Promise<unknown>): Promise<KeelwerkError> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(KeelwerkError);
    return error as KeelwerkError;
  }
  return expect.unreachable('the call should have been refused');
}

export const ada = testPrincipal('ada');

/** Compares against the committed file `golden/<name>.json`. */
export function golden(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../golden/${name}.json`, import.meta.url), 'utf8'));
}

export const recorded: string[] = [];
export const phaseLogger: Logger = {
  debug: (message, fields) => {
    if (message === 'phase') recorded.push(String(fields?.phase));
  },
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => phaseLogger,
};
