import * as THREE from 'three/webgpu';

/** Smooth the sampled arc walls only; cap normals and pronounced corners stay split. */
export function smoothExtrudedWalls<T extends THREE.BufferGeometry>(geometry: T): T {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const wallVertices = new Map<string, { indices: number[]; normals: THREE.Vector3[] }>();
  for (let index = 0; index < positions.count; index++) {
    if (Math.abs(normals.getZ(index)) > 1e-6) continue;
    // Exact uploaded positions avoid welding distinct small features together.
    const key = `${positions.getX(index)},${positions.getY(index)},${positions.getZ(index)}`;
    let vertex = wallVertices.get(key);
    if (!vertex) { vertex = { indices: [], normals: [] }; wallVertices.set(key, vertex); }
    vertex.indices.push(index);
    const normal = new THREE.Vector3().fromBufferAttribute(normals, index);
    if (!vertex.normals.some(existing => existing.distanceToSquared(normal) < 1e-12)) vertex.normals.push(normal);
  }
  const minimumDot = Math.cos(THREE.MathUtils.degToRad(5));
  for (const vertex of wallVertices.values()) for (const index of vertex.indices) {
    const original = new THREE.Vector3().fromBufferAttribute(normals, index);
    const smooth = new THREE.Vector3();
    for (const normal of vertex.normals) if (normal.dot(original) >= minimumDot) smooth.add(normal);
    smooth.normalize(); normals.setXYZ(index, smooth.x, smooth.y, smooth.z);
  }
  normals.needsUpdate = true;
  return geometry;
}

/** A small local HDR studio: broad neutral softboxes, with no network or image assets. */
export function createStudioEnvironment(): THREE.DataTexture {
  const width = 256; const height = 128;
  const data = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const latitude = (y + 0.5) / height;
    const longitude = (x + 0.5) / width;
    const box = (center: number, spread: number, elevation: number) => {
      const dx = Math.min(Math.abs(longitude - center), 1 - Math.abs(longitude - center)) / spread;
      const dy = (latitude - elevation) / 0.13;
      return Math.exp(-Math.pow(dx, 6) - Math.pow(dy, 6));
    };
    const energy = 0.12 + 0.22 * Math.sin(latitude * Math.PI) + box(0.2, 0.12, 0.34) * 3.5
      + box(0.7, 0.045, 0.42) * 2 + box(0.47, 0.16, 0.08) * 1.3;
    const offset = (y * width + x) * 4;
    data[offset] = THREE.DataUtils.toHalfFloat(energy);
    data[offset + 1] = THREE.DataUtils.toHalfFloat(energy);
    data[offset + 2] = THREE.DataUtils.toHalfFloat(energy);
    data[offset + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Put the grid in the support surface itself so grazing angles cannot cause z-fighting. */
export function createSupportGridTexture(width: number, depth: number, step: number): THREE.DataTexture {
  const resolution = 64;
  const data = new Uint8Array(resolution * resolution * 4);
  for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const edge = Math.min(x, y, resolution - 1 - x, resolution - 1 - y);
    const value = edge === 0 ? 116 : edge === 1 ? 86 : 56;
    const offset = (y * resolution + x) * 4;
    data.set([value, value + 5, value + 9, 255], offset);
  }
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / step, depth / step);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
