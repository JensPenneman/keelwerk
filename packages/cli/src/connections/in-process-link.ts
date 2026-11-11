import type { ApiSurface, InvokeResponse, Outcome, Runtime } from '@keelwerk/core';
import { toWire as errorToWire, newUuidV7 } from '@keelwerk/core';
import { asKeelwerkError, decodeActionInput } from '@keelwerk/core/http';
import { toWire } from '@keelwerk/core/wire';
import { CliFailure } from '../context/cli-failure.ts';
import type { DeploymentLink } from '../context/deployment-link.ts';

function failed(error: unknown, requestId: string): InvokeResponse {
  return { ok: false, error: { ...errorToWire(asKeelwerkError(error), 'operator'), requestId } };
}

/**
 * The link of project mode: the invocation protocol over the in-process invoker, as the operator
 * (the local carrier resolves the operator principal at deployment scope, section 3.5). Inputs are
 * decoded and outputs encoded with the surface, exactly as the HTTP host does, so every command
 * sees the wire form.
 */
export function inProcessLink(
  runtime: Runtime,
  appId: string,
  selectors: { readonly tenant?: string; readonly backend?: string } = {},
): DeploymentLink {
  const headers = {
    ...(selectors.tenant !== undefined && { 'x-keelwerk-tenant': selectors.tenant }),
    ...(selectors.tenant !== undefined &&
      selectors.backend !== undefined && { 'x-keelwerk-backend': selectors.backend }),
  };
  const surfaceOf = (): ApiSurface => runtime.surface(appId);
  return {
    async invoke(request, options) {
      const requestId = newUuidV7();
      const surface = surfaceOf();
      const action = surface.actions.find((candidate) => candidate.ref === request.action);
      try {
        const input =
          action === undefined ? request.input : decodeActionInput(surface, action, request.input);
        const outcome: Outcome<unknown> = await runtime.invoker.invoke({
          action: request.action,
          input,
          carrier: { transport: 'cli', local: { inProcess: true }, headers },
          requestId,
          ...(request.commandId !== undefined && { commandId: request.commandId }),
          ...(request.prefer !== undefined && { prefer: request.prefer }),
          ...(options?.traceparent !== undefined && { traceparent: options.traceparent }),
          signal: options?.signal ?? new AbortController().signal,
        });
        if (!outcome.ok) return failed(outcome.error, requestId);
        if (outcome.receipt !== undefined) {
          return {
            ok: true,
            value: outcome.receipt,
            receipt: outcome.receipt,
            ...(outcome.receiptId !== undefined && { receiptId: outcome.receiptId }),
            ...(outcome.effects !== undefined && { effects: outcome.effects }),
          };
        }
        return {
          ok: true,
          value: action === undefined ? outcome.value : toWire(action.output, outcome.value),
          ...(outcome.effects !== undefined && { effects: outcome.effects }),
        };
      } catch (failure) {
        if (options?.signal?.aborted === true) throw new CliFailure('interrupted', 'Interrupted.');
        return failed(failure, requestId);
      }
    },
    async surface(hash) {
      const surface = surfaceOf();
      return hash === surface.hash ? { modified: false } : { modified: true, surface };
    },
    async capabilities(options) {
      const answer = await this.invoke({ action: 'core.capabilities' }, options);
      if (!answer.ok) throw new CliFailure(answer.error, answer.error.message);
      return answer.value as Awaited<ReturnType<DeploymentLink['capabilities']>>;
    },
  };
}
