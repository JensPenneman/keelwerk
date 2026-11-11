import { normalizeRule } from '../authorization/normalize-rule.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { FlagRead } from '../events/flag-read.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { ScopeRunner } from './answer-deps.ts';
import { buildReadContext } from './build-read-context.ts';
import { createRequestAnswerer } from './create-request-answerer.ts';
import { dispatchRequest } from './dispatch-request.ts';
import { driveHandler } from './drive-handler.ts';
import { refuseRequest } from './refuse-request.ts';
import type { RequestAuthorities } from './request-authorities.ts';
import type { RunReadInput } from './run-read-input.ts';
import type { RunReadResult } from './run-read-result.ts';

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
 * Runs a query below the pipeline (section 7.9.4): a read-only unit of the scope, the head
 * position read first, then the handler driven, each request answered in the unit in yield order
 * and every load tagged with its position (S-19). `read` may return a value, a request or a
 * generator. Nothing is written and nothing is recorded in a decision record; the positions come
 * back for the response.
 */
export async function runRead(input: RunReadInput): Promise<RunReadResult> {
  const { registry, adapter } = input;
  const action = registry.actions.get(input.action);
  if (action === undefined) {
    throw new KeelwerkError({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: `"${input.action}" is not an action of this app.`,
    });
  }
  if (action.kind !== 'query' || action.generated !== undefined) {
    throw refuseRequest(
      action.ref,
      'runRead runs the `read` of a module query, not a command or a generated action',
    );
  }
  const rules =
    input.rules ??
    [...registry.rules.values()].filter((rule) => rule.disabled !== true).map(normalizeRule);

  const { signal } = input;
  signal?.throwIfAborted();
  return adapter.unit(
    input.namespace,
    input.scope,
    async (unit) => {
      const head = await abortable(unit.events.head(), signal);
      const reads: RecordedRead[] = [];
      const flags = new Map<string, FlagRead>();
      const authorities: RequestAuthorities = new WeakMap();
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
      const output = await abortable(
        driveHandler(action.handler(input.input, handler), context.answer),
        signal,
      );
      return { output, head, reads, flags: [...flags.values()] };
    },
    {
      readOnly: true,
      ...(action.timeoutMs === undefined ? {} : { timeoutMs: action.timeoutMs }),
    },
  );
}
