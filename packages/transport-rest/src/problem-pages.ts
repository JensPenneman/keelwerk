import type { ApiSurface } from '@keelwerk/core';
import { htmlEscape } from './html-escape.ts';

function pageOf(surface: ApiSurface, error: ApiSurface['errors'][number]): string {
  const { code } = error;
  const declaredBy = surface.actions.filter((action) => action.errors.includes(code));
  const rows = declaredBy
    .map((action) => `<li><code>${htmlEscape(action.ref)}</code></li>`)
    .join('');
  const data =
    error.data === undefined
      ? '<p>No data.</p>'
      : `<pre>${htmlEscape(JSON.stringify(error.data, null, 2))}</pre>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(code)}</title>
</head>
<body>
<h1><code>${htmlEscape(code)}</code></h1>
<dl>
<dt>Kind</dt><dd>${htmlEscape(error.kind)}</dd>
<dt>Message</dt><dd>${htmlEscape(error.message)}</dd>
<dt>Retryable</dt><dd>${error.retryable ? 'yes' : 'no'}</dd>
</dl>
<h2>Data</h2>
${data}
<h2>Declared by</h2>
${declaredBy.length === 0 ? '<p>No action declares this error.</p>' : `<ul>${rows}</ul>`}
</body>
</html>
`;
}

/**
 * The pages `GET {basePath}/problems/{code}` serves (section 16.5.4), generated from the surface
 * once: the kind, the message, whether the error is retryable, the schema of its data and the
 * actions that declare it. The lookup answers undefined when the surface has no such code.
 */
export function problemPages(surface: ApiSurface): (code: string) => Response | undefined {
  const pages = new Map(surface.errors.map((error) => [error.code, pageOf(surface, error)]));
  return (code) => {
    const html = pages.get(code);
    return html === undefined
      ? undefined
      : new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
  };
}
