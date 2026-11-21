/**
 * What the running test file declared and started: `count` the deadlocks its cases declared
 * (`declareDeadlocks`), read and emptied by the connection guard; `checked` the containers it
 * started with the deadlock check on (`startPostgres`), which a stop uses to refuse an ambiguous
 * declaration.
 */
export const declaredDeadlocks = { count: 0, checked: 0 };
