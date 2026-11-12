import { effectiveRules } from '../authorization/effective-rules.ts';
import type { FlagRead } from '../events/flag-read.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { ScopeRunner } from './answer-deps.ts';
import { buildReadContext } from './build-read-context.ts';
import { createRequestAnswerer } from './create-request-answerer.ts';
import { dispatchRequest } from './dispatch-request.ts';
import type { Answerer } from './drive-handler.ts';
import type { RequestAuthorities } from './request-authorities.ts';
import type { RunReadResult } from './run-read-result.ts';
import type { RunReadUnitInput } from './run-read-unit-input.ts';

/** Rejects with the signal's reason as soon as it aborts; the unit callback ends with that rejection. */
function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      work.catch(() => undefined);
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      work.catch(() => undefined);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * A read-only unit as `runRead` opens it (section 7.9.4): the head position read first, then
 * `drive` run over the module's read context and the answerer, each request answered in the unit in
 * yield order and every load tagged with its position (S-19). Nothing is written and nothing is
 * recorded in a decision record; the positions come back for the response.
 */
export async function runReadUnit(
  input: RunReadUnitInput,
  drive: (handler: Readonly<Record<string, unknown>>, answer: Answerer) => Promise<unknown>,
): Promise<RunReadResult> {
  const { registry, adapter, action } = input;
  const rules = input.rules ?? effectiveRules(registry);

  const { signal } = input;
  signal?.throwIfAborted();
  return adapter.unit(
    input.namespace,
    input.scope,
    async (unit) => {
      const head = await abortable(unit.events.head(), signal);
      const reads: RecordedRead[] = [];
      const flags = new Map<string, FlagRead>();
      const authorities: RequestAuthorities = input.authorities ?? new WeakMap();
      const contexts = buildReadContext({
        registry,
        authorities,
        rules,
        principal: input.principal,
        scope: input.scope,
        clock: input.clock,
        request: input.request,
        config: input.config ?? (() => undefined),
        log: input.log,
        trace: input.trace,
        action,
        flags: input.flags,
      });
      const inScope: ScopeRunner =
        input.concurrentUnits === true
          ? (_from, scope, fn) =>
              adapter.unit(input.namespaceOf?.(scope) ?? input.namespace, scope, fn, {
                readOnly: true,
              })
          : (from, scope, fn) => from.nested(fn, { as: scope, readOnly: true });
      const answerer = createRequestAnswerer({
        rules,
        action,
        inScope,
        contexts,
        authorities,
        ...(input.queryState === undefined ? {} : { queryState: input.queryState }),
        ...(input.replace === undefined ? {} : { replace: input.replace }),
      });
      const context: AnswerContext = {
        registry,
        unit,
        scope: input.scope,
        principal: input.principal,
        module: action.module,
        form: 'read',
        clock: input.clock,
        keys: input.keys,
        compute: input.compute,
        log: input.log,
        flags,
        flagSnapshot: input.flags,
        answer: (request) => dispatchRequest(answerer, request, context),
        record: {
          read: (read) => {
            reads.push(read);
          },
          answer: () => undefined,
          flag: (read) => {
            flags.set(read.key, read);
          },
        },
      };
      const handler = contexts.forModule(action.module);
      const output = await abortable(drive(handler, context.answer), signal);
      return { output, head, reads, flags: [...flags.values()] };
    },
    {
      readOnly: true,
      ...(action.timeoutMs === undefined ? {} : { timeoutMs: action.timeoutMs }),
    },
  );
}
