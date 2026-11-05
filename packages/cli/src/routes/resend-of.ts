import type { InvokeRequest, InvokeResponse } from '@keelwerk/core';
import type { CliContext } from '../context/cli-context.ts';

/** The request to send again: the original one under the receipt's command id. */
export function resendOf(
  context: CliContext,
  request: Pick<InvokeRequest, 'action' | 'input' | 'prefer'>,
  commandId: string,
  traceparent: string | undefined,
): () => Promise<InvokeResponse> {
  return () =>
    context.client.invoke(request.action, request.input, {
      signal: context.signal,
      commandId,
      ...(request.prefer !== undefined && { prefer: request.prefer }),
      ...(traceparent !== undefined && { traceparent }),
    });
}
