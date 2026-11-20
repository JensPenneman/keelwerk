import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import type { TestApp } from '../../../src/harness/test-app.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';

/**
 * Starts an app on memory with one tenant and an operator carrier (`core.explain` is answered on
 * the operator socket, the local carrier of the command line) and gives `command`, a command run
 * as the user `ada`, and `explain`. The runtime stops with `cleanup`.
 */
export async function startExplain(app: TestApp, cleanup: (() => Promise<void>)[]) {
  const runtime = await startTestRuntime(app, { tenants: ['acme'], operators: true });
  cleanup.push(() => runtime.stop());
  const command = (
    action: string,
    input: unknown,
    commandId: string,
    options: { readonly apiVersion?: string; readonly agent?: string } = {},
  ) => {
    const base = testCarrier(runtime.tenants.acme, testPrincipal('ada'));
    return runtime.invoker.invoke({
      action,
      input,
      carrier: {
        ...base,
        headers: {
          ...base.headers,
          ...(options.apiVersion === undefined ? {} : { 'keelwerk-version': options.apiVersion }),
          ...(options.agent === undefined ? {} : { 'user-agent': options.agent }),
        },
      },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId,
    });
  };
  const explain = (input: Readonly<Record<string, unknown>>) =>
    runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action: 'core.explain',
      input: { backend: runtime.backendId, tenant: runtime.tenants.acme.id, ...input },
      carrier: {
        transport: 'cli',
        headers: { 'x-tenant': runtime.tenants.acme.id },
        local: { inProcess: true },
      },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  return { runtime, command, explain };
}
