import type { SurfaceAction } from '@keelwerk/core';
import type { CliContext } from '../context/cli-context.ts';
import { CliFailure } from '../context/cli-failure.ts';
import { localFailure } from '../context/local-failure.ts';
import { usageFailure } from '../context/usage-failure.ts';
import { assembleInput } from './assemble-input.ts';
import { deprecationWarning } from './deprecation-warning.ts';
import type { FlagEntry } from './flag-entry.ts';
import { followSubscription } from './follow-subscription.ts';
import type { PositionalSlot } from './positional-slot.ts';
import { resendOf } from './resend-of.ts';
import { traceHeader } from './trace-header.ts';
import { waitEffects } from './wait-effects.ts';
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
    for (const flag of ['async', 'wait', 'wait-effects'] as const) {
      if (flags[flag] !== undefined && flags[flag] !== false) {
        throw usageFailure(`--${flag} does not apply to a subscription.`);
      }
    }
  } else if (flags.follow === true) {
    throw usageFailure('--follow applies to subscriptions only.');
  }
  if (flags.async === true && flags['wait-effects'] !== undefined && flags.wait === undefined) {
    // An accepted command has no effects to wait on until its result is known.
    throw usageFailure('--wait-effects needs the result of the command: add --wait.');
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
  if (action.kind === 'subscription') {
    await followSubscription(context, action, input, flags.follow === true);
    return;
  }
  const trace = flags.trace === true ? traceHeader(context.host) : undefined;
  if (trace !== undefined) {
    output.note(`trace id: ${trace.traceId}`);
  }
  const prefer = flags.async === true ? ('async' as const) : undefined;
  // Minted here, not inside the client: a wait that fails after the commit names it on standard error.
  const commandId =
    typeof flags['command-id'] === 'string' ? flags['command-id'] : context.host.newId();
  const first = await context.client.invoke(action.ref, input, {
    signal: context.signal,
    commandId,
    ...(prefer !== undefined && { prefer }),
    ...(trace !== undefined && { traceparent: trace.traceparent }),
    onDeprecation: (notice) => output.note(deprecationWarning(notice)),
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
  } else if (response.value !== undefined && response.value !== null) {
    output.value(response.value);
  } else if (output.format === 'json') {
    output.value(null);
  }
  // The value is printed first: the command has committed whatever the wait finds.
  if (flags['wait-effects'] !== undefined) {
    await waitEffects(
      context,
      response.effects ?? [],
      typeof flags['wait-effects'] === 'number' ? flags['wait-effects'] : null,
      commandId,
    );
  }
}
