import type { SurfaceAction } from '@keelwerk/core';
import type { CliContext } from '../context/cli-context.ts';
import { CliFailure } from '../context/cli-failure.ts';
import { localFailure } from '../context/local-failure.ts';
import { assembleInput } from './assemble-input.ts';
import type { FlagEntry } from './flag-entry.ts';
import type { PositionalSlot } from './positional-slot.ts';
import { resendOf } from './resend-of.ts';
import { traceHeader } from './trace-header.ts';
import { waitForReceipt } from './wait-for-receipt.ts';

function printReceipt(output: CliContext['output'], receipt: unknown): void {
  const { commandId, status } = receipt as { readonly commandId: string; readonly status: string };
  if (output.format === 'text' || output.format === 'table') {
    output.line(`command ${commandId} ${status}`);
  } else {
    output.value(receipt);
  }
}

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
  const prefer = flags.async === true ? ('async' as const) : undefined;
  const first = await context.client.invoke(action.ref, input, {
    signal: context.signal,
    ...(typeof flags['command-id'] === 'string' && { commandId: flags['command-id'] }),
    ...(prefer !== undefined && { prefer }),
    ...(trace !== undefined && { traceparent: trace.traceparent }),
  });
  if (!first.ok) {
    throw new CliFailure(first.error, first.error.message);
  }
  const response =
    first.receipt !== undefined && flags.wait !== undefined
      ? await waitForReceipt(context, {
          answer: first,
          seconds: typeof flags.wait === 'number' ? flags.wait : null,
          resend: resendOf(
            context,
            { action: action.ref, input, ...(prefer !== undefined && { prefer }) },
            first.receipt.commandId,
            trace?.traceparent,
          ),
          show: (receipt) => printReceipt(output, receipt),
        })
      : first;
  if (!response.ok) {
    throw new CliFailure(response.error, response.error.message);
  }
  if (response.receipt !== undefined) {
    printReceipt(output, response.receipt);
    return;
  }
  if (response.value !== undefined && response.value !== null) {
    output.value(response.value);
  } else if (output.format === 'json') {
    output.value(null);
  }
}
