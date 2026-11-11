import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { BaseChecks } from '../model/base-checks.ts';
import { compositionRefusal } from './composition-refusal.ts';
import type { GateOption } from './gate-option.ts';
import { isPlainName } from './is-plain-name.ts';

/**
 * The module base. The data-level module checks of section 4.7 (`refsOutsideRequirements`,
 * `contributedFieldsNeedDefault`, `contributionsOutsideDependencies`, `unknownConditionTargets`)
 * run here, because the data lives in the base (decision 98).
 */
export function defineModuleBase<const B extends AnyModuleBase>(
  base: B & BaseChecks<B> & { readonly gate?: GateOption<B> },
): B {
  for (const name of Object.keys(base.entities ?? {})) {
    if (!isPlainName(name)) {
      throw compositionRefusal({
        code: 'invalidEntityName',
        severity: 'error',
        message: `'${name}' must be camelCase without consecutive capitals, because physical names snake-case it.`,
        module: base.id,
        ref: `${base.id}.${name}`,
      });
    }
  }
  return base;
}
