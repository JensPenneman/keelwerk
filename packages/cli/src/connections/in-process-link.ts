import type { LiveLegEvent } from '@keelwerk/client';
import type {
  ApiSurface,
  InvokeResponse,
  LiveFrame,
  Outcome,
  Runtime,
  StateToken,
} from '@keelwerk/core';
import { toWire as errorToWire, newUuidV7 } from '@keelwerk/core';
import { asKeelwerkError, coreError, decodeActionInput, encodeFrames } from '@keelwerk/core/http';
import { toWire } from '@keelwerk/core/wire';
import { CliFailure } from '../context/cli-failure.ts';
import type { DeploymentLink } from '../context/deployment-link.ts';

function failed(error: unknown, requestId: string): Extract<InvokeResponse, { ok: false }> {
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
    async subscribe(request, options) {
      const requestId = newUuidV7();
      const surface = surfaceOf();
      const action = surface.actions.find((candidate) => candidate.ref === request.action);
      const abort = new AbortController();
      const onInterrupt = (): void => abort.abort();
      if (options?.signal?.aborted === true) abort.abort();
      else options?.signal?.addEventListener('abort', onInterrupt, { once: true });
      const refusal = (failure: unknown): CliFailure => {
        if (options?.signal?.aborted === true) return new CliFailure('interrupted', 'Interrupted.');
        const answer = failed(failure, requestId);
        return new CliFailure(answer.error, answer.error.message);
      };
      let iterator: AsyncIterator<LiveFrame<unknown>>;
      let first: IteratorResult<LiveFrame<unknown>>;
      try {
        if (action === undefined) {
          throw coreError('core.not_found', { message: 'There is no such subscription.' });
        }
        const frames = encodeFrames(
          runtime.invoker.subscribe<unknown, unknown>(
            {
              action: request.action,
              input: decodeActionInput(surface, action, request.input),
              carrier: { transport: 'cli', local: { inProcess: true }, headers },
              requestId,
              ...(options?.traceparent !== undefined && { traceparent: options.traceparent }),
              signal: abort.signal,
            },
            request.after === undefined ? undefined : { after: request.after as StateToken },
          ),
          action,
        );
        iterator = frames[Symbol.asyncIterator]();
        first = await iterator.next();
      } catch (failure) {
        abort.abort();
        options?.signal?.removeEventListener('abort', onInterrupt);
        throw refusal(failure);
      }
      let waiting: IteratorResult<LiveFrame<unknown>> | undefined = first;
      let finished = false;
      const stop = async (): Promise<void> => {
        finished = true;
        abort.abort();
        options?.signal?.removeEventListener('abort', onInterrupt);
        await iterator.return?.(undefined)?.catch(() => undefined);
      };
      const events: AsyncIterator<LiveLegEvent> = {
        async next() {
          if (finished) return { done: true, value: undefined };
          try {
            const step = waiting ?? (await iterator.next());
            waiting = undefined;
            if (step.done === true) {
              await stop();
              return { done: false, value: { kind: 'end', reason: 'complete' } };
            }
            return { done: false, value: { kind: 'frame', frame: step.value } };
          } catch (failure) {
            await stop();
            if (options?.signal?.aborted === true) return { done: true, value: undefined };
            return {
              done: false,
              value: { kind: 'error', error: failed(failure, requestId).error },
            };
          }
        },
        async return() {
          await stop();
          return { done: true, value: undefined };
        },
      };
      return { [Symbol.asyncIterator]: () => events };
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
