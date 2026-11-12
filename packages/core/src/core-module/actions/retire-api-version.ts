import { defineCommand } from '../../dsl/define-command.ts';
import { typedOutput } from '../../dsl/typed-output.ts';
import { errors } from '../../errors/errors.ts';
import { field } from '../../fields/field.ts';
import { shape } from '../../fields/shape.ts';
import type { ApiVersionRetirement } from '../api-version-retirement.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';

/**
 * The `core.retireApiVersion` command (18.5): re-pins every backend and tenant pinned below the
 * floor once a version is past its sunset. Only operators may run it. The runtime answers it
 * through its command runner (runtime/answer-retire-command.ts) once the pipeline has authorised
 * the call; decide is never reached.
 *
 * Two overlapping calls with one command id can both run: the first pass of the runner only looks
 * for a receipt and is rolled back, so two calls that overlap both find none and both retire. Each
 * retirement that runs passed its own check and is one an operator could have asked for on its
 * own. When the inputs differ the second call answers the idempotency mismatch although its
 * retirement took effect.
 */
export const retireApiVersion: CoreLiteral['actions']['retireApiVersion'] = defineCommand(
  coreBase,
  {
    scope: 'deployment',
    principal: 'operator',
    input: shape({ app: field.string(), version: field.string() }),
    output: typedOutput<ApiVersionRetirement>(),
    decide: () => {
      throw errors.not_implemented('core.retireApiVersion is answered by the runtime.');
    },
  },
);
