import { disposeManifold, manifoldFromMeshData } from "@/lib/editorBooleans";
import { getManifoldRuntime } from "@/lib/editorMeshCore";
import { meshDataFromPositions, type KernelCheck } from "@/lib/meshRepair";

/**
 * Build 0124: the kernel's own verdict on a mesh, used as one of the checks a repair must pass: the Boolean kernel takes it as a closed solid. Throws when the kernel cannot
 * be loaded: a repair is then not offered at all, since its purpose is to make meshes the kernel accepts.
 */
export async function createKernelMeshCheck(): Promise<KernelCheck> {
  const runtime = await getManifoldRuntime();
  return async (positions) => {
    let solid;
    try {
      solid = manifoldFromMeshData(runtime, meshDataFromPositions(positions));
      return solid.status() === "NoError" && solid.numTri() > 0;
    } catch {
      return false;
    } finally {
      if (solid) disposeManifold(solid);
    }
  };
}
