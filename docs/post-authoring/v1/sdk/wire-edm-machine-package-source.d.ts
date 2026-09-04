/* Generated from the authoritative Wire EDM JSON Schema. Do not edit by hand. */

export interface WireEdmMachinePackageSourceDocument {
  format: "wire-edm-machine-package-source";
  schemaVersion: 1;
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
  };
  machineFile: string;
  /**
   * @minItems 1
   * @maxItems 64
   */
  postFiles: [string, ...string[]];
  activeBindingId: string;
}
