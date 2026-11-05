/** The directories whose files declare something the module base lists (section 23.5), and the base's property for each. */
export const declarationListings: ReadonlyMap<string, string> = new Map([
  ['entities', 'entities'],
  ['extension-points', 'extensionPoints'],
  ['flags', 'flags'],
  ['streams', 'streams'],
]);
