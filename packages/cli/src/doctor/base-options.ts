/** The options of `tsconfig.base.json` that section 13.3 requires, with their values. */
export const baseOptions: Readonly<Record<string, unknown>> = {
  composite: true,
  erasableSyntaxOnly: true,
  exactOptionalPropertyTypes: true,
  module: 'nodenext',
  moduleResolution: 'nodenext',
  noImplicitOverride: true,
  noUncheckedIndexedAccess: true,
  rewriteRelativeImportExtensions: true,
  strict: true,
  verbatimModuleSyntax: true,
};
