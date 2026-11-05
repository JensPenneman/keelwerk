import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import { DryRunStop } from './dry-run-stop.ts';

/** The answerer of `perform` in a dry run: the outcome given for the effect (`--answer`), else a stop. */
export function dryRunPerform(
  answers: Readonly<Record<string, unknown>> | undefined,
): RequestAnswerer['perform'] {
  return (request) => {
    const given = answers?.[request.effect.type];
    if (given !== undefined) return Promise.resolve({ ok: true, value: given });
    return Promise.reject(new DryRunStop(request.effect.type, request.effect.input));
  };
}
