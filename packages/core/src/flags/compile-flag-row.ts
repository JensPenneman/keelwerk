import { normalizeWireFilter } from '../conditions/normalize-wire-filter.ts';
import type { FlagTargetingRow } from '../control/control-flags.ts';
import { errors } from '../errors/errors.ts';
import { checkDeploymentRules } from './check-deployment-rules.ts';
import type { CompiledFlagRow } from './compiled-flag-row.ts';
import { flagTargetingSchema } from './flag-targeting-schema.ts';

/** Re-checks a stored row with `flagTargetingSchema` (a deployment-wide row lists no principals) and normalises each `when`; throws `validation` on a bad row. */
export function compileFlagRow(row: FlagTargetingRow): CompiledFlagRow {
  const checked = flagTargetingSchema['~standard'].validate(row.targeting);
  if (checked instanceof Promise)
    throw errors.internal('The targeting schema answered asynchronously.');
  if (checked.issues !== undefined) {
    throw errors.validation(
      `The stored targeting of "${row.key}" is invalid: ${checked.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  const targeting = checked.value;
  if (row.backendId === null) checkDeploymentRules(targeting);
  return {
    id: row.id,
    key: row.key,
    backendId: row.backendId,
    version: row.version,
    enabled: targeting.enabled,
    fallthrough: targeting.fallthrough,
    rules: targeting.rules.map((rule) => ({
      id: rule.id,
      tenants: rule.tenants === undefined ? null : new Set(rule.tenants),
      principals: rule.principals === undefined ? null : new Set(rule.principals),
      when: rule.when === undefined ? null : normalizeWireFilter(rule.when),
      serve: rule.serve,
    })),
  };
}
