import { evaluateCondition } from '../conditions/evaluate-condition.ts';
import type { FlagResolution } from '../contexts/flag-resolution.ts';
import type { CompiledFlagRow, CompiledFlagRule } from './compiled-flag-row.ts';
import { defaultFlagResolution } from './default-flag-resolution.ts';
import type { FlagContext } from './flag-context.ts';
import type { FlagSpec } from './flag-spec.ts';
import type { FlagServe } from './flag-targeting.ts';
import { splitHash } from './split-hash.ts';
import { variantOf } from './variant-of.ts';

const provider = 'core.targeting';
const hashRange = 2 ** 32;
const basisPoints = 10_000;

function matches(rule: CompiledFlagRule, context: FlagContext): boolean {
  if (rule.tenants !== null) {
    if (context.scope.level !== 'tenant' || !rule.tenants.has(context.scope.tenantId)) return false;
  }
  if (rule.principals !== null) {
    if (context.principal.id === null || !rule.principals.has(context.principal.id)) return false;
  }
  if (rule.when !== null) {
    try {
      const attributes = {
        ...context.attributes,
        principalKind: context.principal.kind,
        principalRoles: context.principal.roles,
      };
      if (!evaluateCondition(rule.when, attributes)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function served<T>(
  flag: FlagSpec<T>,
  row: CompiledFlagRow,
  serve: FlagServe,
  context: FlagContext,
  fixed: FlagResolution['reason'],
  ruleId: string | undefined,
): FlagResolution<T> {
  const identity = {
    provider,
    ruleVersion: row.version,
    ...(ruleId === undefined ? {} : { ruleId }),
  };
  if (!('split' in serve)) {
    return { value: serve.value as T, variant: variantOf(serve), reason: fixed, ...identity };
  }
  if (context.targetingKey === null) {
    return {
      ...defaultFlagResolution(flag, { errorCode: 'TARGETING_KEY_MISSING', provider }),
      ruleVersion: row.version,
      ...(ruleId === undefined ? {} : { ruleId }),
    };
  }
  const position = splitHash(serve.salt ?? flag.key, context.targetingKey) * basisPoints;
  let cumulative = 0;
  for (const share of serve.split) {
    cumulative += share.weight;
    if (position < cumulative * hashRange) {
      return { value: share.value as T, variant: variantOf(share), reason: 'SPLIT', ...identity };
    }
  }
  // The weights sum to 10,000 (checked on write), so the loop always answers; a share of weight 0 never does.
  const last = serve.split.at(-1);
  return last === undefined
    ? defaultFlagResolution(flag, { errorCode: 'GENERAL', provider })
    : { value: last.value as T, variant: variantOf(last), reason: 'SPLIT', ...identity };
}

/**
 * The targeting of one stored row (20.4), pure: disabled answers the declared default with
 * DISABLED; else the first matching rule serves (TARGETING_MATCH, or SPLIT, with its id); else the
 * fallthrough (STATIC, or SPLIT). A rule matches when every criterion it names holds: tenants
 * holds the scope's tenant (tenant scope only), principals holds the principal id, `when` holds
 * over the kernel's attributes. A split picks the first share whose cumulative range holds the
 * key's hash; without a targeting key it answers the default with TARGETING_KEY_MISSING. Every
 * answer carries provider `core.targeting` and the row's version. Never throws.
 */
export function evaluateTargeting<T>(
  flag: FlagSpec<T>,
  row: CompiledFlagRow,
  context: FlagContext,
): FlagResolution<T> {
  if (!row.enabled) {
    return {
      ...defaultFlagResolution(flag),
      reason: 'DISABLED',
      provider,
      ruleVersion: row.version,
    };
  }
  for (const rule of row.rules) {
    if (matches(rule, context)) {
      return served(flag, row, rule.serve, context, 'TARGETING_MATCH', rule.id);
    }
  }
  return served(flag, row, row.fallthrough, context, 'STATIC', undefined);
}
