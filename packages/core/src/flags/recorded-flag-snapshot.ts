import type { FlagResolution } from '../contexts/flag-resolution.ts';
import { defaultFlagReason } from '../events/default-flag-reason.ts';
import type { FlagRead } from '../events/flag-read.ts';
import type { Registry } from '../registry/registry.ts';
import { replayUnsupported } from '../replay/replay-unsupported.ts';
import { defaultFlagResolution } from './default-flag-resolution.ts';
import type { FlagSnapshot } from './flag-snapshot.ts';
import type { FlagSpec } from './flag-spec.ts';
import { flagSpecOf } from './flag-spec-of.ts';

/** The value a recorded variant stands for, by the flag's kind; a json variant is only `default`. */
function decoded(spec: FlagSpec, read: FlagRead): unknown {
  const unsupported = (): never => {
    throw replayUnsupported(
      `The recorded read of flag "${read.key}" has the variant "${read.variant}", which cannot be decoded.`,
    );
  };
  switch (spec.kind) {
    case 'boolean':
      return read.variant === 'true' ? true : read.variant === 'false' ? false : unsupported();
    case 'number': {
      const value = Number(read.variant);
      return read.variant === '' || !Number.isFinite(value) ? unsupported() : value;
    }
    case 'string':
    case 'variant':
      return read.variant;
    case 'json':
      return read.variant === 'default' ? spec.default : unsupported();
  }
}

/**
 * The snapshot of a re-decide (S-171): a recorded key answers its recorded variant, decoded by the
 * flag's kind, with the recorded reason and rule version and the provider `default` for a
 * `DEFAULT` read, else `record`. A key that was not recorded answers its declared default, so the
 * extra read shows as a difference in `meta.flags`.
 */
export function recordedFlagSnapshot(
  registry: Registry,
  recorded: readonly FlagRead[],
): FlagSnapshot {
  const reads = new Map(recorded.map((read) => [read.key, read]));
  const evaluations: FlagRead[] = [];
  return {
    read: <T>(key: string): FlagResolution<T> => {
      const spec = flagSpecOf(registry, key);
      if (spec === undefined) {
        return {
          value: undefined as T,
          variant: 'default',
          reason: 'ERROR',
          errorCode: 'FLAG_NOT_FOUND',
          provider: 'default',
        };
      }
      const read = reads.get(key);
      const answer: FlagResolution<unknown> =
        read === undefined
          ? defaultFlagResolution(spec)
          : {
              value: decoded(spec, read),
              variant: read.variant,
              // The reasons of the record are the closed set of 20.3.
              reason: read.reason as FlagResolution['reason'],
              ...(read.ruleVersion === null ? {} : { ruleVersion: read.ruleVersion }),
              provider: read.reason === defaultFlagReason ? 'default' : 'record',
            };
      if (!evaluations.some((one) => one.key === key)) {
        evaluations.push({
          key,
          variant: answer.variant,
          reason: answer.reason,
          ruleVersion: answer.ruleVersion ?? null,
        });
      }
      return answer as FlagResolution<T>;
    },
    get evaluations(): readonly FlagRead[] {
      return evaluations;
    },
  };
}
