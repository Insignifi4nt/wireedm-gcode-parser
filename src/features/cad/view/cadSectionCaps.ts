import * as THREE from 'three';

/** The flat colour a section cap fills cut material with. */
export const CAD_SECTION_CAP_COLOR = 0xc98a5e;

/**
 * Stencil caps close the solids a section view cuts open. They are display only: nothing picks or exports them, and the exact section
 * of a body stays with the kernel.
 *
 * Each body is drawn twice more into the stencil buffer, clipped like the body, with no colour or depth: its back faces add one and its
 * front faces take one away. Where the cut plane lies inside a closed body the count ends away from zero, and one flat quad on the plane
 * paints exactly those pixels, behind any kept material in front of it. The extra draws reuse the bodies' own geometry, so a cap adds GPU
 * work only, never buffers.
 */
export interface CadSectionCaps {
  readonly group: THREE.Group;
  /** The bodies to cap. Called with every upload of the model's meshes. */
  setBodies(bodies: readonly THREE.Mesh[]): void;
  /** The plane the bodies are clipped by, and the model bounds the cap must cover; with no plane the caps draw nothing. */
  setPlane(plane: THREE.Plane | null, bounds: THREE.Box3): void;
  dispose(): void;
}

export function createCadSectionCaps(): CadSectionCaps {
  const group = new THREE.Group();
  group.name = 'cad-section-caps';
  group.visible = false;
  const plane = new THREE.Plane(), planes = [plane];
  const counting = (side: THREE.Side, operation: THREE.StencilOp) => new THREE.MeshBasicMaterial({
    side, colorWrite: false, depthWrite: false, depthTest: false, clippingPlanes: planes,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: operation, stencilZFail: operation, stencilZPass: operation });
  const back = counting(THREE.BackSide, THREE.IncrementWrapStencilOp), front = counting(THREE.FrontSide, THREE.DecrementWrapStencilOp);
  // The cap resets the count wherever it draws or loses to nearer material, so the next frame starts clean.
  const capMaterial = new THREE.MeshBasicMaterial({ color: CAD_SECTION_CAP_COLOR, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp });
  const capGeometry = new THREE.PlaneGeometry(1, 1);
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.name = 'cad-section-cap';
  // After the solids, so kept material in front of the plane hides the cap; after the counting draws, so the count is complete.
  cap.renderOrder = 3;
  cap.onAfterRender = renderer => renderer.clearStencil();
  group.add(cap);
  const counters = new THREE.Group();
  group.add(counters);
  const unit = new THREE.Vector3(0, 0, 1), center = new THREE.Vector3(), size = new THREE.Vector3();
  return {
    group,
    setBodies(bodies) {
      counters.clear();
      for (const body of bodies) for (const material of [back, front]) {
        const counter = new THREE.Mesh(body.geometry, material);
        counter.position.copy(body.position);
        counter.renderOrder = 2;
        counter.matrixAutoUpdate = false; counter.updateMatrix();
        counters.add(counter);
      }
    },
    setPlane(next, bounds) {
      group.visible = Boolean(next) && !bounds.isEmpty() && counters.children.length > 0;
      if (!next || bounds.isEmpty()) return;
      plane.copy(next);
      bounds.getCenter(center); bounds.getSize(size);
      plane.projectPoint(center, cap.position);
      cap.quaternion.setFromUnitVectors(unit, plane.normal);
      cap.scale.setScalar(Math.max(1, size.length() * 2));
      cap.updateMatrix();
    },
    dispose() { counters.clear(); capGeometry.dispose(); capMaterial.dispose(); back.dispose(); front.dispose(); group.clear(); },
  };
}
