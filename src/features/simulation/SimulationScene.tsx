import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AdaptiveDpr, Edges, Grid, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type {
  MachineSimulationSettings,
  ProjectSimulationSettings,
} from '@/domain/simulation/simulationConfig';
import {
  sampleSimulationCursor,
  type SimulationTimeline,
  type SimulationTimelineMove,
} from '@/domain/simulation/simulationTimeline';
import type { Point2 } from '@/domain/path-intel/types';

import type { SimulationCameraPreset } from './SimulationTransport';

const PATH_HEIGHT_OFFSET_MM = 0.08;
const STOCK_EDGE_COLOR = '#8da2ae';
const PLANNED_CUT_COLOR = '#4d8298';
const RAPID_COLOR = '#d59c48';
const COMPLETED_COLOR = '#52e0c4';
const ACTIVE_COLOR = '#fff2a6';

export interface SimulationSceneProps {
  timeline: SimulationTimeline;
  projectSettings: ProjectSimulationSettings;
  machineSettings: MachineSimulationSettings;
  progress: number;
  cameraPreset: SimulationCameraPreset;
  showGrid: boolean;
  showTank: boolean;
  fitRequest?: number;
}

interface SceneBounds {
  center: THREE.Vector3;
  span: number;
}

interface BuiltPathGeometry {
  geometry: THREE.BufferGeometry;
  segmentEndDistances: number[];
}

export function SimulationScene({
  timeline,
  projectSettings,
  machineSettings,
  progress,
  cameraPreset,
  showGrid,
  showTank,
  fitRequest = 0,
}: SimulationSceneProps) {
  return (
    <div
      className="relative size-full min-h-72 overflow-hidden bg-[#071014]"
      data-simulation-scene
    >
      <Canvas
        aria-label="Interactive 3D wire EDM simulation"
        camera={{ near: 0.1, far: 100000, position: [100, 100, 100], zoom: 1 }}
        dpr={[1, 1.75]}
        flat
        frameloop="demand"
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        orthographic
        shadows="basic"
      >
        <color attach="background" args={['#071014']} />
        <fog attach="fog" args={['#071014', 300, 2200]} />
        <AdaptiveDpr pixelated />
        <SimulationWorld
          cameraPreset={cameraPreset}
          fitRequest={fitRequest ?? 0}
          machineSettings={machineSettings}
          progress={progress}
          projectSettings={projectSettings}
          showGrid={showGrid}
          showTank={showTank}
          timeline={timeline}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 border border-white/10 bg-[#09161be6] px-2.5 py-2 text-[9px] uppercase tracking-[0.08em] text-slate-400 shadow-xl backdrop-blur-sm">
        <div className="mb-1.5 text-[10px] font-semibold tracking-[0.12em] text-slate-200">
          Posted wire path
        </div>
        <LegendSwatch color={COMPLETED_COLOR} label="Completed" />
        <LegendSwatch color={ACTIVE_COLOR} label="Active move" />
        <LegendSwatch color={PLANNED_CUT_COLOR} label="Planned cut" />
        <LegendSwatch color={RAPID_COLOR} label="Rapid" />
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 border border-white/10 bg-[#09161bcc] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-slate-500 backdrop-blur-sm">
        Visual playback · not machining time
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="h-px w-5" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}

function SimulationWorld({
  timeline,
  projectSettings,
  machineSettings,
  progress,
  cameraPreset,
  showGrid,
  showTank,
  fitRequest,
}: Omit<SimulationSceneProps, 'fitRequest'> & { fitRequest: number }) {
  const stock = projectSettings.stock;
  const cursor = sampleSimulationCursor(timeline, progress);
  const pathZ = stock.topZMm + PATH_HEIGHT_OFFSET_MM;
  const bounds = useMemo(
    () => sceneBounds(projectSettings, machineSettings),
    [projectSettings, machineSettings],
  );

  return (
    <>
      <CameraRig bounds={bounds} fitRequest={fitRequest} preset={cameraPreset} />

      <ambientLight intensity={0.65} />
      <hemisphereLight args={['#b9e8f5', '#102229', 1.2]} />
      <directionalLight
        castShadow
        intensity={2.4}
        position={[
          bounds.center.x + bounds.span,
          bounds.center.y + bounds.span * 1.5,
          bounds.center.z + bounds.span * 0.7,
        ]}
        shadow-mapSize-height={1024}
        shadow-mapSize-width={1024}
      />
      <directionalLight
        color="#5f9ec2"
        intensity={0.55}
        position={[
          bounds.center.x - bounds.span,
          bounds.center.y + bounds.span * 0.4,
          bounds.center.z - bounds.span,
        ]}
      />

      <StockPlate settings={projectSettings} />
      <MachineContext
        machine={machineSettings}
        project={projectSettings}
        showGrid={showGrid}
        showTank={showTank}
      />
      <TimelinePaths
        cursorDistanceMm={cursor.distanceMm}
        moveIndex={cursor.moveIndex}
        moveProgress={cursor.moveProgress}
        pathZ={pathZ}
        timeline={timeline}
      />
      <WireAssembly
        machine={machineSettings}
        point={cursor.point ?? timeline.moves[0]?.start ?? stockCenter(stock)}
      />
    </>
  );
}

function CameraRig({
  bounds,
  preset,
  fitRequest,
}: {
  bounds: SceneBounds;
  preset: SimulationCameraPreset;
  fitRequest: number;
}) {
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);
  const { camera, size, invalidate } = useThree();

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;

    const distance = Math.max(20, bounds.span * 1.8);
    const direction = cameraDirection(preset);
    camera.position.copy(bounds.center).addScaledVector(direction, distance);
    camera.up.set(0, 1, 0);
    if (preset === 'top') camera.up.set(0, 0, -1);
    camera.lookAt(bounds.center);
    camera.zoom = Math.max(
      0.01,
      Math.min(size.width, size.height) / Math.max(1, bounds.span * 1.35),
    );
    camera.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.target.copy(bounds.center);
      controlsRef.current.update();
    }
    invalidate();
  }, [bounds, camera, fitRequest, invalidate, preset, size.height, size.width]);

  return (
    <OrbitControls
      ref={controlsRef}
      dampingFactor={0.08}
      enableDamping
      makeDefault
      maxDistance={bounds.span * 8}
      minDistance={Math.max(2, bounds.span * 0.05)}
      regress
      screenSpacePanning
    />
  );
}

function StockPlate({ settings }: { settings: ProjectSimulationSettings }) {
  const { stock } = settings;
  const centerX = stock.originX + stock.widthMm / 2;
  const centerY = stock.originY + stock.lengthMm / 2;
  const centerZ = stock.topZMm - stock.thicknessMm / 2;

  return (
    <group>
      <mesh
        castShadow
        position={[centerX, centerZ, -centerY]}
        receiveShadow
      >
        <boxGeometry args={[stock.widthMm, stock.thicknessMm, stock.lengthMm]} />
        <meshStandardMaterial
          color="#74858c"
          metalness={0.72}
          roughness={0.3}
        />
        <Edges color={STOCK_EDGE_COLOR} threshold={15} />
      </mesh>
      <mesh
        position={[centerX, stock.topZMm + 0.015, -centerY]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[stock.widthMm * 0.995, stock.lengthMm * 0.995]} />
        <meshStandardMaterial
          color="#aebbc0"
          metalness={0.82}
          roughness={0.22}
          transparent
          opacity={0.42}
        />
      </mesh>
    </group>
  );
}

function MachineContext({
  machine,
  project,
  showGrid,
  showTank,
}: {
  machine: MachineSimulationSettings;
  project: ProjectSimulationSettings;
  showGrid: boolean;
  showTank: boolean;
}) {
  const { stock } = project;
  const clearance = machine.fixtureClearanceMm;
  const tankWidth = stock.widthMm + clearance * 2;
  const tankLength = stock.lengthMm + clearance * 2;
  const centerX = stock.originX + stock.widthMm / 2;
  const centerY = stock.originY + stock.lengthMm / 2;
  const tankFloorZ = stock.topZMm - machine.tankDepthMm;
  const tankCenterZ = (stock.topZMm + tankFloorZ) / 2;
  const bedRailWidth = Math.max(3, Math.min(10, clearance * 0.45));

  return (
    <group>
      {showGrid && (
        <Grid
          args={[tankWidth * 1.4, tankLength * 1.4]}
          cellColor="#18323b"
          cellSize={5}
          cellThickness={0.45}
          fadeDistance={Math.max(tankWidth, tankLength) * 1.7}
          fadeStrength={1.2}
          followCamera={false}
          infiniteGrid={false}
          position={[centerX, tankFloorZ - 0.08, -centerY]}
          sectionColor="#315d6a"
          sectionSize={25}
          sectionThickness={0.7}
        />
      )}

      {showTank && (
        <group>
          <mesh position={[centerX, tankCenterZ, -centerY]} receiveShadow>
            <boxGeometry args={[tankWidth, machine.tankDepthMm, tankLength]} />
            <meshPhysicalMaterial
              color="#0b485d"
              depthWrite={false}
              metalness={0.05}
              opacity={0.1}
              roughness={0.25}
              side={THREE.BackSide}
              transparent
            />
            <Edges color="#22586a" threshold={15} />
          </mesh>
          <mesh position={[centerX, tankFloorZ - 1.1, -centerY]} receiveShadow>
            <boxGeometry args={[tankWidth + 4, 2, tankLength + 4]} />
            <meshStandardMaterial color="#17262c" metalness={0.6} roughness={0.55} />
          </mesh>
          {[stock.originX - clearance * 0.45, stock.originX + stock.widthMm + clearance * 0.45].map(
            (railX) => (
              <mesh
                key={railX}
                castShadow
                position={[railX, tankFloorZ + 2.2, -centerY]}
                receiveShadow
              >
                <boxGeometry args={[bedRailWidth, 4, tankLength * 0.82]} />
                <meshStandardMaterial color="#293a40" metalness={0.75} roughness={0.42} />
                <Edges color="#43565d" />
              </mesh>
            ),
          )}
        </group>
      )}
    </group>
  );
}

function TimelinePaths({
  timeline,
  pathZ,
  cursorDistanceMm,
  moveIndex,
  moveProgress,
}: {
  timeline: SimulationTimeline;
  pathZ: number;
  cursorDistanceMm: number;
  moveIndex: number | null;
  moveProgress: number;
}) {
  const cutGeometry = useMemo(
    () => buildSegmentGeometry(timeline.moves.filter((move) => move.kind === 'cut'), pathZ),
    [pathZ, timeline.moves],
  );
  const rapidGeometry = useMemo(
    () => buildSegmentGeometry(timeline.moves.filter((move) => move.kind === 'rapid'), pathZ),
    [pathZ, timeline.moves],
  );
  const completed = useMemo(
    () => buildCompletedGeometry(timeline.moves, pathZ + 0.035),
    [pathZ, timeline.moves],
  );
  const activeGeometry = useMemo(() => {
    const maxVertices = Math.max(
      2,
      ...timeline.moves.map((move) => Math.max(1, sampledPoints(move).length - 1) * 2),
    );
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(new Float32Array(maxVertices * 3), 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    geometry.setDrawRange(0, 0);
    return geometry;
  }, [timeline.moves]);

  useEffect(
    () => () => {
      cutGeometry.dispose();
      rapidGeometry.dispose();
      completed.geometry.dispose();
      activeGeometry.dispose();
    }, [activeGeometry, completed, cutGeometry, rapidGeometry],
  );

  useLayoutEffect(() => {
    const completedSegments = upperBound(completed.segmentEndDistances, cursorDistanceMm);
    completed.geometry.setDrawRange(0, completedSegments * 2);
  }, [completed, cursorDistanceMm]);

  useLayoutEffect(() => {
    updateActiveGeometry(
      activeGeometry,
      moveIndex === null ? null : timeline.moves[moveIndex] ?? null,
      moveProgress,
      pathZ + 0.07,
    );
  }, [activeGeometry, moveIndex, moveProgress, pathZ, timeline.moves]);

  return (
    <group>
      <lineSegments geometry={cutGeometry}>
        <lineBasicMaterial color={PLANNED_CUT_COLOR} opacity={0.72} transparent />
      </lineSegments>
      <lineSegments geometry={rapidGeometry}>
        <lineDashedMaterial
          color={RAPID_COLOR}
          dashSize={1.8}
          gapSize={1.15}
          opacity={0.58}
          transparent
        />
      </lineSegments>
      <lineSegments geometry={completed.geometry}>
        <lineBasicMaterial color={COMPLETED_COLOR} toneMapped={false} />
      </lineSegments>
      <lineSegments geometry={activeGeometry}>
        <lineBasicMaterial color={ACTIVE_COLOR} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

function WireAssembly({
  machine,
  point,
}: {
  machine: MachineSimulationSettings;
  point: Point2;
}) {
  const movingGroup = useRef<THREE.Group>(null);
  const wireLength = Math.max(0.01, machine.upperGuideZMm - machine.lowerGuideZMm);
  const wireCenter = (machine.upperGuideZMm + machine.lowerGuideZMm) / 2;
  const guideRadius = Math.max(1.8, machine.defaultWireDiameterMm * 5);

  useLayoutEffect(() => {
    movingGroup.current?.position.set(point.x, 0, -point.y);
  }, [point.x, point.y]);

  return (
    <group ref={movingGroup}>
      <mesh position={[0, wireCenter, 0]}>
        <cylinderGeometry
          args={[machine.defaultWireDiameterMm / 2, machine.defaultWireDiameterMm / 2, wireLength, 8]}
        />
        <meshBasicMaterial color="#f5fbff" toneMapped={false} />
      </mesh>
      {[machine.lowerGuideZMm, machine.upperGuideZMm].map((guideZ, index) => (
        <group key={guideZ} position={[0, guideZ, 0]}>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[guideRadius, guideRadius * 0.82, guideRadius * 2.2, 24]} />
            <meshStandardMaterial
              color={index === 0 ? '#607078' : '#8799a1'}
              metalness={0.82}
              roughness={0.22}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[Math.max(0.45, guideRadius * 0.26), 16, 10]} />
            <meshBasicMaterial color="#d9fbff" toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, machine.upperGuideZMm + guideRadius * 1.7, 0]}>
        <sphereGeometry args={[Math.max(0.7, guideRadius * 0.42), 20, 12]} />
        <meshBasicMaterial color="#8de7f3" opacity={0.55} toneMapped={false} transparent />
      </mesh>
    </group>
  );
}

function buildSegmentGeometry(moves: SimulationTimelineMove[], z: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const move of moves) {
    const points = sampledPoints(move);
    for (let index = 1; index < points.length; index += 1) {
      pushWorldPoint(positions, points[index - 1], z);
      pushWorldPoint(positions, points[index], z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  new THREE.LineSegments(geometry).computeLineDistances();
  return geometry;
}

function buildCompletedGeometry(moves: SimulationTimelineMove[], z: number): BuiltPathGeometry {
  const positions: number[] = [];
  const segmentEndDistances: number[] = [];

  for (const move of moves) {
    const points = sampledPoints(move);
    const chordLengths = points.slice(1).map((point, index) => pointDistance(points[index], point));
    const sampledLength = chordLengths.reduce((sum, length) => sum + length, 0);
    let traversed = 0;

    for (let index = 1; index < points.length; index += 1) {
      pushWorldPoint(positions, points[index - 1], z);
      pushWorldPoint(positions, points[index], z);
      traversed += chordLengths[index - 1];
      const fraction = sampledLength > 0 ? traversed / sampledLength : 1;
      segmentEndDistances.push(move.startDistanceMm + move.lengthMm * fraction);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  geometry.computeBoundingSphere();
  return { geometry, segmentEndDistances };
}

function updateActiveGeometry(
  geometry: THREE.BufferGeometry,
  move: SimulationTimelineMove | null,
  moveProgress: number,
  z: number,
) {
  const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
  if (!move || move.lengthMm <= 0) {
    geometry.setDrawRange(0, 0);
    return;
  }

  const points = sampledPoints(move);
  const target = Math.min(1, Math.max(0, moveProgress));
  const chordLengths = points.slice(1).map((point, index) => pointDistance(points[index], point));
  const total = chordLengths.reduce((sum, length) => sum + length, 0);
  const targetLength = total * target;
  let traversed = 0;
  let written = 0;

  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = chordLengths[index - 1];
    if (traversed + segmentLength <= targetLength) {
      writeWorldPoint(attribute, written++, points[index - 1], z);
      writeWorldPoint(attribute, written++, points[index], z);
      traversed += segmentLength;
      continue;
    }

    const local = segmentLength > 0 ? (targetLength - traversed) / segmentLength : 0;
    writeWorldPoint(attribute, written++, points[index - 1], z);
    writeWorldPoint(attribute, written++, interpolatePoint(points[index - 1], points[index], local), z);
    break;
  }

  geometry.setDrawRange(0, Math.max(0, written));
  attribute.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function sampledPoints(move: SimulationTimelineMove): Point2[] {
  if (move.points.length >= 2) return move.points;
  if (pointDistance(move.start, move.end) > 0) return [move.start, move.end];
  return [move.start];
}

function pushWorldPoint(target: number[], point: Point2, z: number) {
  target.push(point.x, z, -point.y);
}

function writeWorldPoint(
  attribute: THREE.BufferAttribute,
  index: number,
  point: Point2,
  z: number,
) {
  attribute.setXYZ(index, point.x, z, -point.y);
}

function interpolatePoint(start: Point2, end: Point2, progress: number): Point2 {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
}

function pointDistance(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function upperBound(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function sceneBounds(
  project: ProjectSimulationSettings,
  machine: MachineSimulationSettings,
): SceneBounds {
  const { stock } = project;
  const centerX = stock.originX + stock.widthMm / 2;
  const centerY = stock.originY + stock.lengthMm / 2;
  const minZ = Math.min(
    stock.topZMm - stock.thicknessMm,
    stock.topZMm - machine.tankDepthMm,
    machine.lowerGuideZMm,
  );
  const maxZ = Math.max(stock.topZMm, machine.upperGuideZMm);
  const span = Math.max(
    stock.widthMm + machine.fixtureClearanceMm * 2,
    stock.lengthMm + machine.fixtureClearanceMm * 2,
    maxZ - minZ,
    10,
  );
  return {
    center: new THREE.Vector3(centerX, (minZ + maxZ) / 2, -centerY),
    span,
  };
}

function stockCenter(stock: ProjectSimulationSettings['stock']): Point2 {
  return {
    x: stock.originX + stock.widthMm / 2,
    y: stock.originY + stock.lengthMm / 2,
  };
}

function cameraDirection(preset: SimulationCameraPreset): THREE.Vector3 {
  if (preset === 'top') return new THREE.Vector3(0, 1, 0);
  if (preset === 'front') return new THREE.Vector3(0, 0, 1);
  if (preset === 'right') return new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3(1, 0.78, 1).normalize();
}
