/**
 * The parsing lives in `shared` because the server reads the same cards when it
 * schedules them. This keeps the existing client imports working.
 */
export {
  cardKey,
  parseCards,
  parseSlides,
  revisionKindOf,
} from '../shared/revision'
export type {
  RevisionCard,
  RevisionKind,
  RevisionSlide,
} from '../shared/revision'
