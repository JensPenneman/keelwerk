import type { EffectOutcome, RequestAnswerer, WireError } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import type { EffectLog } from './create-effect-log.ts';

/** What the stub runs for an effect type: the executor's `run`, without its context. */
export type StubHandler = (input: unknown) => Promise<unknown>;

/** What a stub is made with. */
export interface StubOptions {
  /** The command the effects belong to; effect ids are derived from it and the effect's index. */
  readonly commandId: string;
  readonly log: EffectLog;
  /** The executors by effect type (`github.exchangeCode`). */
  readonly handlers: Readonly<Record<string, StubHandler>>;
}

/** A test-only inline executor, shaped as the seam the write path offers (`RunCommandInput.replace.perform`). */
export interface InlineEffectStub {
  readonly answer: RequestAnswerer['perform'];
  /** How many times a handler really ran (a deduplicated repeat does not count). */
  executions(): number;
  /** The effect ids handed out so far, in order. */
  ids(): readonly string[];
}

function wireErrorOf(error: unknown): WireError {
  if (isKeelwerkError(error)) {
    return {
      kind: error.kind,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId: '',
    };
  }
  return {
    kind: 'internal',
    code: 'core.internal',
    message: error instanceof Error ? error.message : 'The executor failed.',
    retryable: false,
    requestId: '',
  };
}

function answerOf(
  outcome: EffectOutcome<unknown>,
): { ok: true; value: unknown } | { ok: false; error: WireError } {
  return outcome.ok
    ? { ok: true, value: outcome.value }
    : {
        ok: false,
        error: {
          kind: 'unavailable',
          code: outcome.error.code,
          message: outcome.error.message,
          retryable: false,
          requestId: '',
        },
      };
}

/**
 * The stand-in for the inline executor of WP-41. It writes `requested` before the call and
 * `settled` after it, keys the call by the effect id (the idempotency key: a repeat with the same
 * id answers the recorded outcome and the destination is not called again) and answers the outcome
 * as a value, never as a throw (section 7.9.3).
 */
export function createInlineEffectStub(options: StubOptions): InlineEffectStub {
  const { commandId, log, handlers } = options;
  const handed: string[] = [];
  let executed = 0;
  return {
    answer: async (request) => {
      const { effect } = request;
      const id = `${commandId}#${handed.length}`;
      handed.push(id);
      const settled = log.records.find((record) => record.phase === 'settled' && record.id === id);
      if (settled?.phase === 'settled') return answerOf(settled.outcome);
      log.records.push({ phase: 'requested', id, type: effect.type, input: effect.input });
      const handler = handlers[effect.type];
      let outcome: EffectOutcome<unknown>;
      if (handler === undefined) {
        outcome = {
          ok: false,
          error: { code: 'core.effect_unknown', message: `No executor for ${effect.type}.` },
        };
      } else {
        executed += 1;
        try {
          outcome = { ok: true, value: await handler(effect.input) };
        } catch (error) {
          const wire = wireErrorOf(error);
          outcome = { ok: false, error: { code: wire.code, message: wire.message } };
        }
      }
      log.records.push({ phase: 'settled', id, outcome });
      return answerOf(outcome);
    },
    executions: () => executed,
    ids: () => handed,
  };
}
