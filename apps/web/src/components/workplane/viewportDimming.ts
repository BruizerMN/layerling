import * as THREE from "three";
import { surroundingsParticipate, type DimmingPresentation } from "@/lib/surroundings";

/**
 * Build 0131: the presentation mechanism for dimmed objects (the Surroundings of Group Editing; deliberately neutral so Workspace View Isolation can reuse it).
 * ONE registry per viewport (`ThreeState.dimming`), never module-level: it owns every temporary rendering change and undoes all of them.
 *
 *  - APPEARANCE: each mesh of a dimmed root gets, per distinct current material, a registry-owned VARIANT (a clone: transparent, no depth write, opacity = the original's opacity x the dimming opacity, so holes and see-through
 *    solids keep their relative look; the shader hook of the overhang tint, the textures and the vertex colours are carried or shared). The shared originals are never touched, so members look exactly as they do.
 *    At 0% the roots are not drawn; at 100% the ORIGINAL materials are back (the normal look and rendering path, far-half pass included). Below 100% the meshes do not cast shadows.
 *  - REFERENCES: a dimmed object that does not take part (opacity zero, or the person's choice off) has its `raycast` swapped for a no-op, so no ray cast of any picking, snapping, measuring or face-reading site sees it. The
 *    ORIGINAL implementation (lazy, accelerated, no-op) is restored exactly.
 *  - Nothing here decides editability or selection (0130), and nothing here touches framing (framing follows `visible`).
 * Variants are flagged `cached` so the shared disposal helpers skip them (and so can never dispose the textures they share); the registry disposes only the material.
 */
type Memo = { materials: THREE.Material | THREE.Material[]; raycast: THREE.Mesh["raycast"]; castShadow: boolean; variant: THREE.Material | THREE.Material[] | null };
type Drawable = THREE.Mesh | THREE.LineSegments;
const noRaycast = () => undefined;
const isDrawable = (object: THREE.Object3D): object is Drawable => Boolean((object as THREE.Mesh).isMesh || (object as THREE.LineSegments).isLineSegments);

export class DimmingRegistry {
  private variants = new Map<THREE.Material, THREE.Material>();
  private memos = new Map<Drawable, Memo>();
  private roots = new Map<THREE.Object3D, boolean>();
  /** Counters for tests and the report: variants created and disposed over the registry's life. */
  created = 0;
  disposed = 0;

  get variantCount() { return this.variants.size; }
  get touchedCount() { return this.memos.size; }
  get rootCount() { return this.roots.size; }

  private variantOf(base: THREE.Material, opacity: number): THREE.Material {
    let variant = this.variants.get(base);
    if (!variant) {
      variant = base.clone();
      variant.onBeforeCompile = base.onBeforeCompile;
      variant.customProgramCacheKey = base.customProgramCacheKey;
      this.variants.set(base, variant);
      this.created += 1;
    } else {
      const planes = variant.clippingPlanes;
      variant.copy(base);                                  // the original may have changed in place (a display mode): follow it, never multiply twice
      if (!base.clippingPlanes?.length && planes?.length) variant.clippingPlanes = planes;      // a section view set on the drawn material (the variant) is kept
    }
    variant.userData = { ...base.userData, cached: true, dimmingBase: base, baseOpacity: base.opacity };
    variant.transparent = true;
    variant.depthWrite = false;
    variant.opacity = base.opacity * opacity;
    return variant;
  }

  /**
   * Brings every dimmed root to the state `presentation` describes and every root that is no longer dimmed back to normal. Idempotent and cheap: call it after every scene sync (a sync that replaced a mesh or a material is
   * adopted as the new original; a mesh that is gone is forgotten without being touched).
   */
  sync(dimmedRoots: readonly THREE.Object3D[], presentation: DimmingPresentation) {
    const wanted = new Set(dimmedRoots);
    for (const root of [...this.roots.keys()]) if (!wanted.has(root)) this.restoreRoot(root);
    const styled = presentation.opacity > 0 && presentation.opacity < 1;
    const pickable = surroundingsParticipate(presentation);
    const seen = new Set<Drawable>();
    for (const root of dimmedRoots) {
      if (!this.roots.has(root)) this.roots.set(root, root.visible);
      root.visible = presentation.opacity > 0 ? (this.roots.get(root) as boolean) : false;
      root.traverse((child) => {
        if (!isDrawable(child)) return;
        seen.add(child);
        let memo = this.memos.get(child);
        if (!memo) {
          memo = { materials: child.material, raycast: child.raycast, castShadow: child.castShadow, variant: null };
          this.memos.set(child, memo);
        } else if (memo.variant !== null ? child.material !== memo.variant : child.material !== memo.materials) {
          memo.materials = child.material;                 // the scene sync replaced the material: that is the new original
          memo.variant = null;
        }
        if (styled) {
          const bases = Array.isArray(memo.materials) ? memo.materials : [memo.materials];
          const made = bases.map((base) => this.variantOf(base, presentation.opacity));
          memo.variant = Array.isArray(memo.materials) ? made : made[0];
          child.material = memo.variant;
          child.castShadow = false;                        // a translucent surrounding must not cast a full shadow onto the members
          child.userData.dimmed = true;                    // the see-through far-half pass skips dimmed objects below 100% (Bill, N1)
        } else {
          child.material = memo.materials;                 // 0% (not drawn) and 100% (exactly the normal look and rendering path)
          memo.variant = null;
          child.castShadow = memo.castShadow;
          delete child.userData.dimmed;
        }
        child.raycast = pickable ? memo.raycast : noRaycast;
      });
    }
    // meshes that left a dimmed root (replaced or removed by a scene sync or a modeling operation) are forgotten, never restored
    for (const [mesh, memo] of [...this.memos]) {
      if (seen.has(mesh)) continue;
      mesh.raycast = memo.raycast;                         // ours to put back whatever became of the mesh
      mesh.castShadow = memo.castShadow;
      delete mesh.userData.dimmed;
      if (memo.variant !== null && mesh.material === memo.variant) mesh.material = memo.materials;   // only if it still carries OUR variant (never an obsolete or replaced material)
      this.memos.delete(mesh);
    }
    this.collect();
  }

  /** The slider inside the styled range: only the variants' opacity changes (no object, geometry or material assignment). */
  setOpacityOnly(opacity: number): number {
    for (const variant of this.variants.values()) variant.opacity = (variant.userData.baseOpacity as number) * opacity;
    return this.variants.size;
  }

  private collect() {
    const inUse = new Set<THREE.Material>();
    for (const memo of this.memos.values()) if (memo.variant) (Array.isArray(memo.variant) ? memo.variant : [memo.variant]).forEach((v) => inUse.add(v));
    for (const [base, variant] of [...this.variants]) {
      if (inUse.has(variant)) continue;
      variant.dispose();                                   // the material only: textures belong to the original
      this.disposed += 1;
      this.variants.delete(base);
    }
  }

  private restoreRoot(root: THREE.Object3D) {
    const visible = this.roots.get(root);
    if (visible !== undefined) root.visible = visible;
    this.roots.delete(root);
    root.traverse((child) => {
      if (!isDrawable(child)) return;
      const memo = this.memos.get(child);
      if (!memo) return;
      child.material = memo.materials;
      child.raycast = memo.raycast;
      child.castShadow = memo.castShadow;
      delete child.userData.dimmed;
      this.memos.delete(child);
    });
    this.collect();
  }

  /** The end of the session (or of the viewport): every temporary rendering change is undone and every variant released. */
  release() {
    for (const root of [...this.roots.keys()]) this.restoreRoot(root);
    this.memos.clear();
    for (const variant of this.variants.values()) { variant.dispose(); this.disposed += 1; }
    this.variants.clear();
  }
}
