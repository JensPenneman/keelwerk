import { expect, test } from 'vitest';
import { emittedDocument } from './support/emitted-document.ts';
import { librarySurface } from './support/library-surface.ts';

const described = {
  ...librarySurface,
  resolvers: [
    { id: 'auth.session', scheme: 'cookie' as const, name: '__Host-session' },
    { id: 'api-keys.key', scheme: 'bearer' as const, description: 'An API key.' },
  ],
};

test('the security schemes come from the resolvers the surface carries', () => {
  const document = emittedDocument(described);
  expect(document.components.securitySchemes).toEqual({
    'api-keys.key': { type: 'http', scheme: 'bearer', description: 'An API key.' },
    'auth.session': { type: 'apiKey', in: 'cookie', name: '__Host-session' },
  });
  expect(document.paths['/library/books'].get.security).toEqual([
    { 'api-keys.key': [] },
    { 'auth.session': [] },
  ]);
});

test('explicit options win over the surface', () => {
  const document = emittedDocument(described, {
    resolvers: [{ id: 'only.one', describe: () => ({ scheme: 'bearer' as const }) }],
  });
  expect(Object.keys(document.components.securitySchemes)).toEqual(['only.one']);
});
