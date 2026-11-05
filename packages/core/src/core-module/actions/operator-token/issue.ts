import { defineCommand } from '../../../dsl/define-command.ts';
import { durationMs } from '../../../effects/duration-ms.ts';
import { errors } from '../../../errors/errors.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { operatorToken } from '../../entities/operator-token.ts';
import { operatorTokenPrefix } from '../../operator-token-prefix.ts';

const defaultTtl = '12h';
const longestTtlMs = 30 * 86_400_000;

/**
 * The `core.operatorToken.issue` command (section 3.5, S-32): a remote operator profile's
 * credential, expiring after 12 hours unless `ttl` says otherwise (at most 30 days). The token is in
 * the answer once; the row keeps its public id and its verifier, sealed.
 */
export const issue: CoreLiteral['entityActions']['operatorToken']['issue'] = defineCommand(
  coreBase,
  operatorToken,
  {
    creates: true,
    shownOnce: ['token'],
    scope: 'deployment',
    principal: 'operator',
    input: shape({ label: field.string({ maxLength: 100 }), ttl: field.string().optional() }),
    output: shape({
      id: field.ref.own('operatorToken'),
      token: field.string(),
      expiresAt: field.instant(),
    }),
    *decide(input, ctx) {
      // Issued over the socket or after an operator login (section 3.5): a token never mints another.
      if (ctx.principal.via === 'core.operatorToken') {
        throw errors.forbidden('An operator token does not issue operator tokens.');
      }
      const lifetime = durationMs(input.ttl ?? defaultTtl);
      if (lifetime < 60_000 || lifetime > longestTtlMs) {
        throw errors.validation('An operator token lives from one minute to 30 days.');
      }
      const id = yield* ctx.newId(operatorToken);
      const issued = yield* ctx.secrets.issue({ prefix: operatorTokenPrefix });
      const expiresAt = ctx.clock.now().add({ milliseconds: lifetime });
      return {
        events: [
          ctx.write.core.operatorToken.create({
            id,
            label: input.label,
            publicId: issued.publicId,
            verifier: issued.verifier,
            expiresAt,
          }),
        ],
        result: { id, token: issued.plain, expiresAt },
      };
    },
  },
);
