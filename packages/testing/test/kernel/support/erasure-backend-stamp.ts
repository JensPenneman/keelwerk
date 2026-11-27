import type { Invoker } from '@keelwerk/core';
import { testOperator } from '../../../src/harness/test-operator.ts';
import { testPrincipalHeader } from '../../../src/harness/test-principal-header.ts';

/** Runs the backend command `bk.stamp` as the operator principal whose id is `principalId`, with a user agent so that its decision records the request. */
export function stampAs(
  runtime: { readonly backendId: string; readonly invoker: Invoker },
  principalId: string,
  text = 'stamped',
) {
  return runtime.invoker.invoke({
    action: 'bk.stamp',
    input: { text },
    carrier: {
      transport: 'test',
      headers: {
        'x-backend': runtime.backendId,
        [testPrincipalHeader]: JSON.stringify(testOperator(principalId)),
        'user-agent': 'agent/1.0',
      },
    },
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
    commandId: crypto.randomUUID(),
  });
}

/** Runs the tenant command `bk.touch` as the operator principal whose id is `principalId`, in the tenant `tenantId`, with a user agent. */
export function touchAs(
  runtime: { readonly invoker: Invoker },
  tenantId: string,
  principalId: string,
  sessionId: string,
) {
  return runtime.invoker.invoke({
    action: 'bk.touch',
    input: { sessionId },
    carrier: {
      transport: 'test',
      headers: {
        'x-tenant': tenantId,
        [testPrincipalHeader]: JSON.stringify(testOperator(principalId)),
        'user-agent': 'agent/1.0',
      },
    },
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
    commandId: crypto.randomUUID(),
  });
}
