import { type DocumentNode, Kind, visit } from 'graphql';

/** Whether a document selects `__schema` or `__type` anywhere, fragments included; `__typename` is not introspection. */
export function selectsIntrospection(document: DocumentNode): boolean {
  let found = false;
  visit(document, {
    [Kind.FIELD]: (node) => {
      if (node.name.value === '__schema' || node.name.value === '__type') {
        found = true;
        return false;
      }
      return undefined;
    },
  });
  return found;
}
