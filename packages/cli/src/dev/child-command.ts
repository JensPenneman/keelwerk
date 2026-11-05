import process from 'node:process';
import type { childEntries } from './child-entries.ts';
import { resultMarker } from './result-marker.ts';

const condition = '@keelwerk/source';

const script = [
  'const [url, name, text] = process.argv.slice(1);',
  'try {',
  '  const { childEntries } = await import(url);',
  '  const result = await childEntries[name](JSON.parse(text));',
  `  if (result !== undefined) process.stdout.write('\\n${resultMarker} ' + JSON.stringify(result) + '\\n');`,
  '} catch (error) {',
  "  process.stderr.write(String(error instanceof Error ? error.message : error) + '\\n');",
  '  process.exitCode = 1;',
  '}',
  'setTimeout(() => process.exit(), 200).unref();',
].join('\n');

/** A Node child with the source condition that imports one module of this package and calls one function of it with `argument`. */
export interface ChildCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/** The command that runs the entry `name` of `childEntries` with `argument` in a fresh process. */
export function childCommand(name: keyof typeof childEntries, argument: unknown): ChildCommand {
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const target = new URL(`./child-entries${extension}`, import.meta.url).href;
  return {
    command: process.execPath,
    args: [
      `--conditions=${condition}`,
      '--input-type=module',
      '-e',
      script,
      target,
      name,
      JSON.stringify(argument),
    ],
  };
}
