import type { EncodedDecisionRecord } from '../events/encode-decision-record.ts';
import { encodeDecisionRecord } from '../events/encode-decision-record.ts';
import type { StreamAppend } from '../events/stream-append.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import type { DryRunEffect, DryRunEvent, DryRunReport } from './dry-run-report.ts';
import { redactEffectInput } from './redact-effect-input.ts';
import { redactEventData } from './redact-event-data.ts';
import { redactKeys } from './redact-keys.ts';
import { redactResult } from './redact-result.ts';

const effectStream = 'core.effect';

function valuesOf(data: unknown): Readonly<Record<string, unknown>> {
  const values: unknown =
    typeof data === 'object' && data !== null ? Reflect.get(data, 'values') : undefined;
  return typeof values === 'object' && values !== null ? (values as Record<string, unknown>) : {};
}

function effectOf(registry: Registry, id: string, data: unknown): DryRunEffect {
  const values = valuesOf(data);
  const type = typeof values.type === 'string' ? values.type : effectStream;
  const continuation = typeof values.continuation === 'string' ? values.continuation : undefined;
  return {
    id,
    kind: 'external',
    type,
    ...(continuation === undefined ? {} : { continuation }),
    input:
      encodeEventValue(redactEffectInput(registry.effects.get(type)?.input, values.input)) ?? null,
  };
}

/**
 * What a dry run reports, read from what the unit appended: each entity event with its
 * before-image, each `core.effect` record as an effect with its type, input and continuation, the
 * command's decision record, and the result. Hidden, personal and secret values are redacted
 * (section 16.11.3).
 */
export function buildDryRunReport(input: {
  readonly registry: Registry;
  readonly action: ActionEntry;
  readonly commandId: string;
  readonly batches: readonly StreamAppend[];
  readonly output: unknown;
  readonly deferred: readonly string[];
}): Extract<DryRunReport, { readonly status: 'decided' }> {
  const { registry } = input;
  const events: DryRunEvent[] = [];
  const effects: DryRunEffect[] = [];
  let decision: EncodedDecisionRecord | null = null;
  for (const batch of input.batches) {
    const { type, id } = batch.stream;
    const entry = registry.entities.get(type);
    for (const [index, event] of batch.events.entries()) {
      const own = event.meta.commandId === input.commandId ? event.meta.decision : null;
      if (decision === null && own !== null) decision = encodeDecisionRecord(own);
      if (type === effectStream) {
        if (event.name === 'created') effects.push(effectOf(registry, id, event.data));
        continue;
      }
      events.push({
        stream: `${type}/${id}`,
        version: batch.expectedVersion + index + 1,
        type: `${type}.${event.name}`,
        eventId: event.eventId,
        data: encodeEventValue(
          entry === undefined ? event.data : redactEventData(entry, event.data),
        ),
        before:
          encodeEventValue(
            entry === undefined ? event.before : redactKeys(entry.descriptor.fields, event.before),
          ) ?? null,
      });
    }
  }
  return {
    status: 'decided',
    commandId: input.commandId,
    action: input.action.ref,
    events,
    effects,
    deferred: input.deferred,
    result: encodeEventValue(redactResult(registry, input.action, input.output)) ?? null,
    decision,
  };
}
