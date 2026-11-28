/**
 * Build 0131: Surroundings (native Group Editing). Pure: the overlay's state, per Group Editing SESSION (never saved, never in history, never dirty).
 *
 * Three things are kept apart on purpose (Bill, 2026-11-28): the APPEARANCE of the surroundings (this opacity), whether they take part as geometric REFERENCES (opacity above zero AND the person's choice),
 * and EDITABILITY (0130: members only, independent of both). The first two are viewing and modeling conveniences; neither grants an editing privilege or weakens an integrity guarantee.
 */
export type SurroundingsState = {
  /** 0 to 1. At 0 the surroundings are not drawn; at 1 they look exactly as they normally do. */
  opacity: number;
  /** The person's "Use as references" choice. Kept (and shown checked) while the checkbox is disabled at 0%. */
  references: boolean;
};

/** A new session: opacity 0%, "Use as references" checked, effective participation off (opacity is zero). Nested transitions of the same session keep the state; the next session starts from this again. */
export const beginSurroundingsSession = (): SurroundingsState => ({ opacity: 0, references: true });

export const clampOpacity = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
export const setSurroundingsOpacity = (state: SurroundingsState, value: number): SurroundingsState => {
  const opacity = clampOpacity(value);
  return opacity === state.opacity ? state : { ...state, opacity };
};
export const setUseAsReferences = (state: SurroundingsState, references: boolean): SurroundingsState => (references === state.references ? state : { ...state, references });

/** The checkbox is disabled at 0% but keeps its checked state. */
export const referencesCheckboxDisabled = (state: SurroundingsState) => state.opacity === 0;

/** Effective participation as a geometric reference: opacity above zero AND the retained choice. Never influences framing (framing follows visibility only). */
export const surroundingsParticipate = (state: Pick<SurroundingsState, "opacity" | "references">) => state.opacity > 0 && state.references;

/** What the viewport receives (a neutral presentation: the ids to dim and how), so Workspace View Isolation can reuse the mechanism later without this module changing. */
export type DimmingPresentation = { opacity: number; references: boolean };
export const dimmingOf = (state: SurroundingsState): DimmingPresentation => ({ opacity: state.opacity, references: state.references });

/** The shapes an interactive reference may use: everything, or only the members when the dimmed objects do not take part. */
export function referenceShapesOf<T extends { id: string }>(shapes: readonly T[], dimmedIds: ReadonlySet<string> | null | undefined, presentation: DimmingPresentation | null | undefined): readonly T[] {
  if (!dimmedIds || !presentation || surroundingsParticipate(presentation)) return shapes;
  return shapes.filter((shape) => !dimmedIds.has(shape.id));
}
