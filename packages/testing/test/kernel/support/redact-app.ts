import type { AppType, EntityType, ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  defineApiVersions,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  errors,
  field,
  shape,
} from '@keelwerk/core';

const patientDef = defineEntity({
  prefix: 'pat',
  dataSubject: 'ownerId',
  fields: {
    name: field.string({ maxLength: 100 }),
    ownerId: field.subject().index(),
    email: field.string({ maxLength: 100 }).optional().personal(),
    ward: field.string({ maxLength: 100 }).optional().hidden(),
  },
  generated: { history: true, watch: false },
});
interface Patient extends EntityType<typeof patientDef> {}
const patient: Patient = patientDef;

const clinicBaseDef = defineModuleBase({ id: 'clinic', version: '0.1.0', entities: { patient } });
interface ClinicBase extends ModuleBaseType<typeof clinicBaseDef> {}
const clinicBase: ClinicBase = clinicBaseDef;

/** Set by a test after a command ran: `describe` then fails, so a re-decide meets a handler that throws. */
const redactSwitches = { refuse: false };

/**
 * A custom (non-entity) output: the patient's email and the user agent of the request under members
 * flagged hidden, the name under one that is not. With `redactSwitches.refuse` it fails with a
 * message that carries the email and the user agent.
 */
const describePatient = defineCommand(clinicBase, {
  input: shape({ id: field.ref.own('patient') }),
  output: shape({
    // A personal member is refused in an output at composition; a hidden one is what an output can flag.
    email: field.string().optional().hidden(),
    agent: field.string().optional().hidden(),
    name: field.string(),
  }),
  principal: 'user',
  *decide(input, ctx) {
    const row = yield* ctx.load.clinic.patient.byId(input.id);
    if (row === undefined) return { result: { name: 'none' } };
    const agent = ctx.request.userAgent;
    if (redactSwitches.refuse) {
      throw errors.conflict(
        `${row.email ?? 'no email'} is already admitted from ${agent ?? 'none'}`,
      );
    }
    return {
      events: [ctx.write.clinic.patient.update(row, { ward: 'seen' })],
      result: {
        ...(row.email === undefined ? {} : { email: row.email }),
        ...(agent === undefined ? {} : { agent }),
        name: row.name,
      },
    };
  },
});

const clinicDef = defineModule(clinicBase, {
  actions: { describePatient },
  policies: {
    describePatient: {
      users: defineRule(clinicBase, describePatient, { effect: 'allow', principal: 'user' }),
    },
    patient: {
      readers: defineRule(clinicBase, patient, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        reason: 'A signed-in user reads every patient.',
      }),
      writers: defineRule(clinicBase, patient, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
        reason: 'A signed-in user writes every patient.',
      }),
    },
  },
});
interface Clinic extends ModuleType<typeof clinicDef> {}
const clinic: Clinic = clinicDef;

/** The two API versions of the app: the head and an older one a command can be expressed in. */
const olderVersion = '2026-03-01';
const headVersion = '2026-06-01';

const redactAppDef = defineApp({
  id: 'redact-clinic',
  modules: [clinic] as const,
  api: defineApiVersions({ [olderVersion]: {}, [headVersion]: {} }),
});
interface RedactApp extends AppType<typeof redactAppDef> {}

/** An app with one entity that holds a personal and a hidden field, the generated commands over it, and two API versions. */
export const redactApp: RedactApp = redactAppDef;

export { olderVersion, redactSwitches };
