declare module 'dxf' {
  export function parseString(text: string): unknown;
  export function toPolylines(parsed: unknown): unknown;
}
