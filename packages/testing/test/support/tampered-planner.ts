import type { SchemaPlanner } from '@keelwerk/core';
import { schemaPlanner } from '@keelwerk/data';

/** The planner with the first file of the `library` track changed after it was applied. */
export function tamperedPlanner(): SchemaPlanner {
  const real = schemaPlanner();
  return {
    ...real,
    loadTracks: async (module, migrations) =>
      (await real.loadTracks(module, migrations)).map((track) => ({
        ...track,
        files: track.files.map((file) => ({
          ...file,
          steps: [...file.steps, { op: 'rebuild', entity: 'library.book', reason: 'edited' }],
        })),
      })),
  };
}
