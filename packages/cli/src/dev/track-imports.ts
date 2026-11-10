import { registerHooks } from 'node:module';
import process from 'node:process';
import { eventMarker } from './event-marker.ts';

const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
/** The modules that are evaluated before the hooks exist, so they can never report themselves done: this one and the event marker. */
const preloaded = new Set([
  import.meta.url,
  new URL(`./event-marker${extension}`, import.meta.url).href,
]);

function isProjectFile(url: string): boolean {
  return url.startsWith('file:') && !url.includes('/node_modules/') && !preloaded.has(url);
}

function textOf(source: string | ArrayBuffer | NodeJS.ArrayBufferView): string {
  if (typeof source === 'string') return source;
  return source instanceof ArrayBuffer
    ? Buffer.from(source).toString('utf8')
    : Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString('utf8');
}

/**
 * Reports, on standard error, every import of a project file (`import <parent> <file>`) and every
 * module whose evaluation finished (`done <file>`), so a supervisor that kills a child that did not
 * finish can name the import that hung (section 13.6). Install it before the first project import.
 */
export function trackImports(): void {
  const emit = (event: string): void => {
    process.stderr.write(`\n${eventMarker} ${event}\n`);
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (isProjectFile(resolved.url)) emit(`import ${context.parentURL ?? '-'} ${resolved.url}`);
      return resolved;
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (!isProjectFile(url)) return loaded;
      const format = loaded.format ?? '';
      const extensible = format.startsWith('module') || format === 'commonjs';
      if (loaded.source === null || loaded.source === undefined || !extensible) {
        // JSON, WebAssembly and loads without a source have no evaluation to wait for, so they are done at once.
        emit(`done ${url}`);
        return loaded;
      }
      const done = `globalThis.process.stderr.write(${JSON.stringify(`\n${eventMarker} done ${url}\n`)});`;
      return { ...loaded, source: `${textOf(loaded.source)}\n;${done}\n` };
    },
  });
}
