import type { DocumentNode } from 'graphql';
import type { Plugin } from 'graphql-yoga';
import type { GraphqlContext } from '../resolve/graphql-context.ts';

/**
 * Makes the executor run exactly what the gate checked (section 16.6.6, decision D11): parsing
 * answers the gate's document for the query text and validation is skipped, because the gate
 * validated it. A query text the gate did not see is not parsed here either: it is refused.
 */
export function preparedDocumentsPlugin(
  documents: (context: GraphqlContext) => ReadonlyMap<string, DocumentNode>,
): Plugin<GraphqlContext> {
  return {
    onParse({ context, params, setParsedDocument }) {
      const source = typeof params.source === 'string' ? params.source : params.source.body;
      const document = documents(context).get(source);
      if (document === undefined) {
        throw new Error('The document was not prepared by the gate.');
      }
      setParsedDocument(document);
    },
    onValidate({ setResult }) {
      setResult([]);
    },
  };
}
