import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import { CiTestReporter } from './scripts/ci-test-reporter.ts';
import rootConfig from './vitest.config.ts';

// The configuration of the CI test steps: the root configuration plus a reporter that names the
// slowest tests and the test files in flight. Local runs keep using vitest.config.ts.
export default mergeConfig(
  rootConfig,
  defineConfig({ test: { reporters: [...configDefaults.reporters, new CiTestReporter()] } }),
);
