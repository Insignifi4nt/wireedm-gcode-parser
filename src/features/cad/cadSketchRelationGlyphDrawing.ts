/** A path segment in absolute coordinates; H, V, S and T are written out as L, C and Q, so a drawing moves by adding an offset. */
type Segment = readonly ['M' | 'L', number, number] | readonly ['C', number, number, number, number, number, number] | readonly ['Q', number, number, number, number]
  | readonly ['A', number, number, number, 0 | 1, 0 | 1, number, number] | readonly ['Z'];

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

/** SVG path data as absolute segments. Throws on data the SVG path grammar rejects. */
export function absolutePathSegments(data: string): readonly Segment[] {
  const segments: Segment[] = [];
  let at = 0, command = '', x = 0, y = 0, startX = 0, startY = 0;
  // The last curve's second control point, which a smooth curve reflects.
  let cubic: readonly [number, number] | null = null, quadratic: readonly [number, number] | null = null;
  const skip = () => { while (at < data.length && /[\s,]/.test(data[at])) at++; };
  const number = () => {
    skip(); NUMBER.lastIndex = at; const found = NUMBER.exec(data);
    if (!found) throw new Error(`Path data expects a number at ${at}: ${data}`);
    at = NUMBER.lastIndex; return Number(found[0]);
  };
  const flag = (): 0 | 1 => {
    skip(); const value = data[at++];
    if (value !== '0' && value !== '1') throw new Error(`Path data expects an arc flag at ${at - 1}: ${data}`);
    return value === '1' ? 1 : 0;
  };
  for (skip(); at < data.length; skip()) {
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(data[at])) command = data[at++];
    else if (!command || command === 'Z' || command === 'z') throw new Error(`Path data expects a command at ${at}: ${data}`);
    const relative = command === command.toLowerCase(), dx = relative ? x : 0, dy = relative ? y : 0;
    let nextCubic: readonly [number, number] | null = null, nextQuadratic: readonly [number, number] | null = null;
    switch (command.toUpperCase()) {
      case 'Z': segments.push(['Z']); x = startX; y = startY; break;
      case 'M': x = number() + dx; y = number() + dy; startX = x; startY = y; segments.push(['M', x, y]); command = relative ? 'l' : 'L'; break;
      case 'L': x = number() + dx; y = number() + dy; segments.push(['L', x, y]); break;
      case 'H': x = number() + dx; segments.push(['L', x, y]); break;
      case 'V': y = number() + dy; segments.push(['L', x, y]); break;
      case 'C': case 'S': {
        const control: readonly [number, number] = command.toUpperCase() === 'C' ? [number() + dx, number() + dy] : cubic ? [2 * x - cubic[0], 2 * y - cubic[1]] : [x, y], [x1, y1] = control;
        const x2 = number() + dx, y2 = number() + dy; x = number() + dx; y = number() + dy;
        segments.push(['C', x1, y1, x2, y2, x, y]); nextCubic = [x2, y2]; break;
      }
      case 'Q': case 'T': {
        const control: readonly [number, number] = command.toUpperCase() === 'Q' ? [number() + dx, number() + dy] : quadratic ? [2 * x - quadratic[0], 2 * y - quadratic[1]] : [x, y], [x1, y1] = control;
        x = number() + dx; y = number() + dy; segments.push(['Q', x1, y1, x, y]); nextQuadratic = control; break;
      }
      case 'A': {
        const rx = number(), ry = number(), rotation = number(), large = flag(), sweep = flag();
        x = number() + dx; y = number() + dy; segments.push(['A', rx, ry, rotation, large, sweep, x, y]); break;
      }
    }
    cubic = nextCubic; quadratic = nextQuadratic;
  }
  return segments;
}

const format = (value: number) => String(Math.round(value * 100) / 100 + 0);

/**
 * Places a drawing at any point: given path data on a `grid`-unit square, returns path data for that drawing `size` units wide and
 * centred on (x, y), to the hundredth. Many copies then draw as one path instead of an element each.
 */
export function placedPathData(paths: readonly string[], grid: number, size: number): (x: number, y: number) => string {
  const scale = size / grid, half = size / 2, segments = paths.flatMap(absolutePathSegments);
  return (x, y) => {
    const left = x - half, top = y - half, px = (value: number) => format(left + value * scale), py = (value: number) => format(top + value * scale);
    let data = '';
    for (const segment of segments) switch (segment[0]) {
      case 'Z': data += 'Z'; break;
      case 'M': case 'L': data += `${segment[0]}${px(segment[1])} ${py(segment[2])}`; break;
      case 'C': data += `C${px(segment[1])} ${py(segment[2])} ${px(segment[3])} ${py(segment[4])} ${px(segment[5])} ${py(segment[6])}`; break;
      case 'Q': data += `Q${px(segment[1])} ${py(segment[2])} ${px(segment[3])} ${py(segment[4])}`; break;
      case 'A': data += `A${format(segment[1] * scale)} ${format(segment[2] * scale)} ${segment[3]} ${segment[4]} ${segment[5]} ${px(segment[6])} ${py(segment[7])}`; break;
    }
    return data;
  };
}
