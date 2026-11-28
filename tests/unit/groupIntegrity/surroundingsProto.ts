import * as THREE from "three";

/*
 * Build 0131 STEP 1 PROTOTYPE (test tree only; nothing in src uses it): the presentation mechanism proposed for Surroundings, built on real three.js objects so that its behaviour can be checked headlessly.
 * One registry per viewport (per ThreeState), never module-level: it owns every temporary rendering change and can undo all of them.
 */

/** The overlay's state (Bill's Q1 and Q6): per Group Editing SESSION; never saved, never in history, never dirty. */
export type SurroundingsState = { opacity: number; references: boolean };
export const beginSurroundingsSession = (): SurroundingsState => ({ opacity: 0, references: true });
export const setSurroundingsOpacity = (state: SurroundingsState, value: number): SurroundingsState => ({ ...state, opacity: Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) });
export const setUseAsReferences = (state: SurroundingsState, value: boolean): SurroundingsState => ({ ...state, references: value });
/** The checkbox is disabled at 0% but keeps its checked state. */
export const referencesCheckboxDisabled = (state: SurroundingsState) => state.opacity === 0;
/** Effective participation as a reference: opacity above zero AND the (retained) choice. */
export const surroundingsParticipate = (state: SurroundingsState) => state.opacity > 0 && state.references;

type Memo = { materials: THREE.Material | THREE.Material[]; raycast: THREE.Mesh["raycast"]; castShadow: boolean; variant: THREE.Material | THREE.Material[] | null };
const noRaycast = () => undefined;

export class DimmingRegistry {
  private variants = new Map<THREE.Material, THREE.Material>();
  private memos = new Map<THREE.Mesh | THREE.LineSegments, Memo>();
  private hidden = new Map<THREE.Object3D, boolean>();
  created = 0;
  disposed = 0;

  get variantCount() { return this.variants.size; }
  get touchedCount() { return this.memos.size; }

  private variantOf(base: THREE.Material, opacity: number): THREE.Material {
    let variant = this.variants.get(base);
    if (!variant) {
      variant = base.clone();
      // clone() does not carry the shader hook (the overhang tint) or the program key: copy them, and mark the variant as OWNED by the registry (the shared disposal helpers skip `cached`, and must never dispose the textures it shares with the base)
      variant.onBeforeCompile = base.onBeforeCompile;
      variant.customProgramCacheKey = base.customProgramCacheKey;
      variant.userData = { ...base.userData, cached: true, dimmingBase: base, baseOpacity: base.opacity };
      variant.transparent = true;
      variant.depthWrite = false;
      variant.needsUpdate = true;
      this.variants.set(base, variant);
      this.created += 1;
    }
    variant.opacity = (variant.userData.baseOpacity as number) * opacity;
    return variant;
  }

  /** Brings every dimmed root into the state `opacity` and `references` describe, and every root that is no longer dimmed back to normal. Idempotent: call it after every scene sync. */
  sync(dimmedRoots: readonly THREE.Object3D[], state: SurroundingsState) {
    const wanted = new Set(dimmedRoots);
    for (const root of [...this.hidden.keys()]) if (!wanted.has(root)) this.restoreRoot(root);
    const meshRoots = new Set<THREE.Object3D>();
    for (const root of dimmedRoots) {
      meshRoots.add(root);
      if (!this.hidden.has(root)) this.hidden.set(root, root.visible);
      root.visible = state.opacity > 0 ? (this.hidden.get(root) as boolean) : false;
      const styled = state.opacity > 0 && state.opacity < 1;
      const pickable = surroundingsParticipate(state);
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh && !(child as THREE.LineSegments).isLineSegments) return;
        let memo = this.memos.get(mesh);
        if (!memo) {
          memo = { materials: mesh.material, raycast: mesh.raycast, castShadow: mesh.castShadow, variant: null };
          this.memos.set(mesh, memo);
        } else if (memo.variant !== null && mesh.material !== memo.variant) {
          memo.materials = mesh.material;               // the scene sync replaced the material (an appearance change): that is the new original
          memo.variant = null;
        } else if (memo.variant === null && mesh.material !== memo.materials) {
          memo.materials = mesh.material;
        }
        if (styled) {
          const bases = Array.isArray(memo.materials) ? memo.materials : [memo.materials];
          const made = bases.map((base) => this.variantOf(base, state.opacity));
          const next = Array.isArray(memo.materials) ? made : made[0];
          memo.variant = next;
          mesh.material = next;
          mesh.castShadow = false;                         // a translucent surrounding must not cast a full shadow onto the members
        } else {
          mesh.material = memo.materials;                  // 0% (not drawn) and 100% (exactly the normal look)
          memo.variant = null;
          mesh.castShadow = memo.castShadow;
        }
        mesh.raycast = pickable ? memo.raycast : noRaycast;
      });
    }
    // variants nobody uses any more are released now (no accumulation)
    const inUse = new Set<THREE.Material>();
    for (const memo of this.memos.values()) if (memo.variant) (Array.isArray(memo.variant) ? memo.variant : [memo.variant]).forEach((v) => inUse.add(v));
    for (const [base, variant] of [...this.variants]) if (!inUse.has(variant)) { variant.dispose(); this.disposed += 1; this.variants.delete(base); }
    void meshRoots;
  }

  /** The slider: only the variants' opacity changes (no geometry, record or material assignment); returns how many it touched. */
  setOpacityOnly(opacity: number): number {
    for (const [, variant] of this.variants) variant.opacity = (variant.userData.baseOpacity as number) * opacity;
    return this.variants.size;
  }

  private restoreRoot(root: THREE.Object3D) {
    const prior = this.hidden.get(root);
    if (prior !== undefined) root.visible = prior;
    this.hidden.delete(root);
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const memo = this.memos.get(mesh);
      if (!memo) return;
      mesh.material = memo.materials;
      mesh.raycast = memo.raycast;
      mesh.castShadow = memo.castShadow;
      this.memos.delete(mesh);
    });
  }

  /** The end of the session (or of the viewport): every temporary rendering change is undone and every variant released. */
  release() {
    for (const root of [...this.hidden.keys()]) this.restoreRoot(root);
    for (const [mesh, memo] of [...this.memos]) { mesh.material = memo.materials; mesh.raycast = memo.raycast; mesh.castShadow = memo.castShadow; this.memos.delete(mesh); }
    for (const variant of this.variants.values()) { variant.dispose(); this.disposed += 1; }
    this.variants.clear();
  }
}
