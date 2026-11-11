import {
  errors,
  toWire as errorToWire,
  type FieldNode,
  type KeelwerkError,
  newUuidV7,
  pascal,
  type SurfaceAction,
} from '@keelwerk/core';
import { audienceOf } from '@keelwerk/core/http';
import { toWire } from '@keelwerk/core/wire';
import type { GraphQLFieldResolver } from 'graphql';
import { graphqlErrorOf } from '../errors/graphql-error-of.ts';
import { connectionInput } from './connection-input.ts';
import { encodeOutput } from './encode-output.ts';
import type { GraphqlContext } from './graphql-context.ts';
import { invokeAction } from './invoke-action.ts';
import { plainOf } from './plain-of.ts';

type Members = Readonly<Record<string, unknown>>;

function isMembers(value: unknown): value is Members {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The caller's command id and execution preference, and the wire input the other members make. */
function commandInputOf(
  action: SurfaceAction,
  args: Members,
): { readonly wire: unknown; readonly commandId?: string; readonly prefer?: 'sync' | 'async' } {
  const held: unknown = plainOf(args.input);
  const input = isMembers(held) ? held : {};
  const { commandId, prefer, ...rest } = input;
  const wire =
    action.input.kind === 'foreign' ? rest.value : action.input.kind === 'void' ? undefined : rest;
  return {
    wire,
    ...(typeof commandId === 'string' ? { commandId } : {}),
    ...(prefer === 'sync' || prefer === 'async' ? { prefer } : {}),
  };
}

function encodeDetails(context: GraphqlContext, data: FieldNode, error: KeelwerkError): unknown {
  try {
    return toWire(data, error.details);
  } catch (thrown) {
    throw graphqlErrorOf(
      errors.internal('The data of a declared error does not fit its node.', { cause: thrown }),
      context,
    );
  }
}

/** The union member of a declared error: its code, message and the data members, encoded by the data node. */
function declaredError(context: GraphqlContext, error: KeelwerkError): Record<string, unknown> {
  const spec = context.surface.errors.find((candidate) => candidate.code === error.code);
  const wire = errorToWire(error, audienceOf(context.session, context.development));
  const data =
    spec?.data === undefined || error.details === undefined
      ? {}
      : encodeDetails(context, spec.data, error);
  return {
    ...(typeof data === 'object' && data !== null ? data : {}),
    __typename: `${pascal(error.code)}Error`,
    code: error.code,
    message: wire.message,
  };
}

/**
 * The resolver of a Query or Mutation field (sections 16.6.2 and 16.6.3): the arguments become the
 * wire input, the action runs through the invoker under the request's session, and the answer is
 * encoded once. A query answers its encoded output. A command answers a member of its result
 * union: the receipt of an accepted command as `CommandAccepted`, the output as `<Name>Success`,
 * and a declared error as its own object type; every other failure is thrown as a GraphQL error
 * with `extensions.code` and `extensions.keelwerk`.
 */
export function rootResolver(
  action: SurfaceAction,
  typeName: string,
): GraphQLFieldResolver<unknown, GraphqlContext> {
  return async (_source, args: Members, context, info) => {
    if (action.kind === 'query') {
      const wire =
        action.generated === 'query'
          ? connectionInput(args, info)
          : action.input.kind === 'foreign'
            ? plainOf(args.input)
            : action.input.kind === 'void'
              ? undefined
              : plainOf(args);
      const outcome = await invokeAction(context, action, wire);
      if (!outcome.ok) throw graphqlErrorOf(outcome.error, context);
      return encodeOutput(context, action, outcome.value);
    }
    const { wire, commandId = newUuidV7(), prefer } = commandInputOf(action, args);
    const outcome = await invokeAction(context, action, wire, {
      commandId,
      ...(prefer === undefined ? {} : { prefer }),
    });
    // A command may have changed rows a reference shows; later fields of this request read afresh.
    context.clearLoaders();
    if (!outcome.ok) {
      if (action.errors.includes(outcome.error.code)) {
        return declaredError(context, outcome.error);
      }
      throw graphqlErrorOf(outcome.error, context);
    }
    if (outcome.receipt !== undefined) {
      return {
        __typename: 'CommandAccepted',
        commandId: outcome.receipt.commandId,
        status: outcome.receipt.status,
      };
    }
    return {
      __typename: `${typeName}Success`,
      result: encodeOutput(context, action, outcome.value),
      commandId,
    };
  };
}
