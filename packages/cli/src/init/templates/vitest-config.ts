/** The root `vitest.config.ts`: runs the projects of the modules (each has its own configuration). */
export function vitestConfig(): string {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: ['modules/*/vitest*.config.ts'],
  },
});
`;
}
