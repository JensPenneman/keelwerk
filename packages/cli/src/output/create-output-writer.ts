import type { StricliProcess } from '@stricli/core';
import type { OutputFormat } from './output-format.ts';
import type { OutputWriter } from './output-writer.ts';
import { pageItems } from './page-items.ts';
import { renderError } from './render-error.ts';
import { renderNdjson } from './render-ndjson.ts';
import { renderTable } from './render-table.ts';
import { renderText } from './render-text.ts';
import { renderYaml } from './render-yaml.ts';

export interface OutputOptions {
  readonly format?: OutputFormat;
  readonly interactive: boolean;
  readonly fields?: readonly string[];
}

/** The default is text on a terminal and JSON otherwise (section 16.9.5). */
export function createOutputWriter(
  io: Pick<StricliProcess, 'stdout' | 'stderr'>,
  options: OutputOptions,
): OutputWriter {
  const format: OutputFormat = options.format ?? (options.interactive ? 'text' : 'json');
  const render = (value: unknown): string => {
    switch (format) {
      case 'json':
        return JSON.stringify(value, null, options.interactive ? 2 : undefined);
      case 'yaml':
        return renderYaml(value);
      case 'ndjson':
        return renderNdjson(value);
      case 'table':
        return renderTable(pageItems(value) ?? [value], options.fields);
      case 'text':
        return renderText(value, options.fields);
    }
  };
  return {
    format,
    using(choice) {
      return createOutputWriter(io, {
        interactive: options.interactive,
        ...((choice.format ?? options.format) !== undefined && {
          format: choice.format ?? options.format,
        }),
        ...((choice.fields ?? options.fields) !== undefined && {
          fields: choice.fields ?? options.fields,
        }),
      });
    },
    value(value) {
      io.stdout.write(`${render(value)}\n`);
    },
    line(text) {
      io.stdout.write(`${text}\n`);
    },
    error(error) {
      io.stderr.write(`${renderError(error, format === 'json')}\n`);
    },
    note(text) {
      io.stderr.write(`${text}\n`);
    },
  };
}
