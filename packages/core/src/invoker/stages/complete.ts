import { SpanStatusCode } from '@opentelemetry/api';
import type { Logger } from '../../observability/logger.ts';
import type { Span } from '../../observability/span.ts';
import type { Outcome } from '../outcome.ts';

/**
 * `complete` (section 9.2): ends the invocation's span and logs how it ended. The decision log,
 * the receipt, the usage counters and the flag exposures join with the write path and the flag
 * providers; the ids of deferred effects already ride on the outcome.
 */
export function complete<O>(input: {
  readonly span: Span;
  readonly log: Logger;
  readonly action: string;
  readonly outcome: Outcome<O>;
}): Outcome<O> {
  const { span, log, outcome } = input;
  if (outcome.ok) {
    span.setStatus({ code: SpanStatusCode.OK });
    span.setAttribute('keelwerk.outcome', 'ok');
    log.debug('invocation completed', { action: input.action });
  } else {
    const { error } = outcome;
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.code });
    span.setAttribute('keelwerk.outcome', error.kind);
    span.setAttribute('keelwerk.error.code', error.code);
    const fields = { action: input.action, code: error.code, kind: error.kind };
    if (error.kind === 'internal') log.error(error.message, { ...fields, cause: error.cause });
    else log.info('invocation failed', fields);
  }
  span.end();
  return outcome;
}
