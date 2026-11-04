// Entry point: `pnpm --filter @keelwerk/spike-write-path measure [ids...]` prints the results as Markdown.
import { argv, stdout } from 'node:process';
import { runMeasurements } from './run-measurements.ts';

await runMeasurements(argv.slice(2), (text) => stdout.write(text));
