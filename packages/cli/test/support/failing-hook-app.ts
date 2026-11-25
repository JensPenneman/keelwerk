import { defineApp, defineHook, defineModule, defineModuleBase, errors } from '@keelwerk/core';

const base = defineModuleBase({ id: 'jobs', version: '0.1.0' });

const module = defineModule(base, {
  lifecycle: {
    onCreated: defineHook(base, 'onTenantCreated', () => {
      throw errors.unavailable('the hook always fails');
    }),
  },
});

/** An app whose one tenant hook always fails, so that rerunning the hooks of a tenant records a failure. */
export const failingHookApp = defineApp({ id: 'jobs-app', modules: [module] });
