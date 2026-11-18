/**
 * The ids of the runtime services whose `context.signal` does not abort when the process gate
 * closes (14.7.6): the mark recorder, whose loop records the evidence of the restore and so is what
 * lets `Runtime.outOfService` settle. Every other service, the kernel's and the event workers of a
 * deployment, receives a signal that aborts at teardown or when the gate closes, so a service
 * added later stops in a process that left service without anyone naming it here. Nothing else
 * answers readiness or refuses requests through a service: the invoker and the process row do
 * that, outside the list of services.
 */
export const staysInService: ReadonlySet<string> = new Set(['core.marks']);
