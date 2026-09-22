declare module 'occt-import-js' {
  export interface OcctImportModule {
    ReadStepFile(content: Uint8Array, parameters: {
      linearUnit: 'millimeter';
      linearDeflectionType: 'absolute_value';
      linearDeflection: number;
      angularDeflection: number;
    }): unknown;
  }
  export default function initializeOcct(options?: {
    locateFile?: (file: string) => string;
    wasmBinary?: Uint8Array;
    print?: (message: string) => void;
    printErr?: (message: string) => void;
  }): Promise<OcctImportModule>;
}
