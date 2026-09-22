import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createStudioEnvironment, createSupportGridTexture, smoothExtrudedWalls } from '../simulationSurfaceAppearance';

describe('simulation surface appearance', () => {
  it('smooths sampled circular walls while preserving cap normals, square corners and exact geometry', () => {
    const shape = new THREE.Shape([new THREE.Vector2(-10, -10), new THREE.Vector2(-10, 10),
      new THREE.Vector2(10, 10), new THREE.Vector2(10, -10)]);
    const circle = Array.from({ length: 180 }, (_, index) => new THREE.Vector2(
      Math.cos(index * Math.PI / 90) * 5, Math.sin(index * Math.PI / 90) * 5));
    shape.holes.push(new THREE.Path(circle));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 10, bevelEnabled: false });
    const originalPositions = geometry.getAttribute('position').array.slice();
    smoothExtrudedWalls(geometry);
    const position = geometry.getAttribute('position'); const normal = geometry.getAttribute('normal');
    const circleNormals: THREE.Vector3[] = []; const cornerNormals: THREE.Vector3[] = [];
    let capVertices = 0;
    for (let index = 0; index < position.count; index++) {
      const point = new THREE.Vector3().fromBufferAttribute(position, index);
      const direction = new THREE.Vector3().fromBufferAttribute(normal, index);
      if (Math.abs(direction.z) > 0.99) {
        capVertices++; expect(Math.abs(direction.z)).toBe(1); expect(Math.abs(direction.x)).toBe(0); expect(Math.abs(direction.y)).toBe(0);
      } else if (point.x === 5 && point.y === 0) circleNormals.push(direction);
      else if (point.x === 10 && point.y === 10) cornerNormals.push(direction);
    }
    expect(capVertices).toBeGreaterThan(0);
    expect(circleNormals.length).toBeGreaterThanOrEqual(4);
    for (const normal of circleNormals) expect(normal.distanceTo(new THREE.Vector3(-1, 0, 0))).toBeLessThan(1e-5);
    expect(new Set(cornerNormals.map(normal => `${normal.x},${normal.y},${normal.z}`))).toEqual(new Set(['1,0,0', '0,1,0']));
    expect(geometry.getAttribute('position').array).toEqual(originalPositions);
    geometry.dispose();
  });

  it('creates bounded local lighting and a mipmapped grid without image downloads', () => {
    const environment = createStudioEnvironment();
    expect(environment.image.width * environment.image.height).toBeLessThanOrEqual(256 * 128);
    expect(environment.mapping).toBe(THREE.EquirectangularReflectionMapping);
    const data = environment.image.data as Uint16Array;
    const energy = Array.from({ length: data.length / 4 }, (_, index) => THREE.DataUtils.fromHalfFloat(data[index * 4]));
    expect(Math.max(...energy)).toBeGreaterThan(3);
    expect(Math.min(...energy)).toBeGreaterThan(0);
    const grid = createSupportGridTexture(80, 60, 5);
    expect(grid.repeat.toArray()).toEqual([16, 12]);
    expect(grid.generateMipmaps).toBe(true);
    expect(grid.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    environment.dispose(); grid.dispose();
  });
});
