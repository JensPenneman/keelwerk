import type { Registry } from '../registry/registry.ts';
import type { ComparableEvent } from '../replay/comparable-event.ts';
import type { RedecideResult } from '../replay/redecide-result.ts';
import { redactEventData } from './redact-event-data.ts';
import { redactKeys } from './redact-keys.ts';
import { redactResult } from './redact-result.ts';
import { redactVerifiers } from './redact-verifiers.ts';

function redactedEvents(
  registry: Registry,
  events: readonly ComparableEvent[],
): readonly ComparableEvent[] {
  return events.map((event) => {
    const entry = registry.entities.get(event.stream.slice(0, event.stream.indexOf('/')));
    if (entry === undefined) return event;
    return {
      ...event,
      data: redactEventData(entry, event.type.slice(entry.ref.length + 1), event.data),
      before: redactKeys('entity', entry.descriptor.fields, event.before),
    };
  });
}

const failurePrefix = 'the handler now fails with ';

/**
 * A handler's failure without its message: the re-decide handed the handler the opened request and
 * the loaded rows, so a message may carry a personal value. The code stays.
 */
function withoutFailureMessage(difference: string): string {
  if (!difference.startsWith(failurePrefix)) return difference;
  const code = difference.slice(failurePrefix.length).split(': ', 1)[0] ?? '';
  return `${failurePrefix}${code}`;
}

/**
 * A re-decide's answer as explain shows it (section 16.11.3): the same redaction as a dry run's
 * report. Hidden, personal and secret field values are replaced in the data and before-images of
 * both event lists and in the decided row, and the sealed text of an issued verifier in both
 * decision records; a custom decided result by the flags of the action's output; a handler's
 * failure without its message. The re-decide compared the unredacted values; only the shown answer
 * is changed.
 */
export function redactRedecideResult(registry: Registry, result: RedecideResult): RedecideResult {
  const action = registry.actions.get(result.part);
  const { redecided } = result;
  return {
    ...result,
    differences: result.differences.map(withoutFailureMessage),
    recorded: {
      ...result.recorded,
      events: redactedEvents(registry, result.recorded.events),
      decision: redactVerifiers(result.recorded.decision),
    },
    redecided: {
      ...redecided,
      events: redactedEvents(registry, redecided.events),
      ...(redecided.decision === undefined
        ? {}
        : { decision: redactVerifiers(redecided.decision) }),
      ...('result' in redecided
        ? {
            result:
              action === undefined
                ? '[redacted]'
                : redactResult(registry, action, redecided.result),
          }
        : {}),
    },
  };
}
