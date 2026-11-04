import type { JsonObject } from './json-object.ts';
import type { SecurityResolver } from './security-resolver.ts';

function schemeOf(resolver: SecurityResolver): JsonObject {
  const description = resolver.describe();
  const documented =
    description.description === undefined ? {} : { description: description.description };
  switch (description.scheme) {
    case 'bearer':
      return { type: 'http', scheme: 'bearer', ...documented };
    case 'cookie':
      return { type: 'apiKey', in: 'cookie', name: description.name ?? 'session', ...documented };
    case 'apiKey':
      return { type: 'apiKey', in: 'header', name: description.name ?? 'X-API-Key', ...documented };
  }
}

/** The security schemes of the selected resolvers (section 16.5.5), and their names sorted. */
export interface SecuritySchemes {
  readonly schemes: Readonly<Record<string, JsonObject>>;
  readonly names: readonly string[];
}

/** One scheme per resolver, named by the resolver id; the document lists what is actually selected. */
export function securitySchemes(resolvers: readonly SecurityResolver[]): SecuritySchemes {
  const schemes: Record<string, JsonObject> = {};
  for (const resolver of resolvers) {
    schemes[resolver.id] = schemeOf(resolver);
  }
  return { schemes, names: Object.keys(schemes).sort() };
}
