import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { operatorFlags } from '../operator/operator-flags.ts';
import { runOperatorAction } from '../operator/run-operator-action.ts';
import { textFlag } from '../operator/text-flag.ts';

/** `surface usage` (18.5): the request counts per backend, tenant, API version, transport and item. */
export const surfaceUsageCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: { brief: 'Count the requests per API version.' },
  parameters: {
    flags: {
      ...operatorFlags(),
      since: textFlag('The first day, YYYY-MM-DD; default 29 days before --until.', 'day'),
      until: textFlag('The last day, YYYY-MM-DD; default today (UTC).', 'day'),
      backend: textFlag('Only this backend id.', 'id'),
      'api-version': textFlag('Only this API version.', 'date'),
      item: textFlag(
        'Only this item: a deprecated action, or empty for the version total.',
        'item',
      ),
    },
  } as never,
  async func(this: CliContext, parsed) {
    const input = {
      ...(typeof parsed.since === 'string' && { since: parsed.since }),
      ...(typeof parsed.until === 'string' && { until: parsed.until }),
      ...(typeof parsed.backend === 'string' && { backendId: parsed.backend }),
      ...(typeof parsed['api-version'] === 'string' && { apiVersion: parsed['api-version'] }),
      ...(typeof parsed.item === 'string' && { item: parsed.item }),
    };
    await runOperatorAction(this, parsed, 'core.apiUsage', input, (value) => {
      const document = value as { readonly items: readonly unknown[]; readonly truncated: boolean };
      if (document.truncated) this.output.note('the list is cut at 1000 rows');
      return document.items;
    });
  },
});
