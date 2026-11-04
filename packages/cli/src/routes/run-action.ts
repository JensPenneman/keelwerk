import type { SurfaceAction } from '@keelwerk/core';
import type { CliContext } from '../context/cli-context.ts';
import { CliFailure } from '../context/cli-failure.ts';
import { localFailure } from '../context/local-failure.ts';
import { assembleInput } from './assemble-input.ts';
import type { FlagEntry } from './flag-entry.ts';
import type { PositionalSlot } from './positional-slot.ts';
import { traceHeader } from './trace-header.ts';

/** One action command: assemble the input, invoke, print the value or the receipt, or fail with the wire error. */
export async function runAction(
  context: CliContext,
  action: SurfaceAction,
  entries: readonly FlagEntry[],
  slots: readonly PositionalSlot[],
  flags: Readonly<Record<string, unknown>>,
  positionals: readonly unknown[],
): Promise<void> {
  if (action.kind === 'subscription') {
    throw localFailure(
      'unavailable',
      'core.live_unavailable',
      'Live updates are not available in this release.',
    );
  }
  if (flags['wait-effects'] !== undefined) {
    throw localFailure(
      'unavailable',
      'core.live_unavailable',
      '--wait-effects needs live updates, which are not available in this release.',
    );
  }
  if (flags.explain === true) {
    throw localFailure(
      'not_implemented',
      'cli.explain_unavailable',
      '--explain is not available in this release.',
    );
  }
  const output = context.output;
  const input = await assembleInput(context, action, entries, slots, flags, positionals);
  const trace = flags.trace === true ? traceHeader(context.host) : undefined;
  if (trace !== undefined) {
    output.note(`trace id: ${trace.traceId}`);
  }
  const response = await context.client.invoke(action.ref, input, {
    signal: context.signal,
    ...(typeof flags['command-id'] === 'string' && { commandId: flags['command-id'] }),
    ...(flags.async === true && { prefer: 'async' as const }),
    ...(trace !== undefined && { traceparent: trace.traceparent }),
  });
  if (!response.ok) {
    throw new CliFailure(response.error, response.error.message);
  }
  if (response.receipt !== undefined) {
    if (output.format === 'text' || output.format === 'table') {
      output.line(`command ${response.receipt.commandId} ${response.receipt.status}`);
    } else {
      output.value(response.receipt);
    }
    return;
  }
  if (response.value !== undefined && response.value !== null) {
    output.value(response.value);
  } else if (output.format === 'json') {
    output.value(null);
  }
}
