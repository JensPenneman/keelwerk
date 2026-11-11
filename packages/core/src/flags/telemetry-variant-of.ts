import type { FlagResolution } from '../contexts/flag-resolution.ts';
import type { FlagSpec } from './flag-spec.ts';

/**
 * The variant label telemetry carries (20.5). A boolean flag and a variant flag name their
 * variant, a bounded set the declaration lists; so does a json flag that serves an object or array,
 * which always has an operator-typed variant. A string, number or scalar json value is the served
 * value itself (its variant is `String(value)`), which a metric series or a span must not hold:
 * those flags carry where the answer came from instead, `rule:<rule id>`, `split:<rule id>`,
 * `split:fallthrough`, `fallthrough` or `default`.
 */
export function telemetryVariantOf(flag: FlagSpec, resolution: FlagResolution<unknown>): string {
  if (flag.kind === 'boolean' || flag.kind === 'variant') return resolution.variant;
  if (flag.kind === 'json' && typeof resolution.value === 'object') return resolution.variant;
  switch (resolution.reason) {
    case 'TARGETING_MATCH':
      return `rule:${resolution.ruleId ?? ''}`;
    case 'SPLIT':
      return `split:${resolution.ruleId ?? 'fallthrough'}`;
    case 'STATIC':
      return 'fallthrough';
    default:
      return 'default';
  }
}
