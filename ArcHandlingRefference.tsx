import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Wire EDM G‑Code Viewer
 * - Renders centerline toolpath for Siemens-style ISO/DIN programs
 * - Supports G00, G01, G02, G03 (XY plane), modal motion, M-codes ignored
 * - Supports G60 => I/J are ABSOLUTE CENTER COORDINATES for arcs
 * - Assumes absolute X/Y coordinates (G90 semantics)
 * - Units: many Wire EDM posts output integers in 0.001 mm (e.g., X6500 => 6.500 mm)
 *
 * Controls:
 *  - Paste/modify G-code in the textarea (preloaded with user's program)
 *  - Unit factor (default 0.001 mm per unit)
 *  - Toggle "I/J absolute" (auto-detected when a G60 is seen, but user can override)
 *  - Fit view, zoom with wheel, drag to pan
 *
 * Notes:
 *  - Cutter comp (G41/G42) is not applied; path shown is centerline
 *  - Only XY plane (G17). U/V, taper and R arcs are not handled here (sample uses I/J only)
 */

// ---- Types ----

type Pt = { x: number; y: number };

type Move =
  | { kind: "rapid" | "line"; start: Pt; end: Pt }
  | { kind: "arc"; start: Pt; end: Pt; center: Pt; cw: boolean };

// ---- Utilities ----

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

function nearlyEqual(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

function normalizeAngle(a: number) {
  const twoPi = Math.PI * 2;
  a = a % twoPi;
  return a < 0 ? a + twoPi : a;
}

/** Sample an arc into polyline points. */
function sampleArc(
  start: Pt,
  end: Pt,
  center: Pt,
  cw: boolean,
  maxSegAngleDeg = 3 // finer segments => smoother arc
): Pt[] {
  const sx = start.x - center.x;
  const sy = start.y - center.y;
  const ex = end.x - center.x;
  const ey = end.y - center.y;
  const rs = Math.hypot(sx, sy);
  const re = Math.hypot(ex, ey);
  // Guard: radii must match; if not, blend by average
  const r = (rs + re) / 2;

  let a0 = Math.atan2(sy, sx);
  let a1 = Math.atan2(ey, ex);
  a0 = normalizeAngle(a0);
  a1 = normalizeAngle(a1);

  let delta = a1 - a0;
  if (cw) {
    // go negative direction
    if (delta > 0) delta -= Math.PI * 2;
  } else {
    // CCW: go positive direction
    if (delta < 0) delta += Math.PI * 2;
  }

  const steps = Math.max(2, Math.ceil(Math.abs(deg(delta)) / maxSegAngleDeg));
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = a0 + delta * t;
    pts.push({ x: center.x + r * Math.cos(ang), y: center.y + r * Math.sin(ang) });
  }
  return pts;
}

// ---- G-code Parser ----

type ParseOptions = {
  ijAbsoluteDefault?: boolean; // default false; auto toggled to true if G60 appears
  unitFactorMm?: number; // default 0.001 => units are microns (0.001 mm)
};

function parseGCode(gcode: string, opts: ParseOptions) {
  const unitFactor = opts.unitFactorMm ?? 0.001;
  let ijAbsolute = !!opts.ijAbsoluteDefault;

  const lines = gcode
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((ln) => ln.replace(/\(.*?\)/g, "").trim()) // strip (comments)
    .filter((ln) => ln.length > 0 && !/^%/.test(ln));

  let pos: Pt = { x: 0, y: 0 };
  const moves: Move[] = [];
  let lastMotion: "G00" | "G01" | "G02" | "G03" | null = null;

  for (let raw of lines) {
    const ln = raw.replace(/;.*$/, ""); // strip ; comments
    if (!ln) continue;

    // Detect G60 (I/J absolute center mode in this Siemens post)
    if (/\bG60\b/i.test(ln)) ijAbsolute = true;

    // Extract words like Gxx, Mxx, X..., Y..., I..., J...
    const words = [...ln.matchAll(/([A-Za-z])\s*([+\-]?[0-9]*\.?[0-9]*)/g)].map((m) => ({
      letter: m[1].toUpperCase(),
      value: m[2] === "" || m[2] === "." ? NaN : Number(m[2]),
    }));

    // Modal motion code
    for (const w of words) {
      if (w.letter === "G") {
        const g = Math.round(w.value);
        if (g === 0) lastMotion = "G00";
        else if (g === 1) lastMotion = "G01";
        else if (g === 2) lastMotion = "G02";
        else if (g === 3) lastMotion = "G03";
        // ignore other G's (G17, G38 etc.)
      }
    }

    // Pull coordinates present on this line
    const hasX = words.some((w) => w.letter === "X");
    const hasY = words.some((w) => w.letter === "Y");
    const xVal = words.find((w) => w.letter === "X")?.value;
    const yVal = words.find((w) => w.letter === "Y")?.value;

    const hasI = words.some((w) => w.letter === "I");
    const hasJ = words.some((w) => w.letter === "J");
    const iVal = words.find((w) => w.letter === "I")?.value;
    const jVal = words.find((w) => w.letter === "J")?.value;

    // G92 X0 Y0: local origin set at current machine pos => we treat as origin reset
    if (/\bG92\b/.test(ln)) {
      // If G92 has explicit X/Y zero, just keep pos (we're already working in program coordinates)
      // No transform is applied here; this viewer assumes incoming coords are program coords.
    }

    // If there's no X/Y and no I/J and no motion, skip
    if (!hasX && !hasY && !hasI && !hasJ && !/\bG0[0123]\b/.test(ln)) continue;

    // Determine target position (absolute coords assumed)
    const target: Pt = {
      x: hasX && !Number.isNaN(xVal!) ? (xVal as number) * unitFactor : pos.x,
      y: hasY && !Number.isNaN(yVal!) ? (yVal as number) * unitFactor : pos.y,
    };

    // Motion execution based on lastMotion
    if (lastMotion === "G00") {
      moves.push({ kind: "rapid", start: { ...pos }, end: target });
      pos = target;
      continue;
    }

    if (lastMotion === "G01") {
      if (!nearlyEqual(pos.x, target.x) || !nearlyEqual(pos.y, target.y)) {
        moves.push({ kind: "line", start: { ...pos }, end: target });
        pos = target;
      }
      continue;
    }

    if (lastMotion === "G02" || lastMotion === "G03") {
      // Need center I/J. In this post: if ijAbsolute == true => I,J are ABSOLUTE CENTER
      if (!hasI || !hasJ || Number.isNaN(iVal!) || Number.isNaN(jVal!)) {
        // If center missing, skip gracefully
        pos = target; // move anyway to maintain continuity
        continue;
      }
      const center: Pt = ijAbsolute
        ? { x: (iVal as number) * unitFactor, y: (jVal as number) * unitFactor }
        : { x: pos.x + (iVal as number) * unitFactor, y: pos.y + (jVal as number) * unitFactor };

      moves.push({ kind: "arc", start: { ...pos }, end: target, center, cw: lastMotion === "G02" });
      pos = target;
      continue;
    }

    // If we get here with no explicit motion on this line but we had a modal motion previously
    if (lastMotion && (hasX || hasY)) {
      // Reuse last modal motion
      if (lastMotion === "G00") {
        moves.push({ kind: "rapid", start: { ...pos }, end: target });
        pos = target;
      } else if (lastMotion === "G01") {
        moves.push({ kind: "line", start: { ...pos }, end: target });
        pos = target;
      } else if (lastMotion === "G02" || lastMotion === "G03") {
        if (hasI && hasJ && !Number.isNaN(iVal!) && !Number.isNaN(jVal!)) {
          const center: Pt = ijAbsolute
            ? { x: (iVal as number) * unitFactor, y: (jVal as number) * unitFactor }
            : { x: pos.x + (iVal as number) * unitFactor, y: pos.y + (jVal as number) * unitFactor };
          moves.push({ kind: "arc", start: { ...pos }, end: target, center, cw: lastMotion === "G02" });
          pos = target;
        } else {
          pos = target;
        }
      }
    }
  }

  // Compute bounds by sampling all moves
  const pts: Pt[] = [];
  for (const m of moves) {
    if (m.kind === "rapid" || m.kind === "line") {
      pts.push(m.start, m.end);
    } else {
      pts.push(...sampleArc(m.start, m.end, m.center, m.cw));
    }
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 0);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 0);

  return { moves, bounds: { minX, maxX, minY, maxY }, ijAbsolute };
}

// ---- Viewer Component ----

export default function App() {
  const [code, setCode] = useState<string>(() => DEFAULT_GCODE.trim());
  const [unitFactor, setUnitFactor] = useState<number>(0.001); // 1 unit = 0.001 mm
  const [forceIjAbs, setForceIjAbs] = useState<boolean | null>(null);

  const { moves, bounds, ijAbsolute } = useMemo(() => {
    const parsed = parseGCode(code, {
      unitFactorMm: unitFactor,
      ijAbsoluteDefault: false,
    });
    return parsed;
  }, [code, unitFactor]);

  const ijAbsEffective = forceIjAbs ?? ijAbsolute; // allow override

  // If user overrides IJ mode, reparse accordingly
  const parsed = useMemo(() => parseGCode(code, { unitFactorMm: unitFactor, ijAbsoluteDefault: ijAbsEffective }), [code, unitFactor, ijAbsEffective]);

  return (
    <div className="w-full h-full p-4 grid grid-cols-1 lg:grid-cols-3 gap-4 bg-neutral-950 text-neutral-100">
      <div className="col-span-2 flex flex-col gap-3">
        <Toolbar
          unitFactor={unitFactor}
          setUnitFactor={setUnitFactor}
          ijAbsEffective={ijAbsEffective}
          autoDetectedIjAbs={ijAbsolute}
          setForceIjAbs={setForceIjAbs}
          bounds={parsed.bounds}
        />
        <CanvasView moves={parsed.moves} bounds={parsed.bounds} />
      </div>
      <div className="col-span-1 flex flex-col gap-2">
        <div className="text-sm opacity-80">Paste or edit your G‑code. The viewer assumes XY plane and centerline (no cutter comp).</div>
        <textarea
          className="w-full h-full min-h-[400px] grow font-mono text-xs bg-neutral-900 border border-neutral-800 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-sky-500"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
    </div>
  );
}

function Toolbar(props: {
  unitFactor: number;
  setUnitFactor: (n: number) => void;
  ijAbsEffective: boolean;
  autoDetectedIjAbs: boolean;
  setForceIjAbs: (v: boolean | null) => void;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}) {
  const { unitFactor, setUnitFactor, ijAbsEffective, autoDetectedIjAbs, setForceIjAbs, bounds } = props;

  const [uf, setUf] = useState<string>(unitFactor.toString());
  useEffect(() => setUf(unitFactor.toString()), [unitFactor]);

  return (
    <div className="flex flex-wrap items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-xl p-3">
      <span className="text-sm">Unit factor (mm/unit)</span>
      <input
        value={uf}
        onChange={(e) => setUf(e.target.value)}
        onBlur={() => {
          const v = Number(uf);
          if (!Number.isNaN(v) && v > 0) setUnitFactor(v);
          else setUf(unitFactor.toString());
        }}
        className="w-24 px-2 py-1 rounded-md bg-neutral-800 border border-neutral-700 text-sm"
      />
      <div className="h-6 w-px bg-neutral-800" />
      <span className="text-sm">I/J absolute (G60):</span>
      <button
        onClick={() => setForceIjAbs(true)}
        className={`px-3 py-1 rounded-md border text-sm ${ijAbsEffective ? "bg-sky-600 border-sky-500" : "bg-neutral-800 border-neutral-700"}`}
      >
        On
      </button>
      <button
        onClick={() => setForceIjAbs(false)}
        className={`px-3 py-1 rounded-md border text-sm ${!ijAbsEffective ? "bg-sky-600 border-sky-500" : "bg-neutral-800 border-neutral-700"}`}
      >
        Off
      </button>
      <button
        onClick={() => setForceIjAbs(null)}
        className="px-3 py-1 rounded-md border text-sm bg-neutral-800 border-neutral-700"
      >
        Auto
      </button>
      <div className="h-6 w-px bg-neutral-800" />
      <div className="text-sm opacity-80">Bounds (mm): X [{bounds.minX.toFixed(3)} … {bounds.maxX.toFixed(3)}], Y [{bounds.minY.toFixed(3)} … {bounds.maxY.toFixed(3)}]</div>
    </div>
  );
}

function CanvasView(props: { moves: Move[]; bounds: { minX: number; maxX: number; minY: number; maxY: number } }) {
  const { moves, bounds } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });

  // Fit view on bounds change
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const pad = 20;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const bx = bounds.maxX - bounds.minX || 1;
    const by = bounds.maxY - bounds.minY || 1;
    const zx = (w - 2 * pad) / bx;
    const zy = (h - 2 * pad) / by;
    const z = Math.max(0.1, Math.min(zx, zy));
    setZoom(z);
    setPan({ x: pad + -bounds.minX * z, y: h - pad + bounds.minY * z }); // Y-up mapping
  }, [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY]);

  // Interaction: pan (drag), zoom (wheel)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let dragging = false;
    let last: Pt | null = null;

    const onDown = (e: MouseEvent) => {
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging || !last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => {
      dragging = false;
      last = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const worldX = (mx - pan.x) / zoom;
      const worldY = (my - pan.y) / -zoom;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom((z) => z * factor);
      setPan((p) => ({ x: mx - worldX * (zoom * factor), y: my - worldY * (-zoom * factor) }));
    };

    c.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    c.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      c.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      c.removeEventListener("wheel", onWheel as any);
    };
  }, [pan.x, pan.y, zoom]);

  // Draw
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth * dpr;
    const h = c.clientHeight * dpr;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }

    ctx.save();
    ctx.clearRect(0, 0, c.width, c.height);

    // Helper transforms
    const toScreen = (p: Pt): Pt => ({ x: pan.x * dpr + p.x * zoom * dpr, y: pan.y * dpr + -p.y * zoom * dpr });

    // Grid
    drawGrid(ctx, toScreen, zoom * dpr, c.width, c.height);

    // Axes
    drawAxes(ctx, toScreen);

    // Paths
    // Rapids (thin, dashed)
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.25 * dpr;
    ctx.strokeStyle = "#7dd3fc"; // cyan-ish
    for (const m of moves) {
      if (m.kind !== "rapid") continue;
      const a = toScreen(m.start);
      const b = toScreen(m.end);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    // Lines
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 2.0 * dpr;
    ctx.strokeStyle = "#e5e7eb"; // neutral-200
    for (const m of moves) {
      if (m.kind !== "line") continue;
      const a = toScreen(m.start);
      const b = toScreen(m.end);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    // Arcs
    ctx.save();
    ctx.lineWidth = 2.25 * dpr;
    ctx.strokeStyle = "#22c55e"; // green-ish
    for (const m of moves) {
      if (m.kind !== "arc") continue;
      const pts = sampleArc(m.start, m.end, m.center, m.cw, 2);
      ctx.beginPath();
      const p0 = toScreen(pts[0]);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < pts.length; i++) {
        const p = toScreen(pts[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Start marker
    if (moves.length) {
      const s = toScreen(moves[0].start);
      ctx.save();
      ctx.fillStyle = "#f97316"; // orange
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }, [moves, pan.x, pan.y, zoom]);

  return (
    <div className="relative w-full h-[60vh] lg:h-[72vh] rounded-xl border border-neutral-800 overflow-hidden bg-neutral-900">
      <canvas ref={canvasRef} className="w-full h-full cursor-grab active:cursor-grabbing select-none" />
      <div className="absolute bottom-2 left-2 text-xs px-2 py-1 bg-neutral-800/70 rounded-md border border-neutral-700">
        Wheel: Zoom · Drag: Pan
      </div>
    </div>
  );
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  toScreen: (p: Pt) => Pt,
  zoomPxPerMm: number,
  width: number,
  height: number
) {
  ctx.save();
  ctx.lineWidth = 1 * (window.devicePixelRatio || 1);
  ctx.strokeStyle = "#27272a"; // neutral-800

  // Choose grid spacing based on zoom
  const raw = 10; // base 10 mm
  const scales = [0.5, 1, 2, 5, 10, 20, 50, 100];
  let spacing = raw;
  for (const s of scales) {
    if (zoomPxPerMm * s > 30) {
      spacing = s;
      break;
    }
  }

  // Draw verticals/horizontals around origin
  const left = -1000, right = 1000, bottom = -1000, top = 1000; // generous range in mm
  for (let x = Math.floor(left / spacing) * spacing; x <= right; x += spacing) {
    const a = toScreen({ x, y: bottom });
    const b = toScreen({ x, y: top });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let y = Math.floor(bottom / spacing) * spacing; y <= top; y += spacing) {
    const a = toScreen({ x: left, y });
    const b = toScreen({ x: right, y });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawAxes(ctx: CanvasRenderingContext2D, toScreen: (p: Pt) => Pt) {
  ctx.save();
  ctx.lineWidth = 2 * (window.devicePixelRatio || 1);

  // X-axis
  ctx.strokeStyle = "#60a5fa"; // blue
  let a = toScreen({ x: -1000, y: 0 });
  let b = toScreen({ x: 1000, y: 0 });
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // Y-axis
  ctx.strokeStyle = "#f472b6"; // pink
  a = toScreen({ x: 0, y: -1000 });
  b = toScreen({ x: 0, y: 1000 });
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // Origin dot
  const o = toScreen({ x: 0, y: 0 });
  ctx.fillStyle = "#22d3ee"; // cyan
  ctx.beginPath();
  ctx.arc(o.x, o.y, 3 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---- Default program (user-supplied) ----

const DEFAULT_GCODE = `%
N10 (Z22BRT)
N20 G92 X0 Y0
G60
G00X9000 Y0
G38
G41D0
N50 G01 X13000 Y0 
N80 G01 X13640 Y0
N100 G03 X13639 Y191 I0 J0
N110 G02 X13867 Y595 I14099 J198
N120 G01 X14892 Y1191
N130 G03 X14625 Y3052 I0 J0
N140 G01 X13473 Y3336
N150 G02 X13140 Y3659 I13583 J3782
N160 G03 X13032 Y4026 I0 J0
N170 G02 X13138 Y4478 I13472 J4162
N180 G01 X13953 Y5339
N190 G03 X13172 Y7049 I0 J0
N200 G01 X11988 Y6996
N210 G02 X11577 Y7213 I11967 J7456
N220 G03 X11370 Y7534 I0 J0
N230 G02 X11344 Y7998 I11754 J7789
N240 G01 X11884 Y9054
N250 G03 X10653 Y10475 I0 J0
N260 G01 X9531 Y10090
N270 G02 X9076 Y10182 I9382 J10526
N280 G03 X8787 Y10433 I0 J0
N290 G02 X8631 Y10870 I9083 J10784
N300 G01 X8852 Y12035
N310 G03 X7270 Y13052 I0 J0
N320 G01 X6302 Y12367
N330 G02 X5840 Y12327 I6037 J12742
N340 G03 X5492 Y12486 I0 J0
N350 G02 X5219 Y12861 I5677 J12907
N360 G01 X5103 Y14042
N370 G03 X3299 Y14571 I0 J0
N380 G01 X2563 Y13641
N390 G02 X2130 Y13473 I2202 J13927
N400 G03 X1752 Y13527 I0 J0
N410 G02 X1384 Y13811 I1811 J13983
N420 G01 X940 Y14910
N430 G03 X-940 Y14910 I0 J0
N440 G01 X-1384 Y13811
N450 G02 X-1752 Y13527 I-1811 J13983
N460 G03 X-2130 Y13473 I0 J0
N470 G02 X-2563 Y13641 I-2202 J13927
N480 G01 X-3299 Y14571
N490 G03 X-5103 Y14042 I0 J0
N500 G01 X-5219 Y12861
N510 G02 X-5492 Y12486 I-5677 J12907
N520 G03 X-5840 Y12327 I0 J0
N530 G02 X-6302 Y12367 I-6037 J12742
N540 G01 X-7270 Y13052
N550 G03 X-8852 Y12035 I0 J0
N560 G01 X-8631 Y10870
N570 G02 X-8787 Y10433 I-9083 J10784
N580 G03 X-9076 Y10182 I0 J0
N590 G02 X-9531 Y10090 I-9382 J10526
N600 G01 X-10653 Y10475
N610 G03 X-11884 Y9054 I0 J0
N620 G01 X-11344 Y7998
N630 G02 X-11370 Y7534 I-11754 J7789
N640 G03 X-11577 Y7213 I0 J0
N650 G02 X-11988 Y6996 I-11967 J7456
N660 G01 X-13172 Y7049
N670 G03 X-13953 Y5339 I0 J0
N680 G01 X-13138 Y4478
N690 G02 X-13032 Y4026 I-13472 J4162
N700 G03 X-13140 Y3659 I0 J0
N710 G02 X-13473 Y3336 I-13583 J3782
N720 G01 X-14625 Y3052
N730 G03 X-14892 Y1191 I0 J0
N740 G01 X-13867 Y595
N750 G02 X-13639 Y191 I-14099 J198
N760 G03 X-13639 Y-191 I0 J0
N770 G02 X-13867 Y-595 I-14099 J-198
N780 G01 X-14892 Y-1191
N790 G03 X-14625 Y-3052 I0 J0
N800 G01 X-13473 Y-3336
N810 G02 X-13140 Y-3659 I-13583 J-3782
N820 G03 X-13032 Y-4026 I0 J0
N830 G02 X-13138 Y-4478 I-13472 J-4162
N840 G01 X-13953 Y-5339
N850 G03 X-13172 Y-7049 I0 J0
N860 G01 X-11988 Y-6996
N870 G02 X-11577 Y-7213 I-11967 J-7456
N880 G03 X-11370 Y-7534 I0 J0
N890 G02 X-11344 Y-7998 I-11754 J-7789
N900 G01 X-11884 Y-9054
N910 G03 X-10653 Y-10475 I0 J0
N920 G01 X-9531 Y-10090
N930 G02 X-9076 Y-10182 I-9382 J-10526
N940 G03 X-8787 Y-10433 I0 J0
N950 G02 X-8631 Y-10870 I-9083 J-10784
N960 G01 X-8852 Y-12035
N970 G03 X-7270 Y-13052 I0 J0
N980 G01 X-6302 Y-12367
N990 G02 X-5840 Y-12327 I-6037 J-12742
N1000 G03 X-5492 Y-12486 I0 J0
N1010 G02 X-5219 Y-12861 I-5677 J-12907
N1020 G01 X-5103 Y-14042
N1030 G03 X-3299 Y-14571 I0 J0
N1040 G01 X-2563 Y-13641
N1050 G02 X-2130 Y-13473 I-2202 J-13927
N1060 G03 X-1752 Y-13527 I0 J0
N1070 G02 X-1384 Y-13811 I-1811 J-13983
N1080 G01 X-940 Y-14910
N1090 G03 X940 Y-14910 I0 J0
N1100 G01 X1384 Y-13811
N1110 G02 X1752 Y-13527 I1811 J-13983
N1120 G03 X2130 Y-13473 I0 J0
N1130 G02 X2563 Y-13641 I2202 J-13927
N1140 G01 X3299 Y-14571
N1150 G03 X5103 Y-14042 I0 J0
N1160 G01 X5219 Y-12861
N1170 G02 X5492 Y-12486 I5677 J-12907
N1180 G03 X5840 Y-12327 I0 J0
N1190 G02 X6302 Y-12367 I6037 J-12742
N1200 G01 X7270 Y-13052
N1210 G03 X8852 Y-12035 I0 J0
N1220 G01 X8631 Y-10870
N1230 G02 X8787 Y-10433 I9083 J-10784
N1240 G03 X9076 Y-10182 I0 J0
N1250 G02 X9531 Y-10090 I9382 J-10526
N1260 G01 X10653 Y-10475
N1270 G03 X11884 Y-9054 I0 J0
N1280 G01 X11344 Y-7998
N1290 G02 X11370 Y-7534 I11754 J-7789
N1300 G03 X11577 Y-7213 I0 J0
N1310 G02 X11988 Y-6996 I11967 J-7456
N1320 G01 X13172 Y-7049
N1330 G03 X13953 Y-5339 I0 J0
N1340 G01 X13138 Y-4478
N1350 G02 X13032 Y-4026 I13472 J-4162
N1360 G03 X13140 Y-3659 I0 J0
N1370 G02 X13473 Y-3336 I13583 J-3782
N1380 G01 X14625 Y-3052
N1390 G03 X14892 Y-1191 I0 J0
N1400 G01 X13867 Y-595
N1410 G02 X13639 Y-191 I14099 J-198
N1420 G03 X13640 Y0 I0 J0
M01
N1430 X13040 Y600 I13040 J0
N1440 G00 X0 Y600
N1450 G40
N1460 G00 X0 Y0
N1490 M02
%`;
