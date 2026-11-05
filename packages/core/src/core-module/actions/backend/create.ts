import { defineCommand } from '../../../dsl/define-command.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { backend } from '../../entities/backend.ts';
import { configSchema } from '../../shapes/config-schema.ts';

/**
 * The `core.backend.create` command (S-109): an operator's explicit, deployment-scope creation of
 * a backend. The runtime's control path runs it (catalogue, placement and version checks, the
 * config check and the sealing of its secrets, the `onBackendCreated` hooks); the generated
 * `create` of the entity is off.
 */
export const create: CoreLiteral['entityActions']['backend']['create'] = defineCommand(
  coreBase,
  backend,
  {
    creates: true,
    scope: 'deployment',
    principal: 'operator',
    input: shape({
      name: field.string(),
      app: field.string(),
      placement: field.string(),
      apiVersion: field.string().optional(),
      config: field.json(configSchema).optional(),
    }),
    output: shape({ id: field.ref.own('backend') }),
    *decide(input, ctx) {
      const id = yield* ctx.newId(backend);
      return {
        events: [
          ctx.write.core.backend.create({
            id,
            name: input.name,
            app: input.app,
            placement: input.placement,
            ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
            ...(input.config === undefined ? {} : { config: input.config }),
          }),
        ],
        result: { id },
      };
    },
  },
);
