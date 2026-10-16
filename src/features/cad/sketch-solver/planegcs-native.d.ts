// 1.3.0 omits dist/planegcs_dist/planegcs.d.ts. Its source declaration exists,
// so resolve its existing source ModuleStatic rather than accepting an untyped import.
declare module '@salusoft89/planegcs/dist/planegcs_dist/planegcs.js' {
  import type { ModuleStatic } from '@salusoft89/planegcs/planegcs_dist/planegcs';
  export default function initialize(config: {
    locateFile: (fileName: string, prefix: string) => string;
  }): Promise<ModuleStatic>;
}
