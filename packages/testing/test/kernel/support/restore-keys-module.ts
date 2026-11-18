import type { AppType, ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  cancelTimer,
  defineApp,
  defineCommand,
  defineEffect,
  defineEffectExecutor,
  defineModule,
  defineModuleBase,
  defineRule,
  enqueue,
  field,
  setTimer,
  shape,
} from '@keelwerk/core';

/** What the module reports to a test: how often its executor and its jobs ran, by label. */
const restoreKeysControl: { readonly pinged: string[]; readonly fired: string[] } = {
  pinged: [],
  fired: [],
};

const restoreKeysBaseDef = defineModuleBase({ id: 'restorekeys', version: '0.1.0' });
interface RestoreKeysBase extends ModuleBaseType<typeof restoreKeysBaseDef> {}
const restoreKeysBase: RestoreKeysBase = restoreKeysBaseDef;

const ping = defineEffect(restoreKeysBase, { input: shape({ label: field.string() }) });

const pingExecutor = defineEffectExecutor(restoreKeysBase, ping, {
  queue: 'restorekeys-ping',
  run: (input) => {
    restoreKeysControl.pinged.push(input.label);
    return Promise.resolve({});
  },
});

/** What the timer and the keyed enqueue run: it only records its label. */
const fire = defineCommand(restoreKeysBase, {
  input: shape({ label: field.string() }),
  principal: ['operator', 'service'],
  decide: (input) => {
    restoreKeysControl.fired.push(input.label);
    return {};
  },
});

/** Requests an effect, sets a timer and enqueues a job, each under a key the module chose. */
const request = defineCommand(restoreKeysBase, {
  input: shape({
    label: field.string(),
    effectKey: field.string(),
    timerKey: field.string(),
    jobKey: field.string(),
  }),
  principal: 'operator',
  decide: (input) => ({
    effects: [
      ping({ label: input.label }, { key: input.effectKey }),
      setTimer({ key: input.timerKey, after: '1h', invoke: fire, input: { label: input.label } }),
      enqueue(
        fire,
        { label: input.label },
        { runAt: Temporal.Instant.from('2027-01-01T00:00:00Z'), key: input.jobKey },
      ),
    ],
  }),
});

/** Cancels a timer by the key text the module gave it. */
const cancel = defineCommand(restoreKeysBase, {
  input: shape({ timerKey: field.string() }),
  principal: 'operator',
  decide: (input) => ({ effects: [cancelTimer(input.timerKey)] }),
});

const restoreKeysDef = defineModule(restoreKeysBase, {
  actions: { request, cancel, fire },
  effects: { ping },
  executors: { ping: pingExecutor },
  policies: {
    request: {
      operators: defineRule(restoreKeysBase, request, { effect: 'allow', principal: 'operator' }),
    },
    cancel: {
      operators: defineRule(restoreKeysBase, cancel, { effect: 'allow', principal: 'operator' }),
    },
    fire: {
      operators: defineRule(restoreKeysBase, fire, {
        effect: 'allow',
        principal: ['operator', 'service'],
      }),
    },
  },
});
interface RestoreKeys extends ModuleType<typeof restoreKeysDef> {}
const restoreKeys: RestoreKeys = restoreKeysDef;

const restoreKeysAppDef = defineApp({ id: 'restore-keys', modules: [restoreKeys] as const });
interface RestoreKeysApp extends AppType<typeof restoreKeysAppDef> {}

/** An app with one module that chooses the key of an effect, of a timer and of an enqueue. */
export const restoreKeysApp: RestoreKeysApp = restoreKeysAppDef;

export { restoreKeysControl };
