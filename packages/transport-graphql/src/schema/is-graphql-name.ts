const graphqlName = /^[_A-Za-z][_0-9A-Za-z]*$/;

/** Whether `name` is a GraphQL name: a letter or an underscore, then letters, digits or underscores. */
export function isGraphqlName(name: string): boolean {
  return graphqlName.test(name);
}
