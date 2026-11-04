import type { ApplicationText } from '@stricli/core';
import { text_en } from '@stricli/core';
import { CliFailure } from './context/cli-failure.ts';
import { renderError } from './output/render-error.ts';

/** English text, with the failures the CLI raises itself printed the way section 16.9.5 describes. */
export const cliText: ApplicationText = {
  ...text_en,
  exceptionWhileRunningCommand(failure, ansiColor) {
    if (failure instanceof CliFailure) {
      return failure.outcome === 'usage' || failure.outcome === 'interrupted'
        ? `error: ${failure.message}`
        : renderError(failure.outcome, false);
    }
    return text_en.exceptionWhileRunningCommand(failure, ansiColor);
  },
};
