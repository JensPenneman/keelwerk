import { defineQuery } from '../../../dsl/define-query.ts';
import { typedOutput } from '../../../dsl/typed-output.ts';
import { errors } from '../../../errors/errors.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import type { ClientFlagDocument } from '../../../flags/client-flag-document.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { flag } from '../../entities/flag.ts';

/**
 * The `core.flag.evaluate` query (20.3): a client asks for one of its own flags, `client: true`
 * only, for the caller's own context. The runtime answers it; a key that is unknown and a key that
 * is server-only get the same refusal.
 */
export const evaluate: CoreLiteral['entityActions']['flag']['evaluate'] = defineQuery(
  coreBase,
  flag,
  {
    scope: 'tenant',
    auth: { public: true },
    input: shape({ key: field.string({ minLength: 1, maxLength: 200 }) }),
    output: typedOutput<ClientFlagDocument>(),
    read: () => {
      throw errors.not_implemented('core.flag.evaluate is answered by the runtime.');
    },
  },
);
