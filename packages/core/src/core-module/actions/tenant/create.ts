import { defineCommand } from '../../../dsl/define-command.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { tenant } from '../../entities/tenant.ts';

/**
 * The `core.tenant.create` command (S-109): an operator's explicit, deployment-scope creation of
 * a tenant. The runtime's control path runs it (backend, placement and version checks, the
 * `onTenantCreated` hooks); the domain rows come from the `core.syncDomains` reaction in the same
 * unit, and a host name another tenant holds fails it with `conflict`.
 */
export const create: CoreLiteral['entityActions']['tenant']['create'] = defineCommand(
  coreBase,
  tenant,
  {
    creates: true,
    scope: 'deployment',
    principal: 'operator',
    input: shape({
      backendId: field.ref.own('backend'),
      name: field.string(),
      placement: field.string().optional(),
      apiVersion: field.string().optional(),
      domains: field.list(field.string()).optional(),
    }),
    output: shape({ id: field.ref.own('tenant') }),
    *decide(input, ctx) {
      const id = yield* ctx.newId(tenant);
      return {
        events: [
          ctx.write.core.tenant.create({
            id,
            backendId: input.backendId,
            name: input.name,
            domains: [...(input.domains ?? [])],
            ...(input.placement === undefined ? {} : { placement: input.placement }),
            ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
          }),
        ],
        result: { id },
      };
    },
  },
);
