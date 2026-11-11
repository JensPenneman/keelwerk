import { checkSelection, type KeelwerkError, type SelectionLimits } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { type DocumentNode, GraphQLError, parse, specifiedRules, validate } from 'graphql';
import type { GraphqlIdList } from '../limits/graphql-id-list.ts';
import { measureSelection } from '../limits/measure-selection.ts';
import type { GraphqlProjection } from '../schema/graphql-projection.ts';
import type { GraphqlParams } from './graphql-params.ts';

/** The refusal of the first list of ids that is longer than its field takes: each id is one read, so the cost limit alone would not bound the reads. */
function idListRefusal(lists: readonly GraphqlIdList[]): KeelwerkError | null {
  const longest = lists.find((list) => list.count > list.max);
  if (longest === undefined) return null;
  const message = `The field ${longest.field} takes at most ${longest.max} ids; the request sends ${longest.count}.`;
  return coreError('core.validation', {
    message,
    issues: [{ path: [longest.field, 'ids'], message }],
  });
}

const tokenLimitMessage = /more than \d+ tokens/;

/** The document of a query text, or `null` when the text has more tokens than the limit; any other syntax error is thrown as a malformed request. */
function parsed(query: string, limits: SelectionLimits): DocumentNode | null {
  try {
    return parse(query, { maxTokens: limits.tokens });
  } catch (thrown) {
    if (thrown instanceof GraphQLError) {
      if (tokenLimitMessage.test(thrown.message)) return null;
      throw coreError('core.malformed_request', { message: thrown.message });
    }
    throw thrown;
  }
}

/**
 * The gate of every GraphQL request (section 16.6.6, decision D11): it parses each query text, measures
 * the whole batch as one request, refuses it when it is over a limit or sends more ids to `nodes` or
 * a `...Get` field than they take, and only then validates each
 * document against the schema, without suggestions of neighbouring names. All of this runs before
 * any resolver, so no row is read for a request that is refused. Answers the documents by query
 * text, which the executor runs as they are; throws the refusal as a taxonomy error.
 */
export function prepareDocuments(
  params: readonly GraphqlParams[],
  projection: GraphqlProjection,
  limits: SelectionLimits,
): ReadonlyMap<string, DocumentNode> {
  const documents = new Map<string, DocumentNode>();
  let tooLong = false;
  for (const { query } of params) {
    if (documents.has(query) || tooLong) continue;
    const document = parsed(query, limits);
    if (document === null) tooLong = true;
    else documents.set(query, document);
  }
  let refusal: KeelwerkError | null;
  if (tooLong) {
    refusal = checkSelection(
      { paths: [], aliases: 0, operations: 0, tokens: limits.tokens + 1, connectionPages: 0 },
      limits,
    );
  } else {
    const measured = params.flatMap(({ query, variables }) => {
      const document = documents.get(query);
      return document === undefined ? [] : [{ document, variables }];
    });
    const measure = measureSelection(
      measured.map((item) => item.document),
      projection,
      limits,
      measured.map((item) => item.variables),
    );
    refusal = checkSelection(measure, limits) ?? idListRefusal(measure.idLists);
  }
  if (refusal !== null) throw refusal;
  for (const [, document] of documents) {
    const found = validate(projection.schema, document, specifiedRules, {
      hideSuggestions: true,
      maxErrors: 25,
    });
    if (found.length > 0) {
      throw coreError('core.validation', {
        message: found[0]?.message ?? 'The document is not valid.',
        issues: found.map((error) => ({
          path: (error.path ?? []).map((segment) => segment),
          message: error.message,
        })),
      });
    }
  }
  return documents;
}
