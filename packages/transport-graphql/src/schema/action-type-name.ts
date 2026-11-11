import { pascal, type SurfaceAction } from '@keelwerk/core';
import { rootFieldName } from './root-field-name.ts';

/** The type name an action's input, result and output types hang on: the `graphql.type` hint, else the Pascal form of its root field (section 16.6.3). */
export function actionTypeName(action: SurfaceAction): string {
  return action.hints.graphql?.type ?? pascal(rootFieldName(action));
}
