import { defineQuery } from '../../dsl/define-query.ts';
import { typedOutput } from '../../dsl/typed-output.ts';
import { errors } from '../../errors/errors.ts';
import type { CompositionReportDocument } from '../../surface/composition-report-document.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';

/**
 * The `core.composition` query (S-26, S-29, section 16.2.6): what the surface leaves out. The
 * runtime answers it from `compositionReport`; only operators may ask.
 */
export const composition: CoreLiteral['actions']['composition'] = defineQuery(coreBase, {
  scope: 'backend',
  principal: 'operator',
  output: typedOutput<CompositionReportDocument>(),
  read: () => {
    throw errors.not_implemented('core.composition is answered by the runtime.');
  },
});
