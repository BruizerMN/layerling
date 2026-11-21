import * as THREE from "three";

/**
 * The viewport's background image (Build 0020). It is the scene's own background: three.js draws a texture background as a screen-aligned quad behind everything
 * with no geometry, so it stays put while the camera orbits, pans and zooms, takes no part in picking or selection, and is not part of any model or export. The
 * texture is shown "cover" fashion - scaled uniformly to fill the viewport, the overflow cropped, never stretched - by setting its UV transform from the two
 * aspect ratios; `fitBackground` runs again whenever the viewport's size changes. A damaged or unreadable image leaves the standard background.
 */
export interface BackgroundState {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  needsRender: boolean;
  /** The plain colour of the current theme (set by rebuildWorkplane); what the scene shows without an image. */
  plainBackground?: THREE.Color | null;
  backgroundImage?: { url: string; texture: THREE.Texture; aspect: number } | null;
  backgroundLoading?: string | null;
}

/** Shows `texture` filling a viewport of the given aspect ratio without distortion. */
export function coverTransform(imageAspect: number, viewAspect: number): { repeat: [number, number]; offset: [number, number] } {
  if (!(imageAspect > 0) || !(viewAspect > 0)) return { repeat: [1, 1], offset: [0, 0] };
  if (viewAspect > imageAspect) {
    const height = imageAspect / viewAspect;
    return { repeat: [1, height], offset: [0, (1 - height) / 2] };
  }
  const width = viewAspect / imageAspect;
  return { repeat: [width, 1], offset: [(1 - width) / 2, 0] };
}

export function fitBackground(state: BackgroundState) {
  const image = state.backgroundImage;
  if (!image) return;
  const canvas = state.renderer.domElement;
  const fit = coverTransform(image.aspect, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  image.texture.repeat.set(fit.repeat[0], fit.repeat[1]);
  image.texture.offset.set(fit.offset[0], fit.offset[1]);
  state.needsRender = true;
}

function disposeImage(state: BackgroundState) {
  state.backgroundImage?.texture.dispose();
  state.backgroundImage = null;
}

/** What the scene shows behind the model now: the image if there is one, else the theme's plain colour. */
export function applyBackground(state: BackgroundState) {
  state.scene.background = state.backgroundImage?.texture ?? state.plainBackground ?? state.scene.background;
  state.needsRender = true;
}

/** Shows the image at `url`, or the plain background for null. Loads it (once per change); a failure keeps the standard background. */
export function setBackgroundImage(state: BackgroundState, url: string | null) {
  if ((state.backgroundImage?.url ?? null) === url && !state.backgroundLoading) return;
  if (state.backgroundLoading === url && url !== null) return;
  if (url === null) {
    state.backgroundLoading = null;
    disposeImage(state);
    applyBackground(state);
    return;
  }
  state.backgroundLoading = url;
  new THREE.TextureLoader().load(
    url,
    (texture) => {
      if (state.backgroundLoading !== url) { texture.dispose(); return; }   // another image was asked for meanwhile
      state.backgroundLoading = null;
      const source = texture.image as { width?: number; height?: number } | undefined;
      const width = source?.width ?? 0, height = source?.height ?? 0;
      if (!(width > 0 && height > 0)) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      disposeImage(state);
      state.backgroundImage = { url, texture, aspect: width / height };
      fitBackground(state);
      applyBackground(state);
    },
    undefined,
    () => {
      if (state.backgroundLoading === url) state.backgroundLoading = null;
      disposeImage(state);
      applyBackground(state);   // the standard background stays
    },
  );
}
