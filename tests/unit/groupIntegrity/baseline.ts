/**
 * KNOWN DEFECTS of the current reconstruction on the real documents (Findings 2, section 4), recorded as ceilings: the numbers may go DOWN
 * when a defect is fixed (then lower them), they must never go UP (that is a regression). Measured with LAYERLING_INTEGRITY_FULL=1 on the
 * fixtures named in `fixturePath`, over every non-hidden, non-locked group up to 120,000 triangles, a no-op open and finish each.
 */
export type FixtureName = "medium" | "foshay" | "saud";

/** Groups the current Done cannot rebuild at all: "This mesh is not closed ..." (Tinkercad Round Roof meshes, 6 open edges) and "Could not cut this imported mesh cleanly" (a hole that cuts nothing). */
export const KNOWN_REBUILD_FAILURES: Record<FixtureName, number> = { medium: 0, foshay: 1, saud: 95 };

/** Solid (not hole-only) groups whose rebuilt body differs from the stored one by more than the body tolerance. */
export const KNOWN_BODY_EXCEEDANCES: Record<FixtureName, number> = { medium: 0, foshay: 6, saud: 0 };

/**
 * KNOWN DEFECT D11: groups whose frame (position, size, bases) or body box is re-derived more than DIMENSION_TOLERANCE away from the stored one
 * (up to about 1 mm where holes protrude past the body). Ceilings, measured with FULL.
 */
export const KNOWN_FRAME_SHIFTS: Record<FixtureName, number> = { medium: 0, foshay: 13, saud: 0 };

/** Failure messages that are known defects; any other failure message is a regression. */
export const KNOWN_FAILURE_MESSAGES = [/This mesh is not closed/, /Could not cut this imported mesh cleanly/];

/** Property differences a no-op Done makes today (known defects D2a/D2b); anything else is a regression. */
export const KNOWN_PROPERTY_DIFFS = new Set(["mirrorX", "mirrorY", "mirrorZ", "color"]);

/** Tolerances for a re-derived body (observed maxima: bounding box 7 micrometres, relative volume 3.1e-3 on solid groups). */
export const BODY_BBOX_TOLERANCE = 0.01;
export const BODY_VOLUME_TOLERANCE = 5e-3;
/** Dimensions and bases are re-derived from the rebuilt body (observed up to 7 micrometres) and rounded to 0.001. */
export const DIMENSION_TOLERANCE = 0.01;
/** Untouched leaves are compared in the world after the group frame is removed and applied again: float noise only (observed 1.4e-14 mm for turned parts). */
export const LEAF_TOLERANCE = 1e-9;

/**
 * Build 0122: groups the STRICT reconstruction (native Done after an edit) refuses: an operand that is not a closed solid (the 91 Round Roof groups of SAUD) or a body that could
 * only be made by a degraded fallback (Foshay's open-cut groups). Every refusal must name an object. Ceilings; a repair of the meshes lowers them. The 4 SAUD groups whose hole
 * touches nothing are NOT refusals any more (they succeed).
 */
export const KNOWN_STRICT_REFUSALS: Record<FixtureName, number> = { medium: 0, foshay: 56, saud: 334 };
/**
 * Build 0126: native Done now UNIONS the holes of a hole-only group (and refuses when it cannot), so the hole-only groups built on open meshes are validated for the first time. On the
 * UNREPAIRED documents that adds exactly these refusals to the 0122 ones (SAUD 91 + 243 = 334, Foshay 53 + 3 = 56; measured, FULL census). After Repair Open Meshes every hole-only
 * group of SAUD (583 with nesting), Foshay (564) and Depot Window Cutout (1) unions (holeUnion.fixtures.test.ts), and the 91 mixed groups rebuild as before.
 */
export const KNOWN_HOLE_ONLY_REFUSALS_UNREPAIRED: Record<FixtureName, number> = { medium: 0, foshay: 3, saud: 243 };
