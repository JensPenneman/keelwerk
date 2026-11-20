import { type ApiSurface, type SurfaceAction, toJsonSchema } from '@keelwerk/core';
import { type AnyProcedure, eventIterator, os } from '@orpc/server';
import { invokeProcedure } from './invoke-procedure.ts';
import { nodeSchemaOf } from './node-schema-of.ts';
import type { OrpcContext } from './orpc-context.ts';
import { orpcErrorMapOf } from './orpc-error-map-of.ts';
import { orpcFrameJsonSchema } from './orpc-frame-json-schema.ts';
import { subscribeProcedure } from './subscribe-procedure.ts';

/**
 * The procedure of one surface action: a query, a command or a subscription, with the declared
 * errors of the action as its error map. The schemas pass every value unchanged, because the invoker
 * validates once; they describe the nodes for the OpenAPI document. The action is the procedure's
 * tag and a deprecated action is marked so. A subscription's output describes its frames, an item
 * envelope or a control frame, not the bare event. The procedure sets no method and no path:
 * oRPC's defaults apply.
 */
export function procedureFor(surface: ApiSurface, action: SurfaceAction): AnyProcedure {
  const base = os
    .$context<OrpcContext>()
    .route({
      tags: [action.module],
      ...(action.description === undefined ? {} : { description: action.description }),
      ...(action.deprecated === undefined ? {} : { deprecated: true }),
    })
    .errors(orpcErrorMapOf(surface, action))
    .input(
      nodeSchemaOf(
        (direction) => toJsonSchema(action.input, { direction }),
        action.input.kind === 'void',
      ),
    );
  if (action.kind === 'subscription') {
    return base
      .output(
        eventIterator(
          nodeSchemaOf((direction) =>
            orpcFrameJsonSchema(toJsonSchema(action.output, { direction })),
          ),
        ),
      )
      .handler(({ context, input, lastEventId, signal }) =>
        subscribeProcedure(context, action, input, lastEventId, signal),
      );
  }
  return base
    .output(nodeSchemaOf((direction) => toJsonSchema(action.output, { direction })))
    .handler(({ context, input }) => invokeProcedure(context, action, input));
}
