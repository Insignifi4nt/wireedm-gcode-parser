/* Generated from the authoritative Wire EDM JSON Schema. Do not edit by hand. */

export interface WireEdmMachinePackageDocument {
  format: "wire-edm-machine-package";
  schemaVersion: 1;
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
  };
  machine: HttpsWireEdmLocalSchemasWireEdmMachineV1Json;
  /**
   * @minItems 1
   * @maxItems 64
   */
  posts: [HttpsWireEdmLocalSchemasWireEdmPostPackageV2Json, ...HttpsWireEdmLocalSchemasWireEdmPostPackageV2Json[]];
  activeBindingId: string;
}
export interface HttpsWireEdmLocalSchemasWireEdmMachineV1Json {
  format: "wire-edm-machine";
  schemaVersion: 1;
  id: string;
  name: string;
  identity: {
    manufacturer: string;
    model: string;
    serialNumber?: string;
    controller: {
      manufacturer: string;
      model: string;
      firmware?: string;
    };
  };
  limits: {
    xTravel:
      | {
          status: "unknown";
        }
      | {
          status: "known";
          millimeters: number;
        };
    yTravel:
      | {
          status: "unknown";
        }
      | {
          status: "known";
          millimeters: number;
        };
  };
  hardware: {
    manualThreading: boolean;
    automaticThreading: boolean;
  };
  /**
   * @maxItems 128
   */
  evidence: {
    id: string;
    name: string;
    uri: string;
    contentSha256: string;
  }[];
  /**
   * @maxItems 256
   */
  bindings: {
    id: string;
    name: string;
    post: {
      packageId: string;
      version: string;
      contentHash: string;
    };
    properties: {
      /**
       * This interface was referenced by `undefined`'s JSON-Schema definition
       * via the `patternProperty` "^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$".
       */
      [k: string]: boolean | number | string;
    };
    compatibility: {
      status: "acknowledged";
      acknowledgedAt: string;
      acknowledgedBy: string;
      notes: string;
    };
    verification:
      | {
          status: "unverified";
        }
      | {
          status: "claimed";
          verifiedAt: string;
          verifiedBy: string;
          machineDefinitionHash: string;
          postContentHash: string;
          propertiesHash: string;
          /**
           * @minItems 1
           * @maxItems 64
           */
          evidenceRefs: [string, ...string[]];
          notes: string;
        };
  }[];
  activeBindingId: string | null;
  notes: string;
}
export interface HttpsWireEdmLocalSchemasWireEdmPostPackageV2Json {
  format: "wire-edm-post";
  schemaVersion: 1 | 2;
  manifest: {
    id: string;
    name: string;
    version: string;
    engineApiVersion: "1";
    authoredFor?: {
      appVersion: string;
      documentationUrl: string;
    };
    description: string;
    /**
     * @minItems 1
     * @maxItems 64
     */
    targets: [
      {
        manufacturer: string;
        controllerManufacturer: string;
        controller: string;
        firmware:
          | {
              status: "unknown";
            }
          | {
              status: "known";
              /**
               * @minItems 1
               * @maxItems 64
               */
              versions: [string, ...string[]];
            };
        /**
         * @maxItems 64
         */
        machineModels: string[];
      },
      ...{
        manufacturer: string;
        controllerManufacturer: string;
        controller: string;
        firmware:
          | {
              status: "unknown";
            }
          | {
              status: "known";
              /**
               * @minItems 1
               * @maxItems 64
               */
              versions: [string, ...string[]];
            };
        /**
         * @maxItems 64
         */
        machineModels: string[];
      }[]
    ];
    capabilities: {
      circularInterpolation: "none" | "clockwise-only" | "counterclockwise-only" | "both";
      controllerCompensation: "none" | "left-right";
      operations: "single" | "multiple";
      passes: "single" | "multiple";
      threading: "none" | "manual" | "automatic" | "manual-and-automatic";
      wireSeparation:
        boolean | ("manual-before-positioning" | "automatic-before-positioning" | "automatic-during-positioning")[];
      programStops: boolean;
      taperAxes: boolean;
      technologySelection: boolean;
      initialWirePosition: boolean;
    };
    execution: {
      initialWirePosition: "required";
      compensationLifecycle:
        | "none"
        | "authored-linear"
        | "controller-native-program"
        | "controller-native-operation"
        | "controller-native-continuous";
      compensationRequiredForEveryOperation: boolean;
    };
    output: {
      fileExtension: string;
      lineEnding: "lf" | "crlf";
      encoding: "ascii" | "utf-8";
      finalNewline: boolean;
      blockNumbering:
        | {
            mode: "none";
          }
        | {
            mode: "sequential";
            prefix: string;
            start: number;
            increment: number;
            minimumWidth: number;
          };
      programEnvelope: {
        /**
         * @maxItems 4
         */
        prefix: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
        /**
         * @maxItems 4
         */
        suffix: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
      };
    };
    properties: {
      /**
       * This interface was referenced by `undefined`'s JSON-Schema definition
       * via the `patternProperty` "^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$".
       */
      [k: string]:
        | {
            type: "boolean";
            description: string;
            required: boolean;
            suggestedValue?: boolean;
          }
        | {
            type: "integer";
            description: string;
            required: boolean;
            minimum?: number;
            maximum?: number;
            suggestedValue?: number;
          }
        | {
            type: "number";
            description: string;
            required: boolean;
            minimum?: number;
            maximum?: number;
            suggestedValue?: number;
          }
        | {
            type: "string";
            description: string;
            required: boolean;
            minLength?: number;
            maxLength?: number;
            suggestedValue?: string;
          }
        | {
            type: "choice";
            description: string;
            required: boolean;
            /**
             * @minItems 1
             * @maxItems 64
             */
            choices: [string, ...string[]];
            suggestedValue?: string;
          };
    };
  };
  dialect: {
    id: string;
    description: string;
    commands: {
      /**
       * This interface was referenced by `undefined`'s JSON-Schema definition
       * via the `patternProperty` "^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$".
       */
      [k: string]: {
        template: string;
        arcDirection?: "clockwise" | "counterclockwise";
        parameters: {
          /**
           * This interface was referenced by `undefined`'s JSON-Schema definition
           * via the `patternProperty` "^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$".
           */
          [k: string]:
            | {
                type: "integer";
                role: "none";
                description: string;
                minimum?: number;
                maximum?: number;
              }
            | {
                type: "number";
                role: "none";
                description: string;
                format: {
                  style: "fixed";
                  fractionDigits:
                    | {
                        kind: "fixed";
                        value: number;
                      }
                    | {
                        kind: "property";
                        property: string;
                      };
                  decimalSeparator: "." | ",";
                  trimTrailingZeros: boolean;
                  negativeZero: "zero" | "preserve";
                };
                minimum?: number;
                maximum?: number;
              }
            | {
                type: "number";
                role: "motion.end-x" | "motion.end-y";
                description: string;
                format: {
                  style: "fixed";
                  fractionDigits:
                    | {
                        kind: "fixed";
                        value: number;
                      }
                    | {
                        kind: "property";
                        property: string;
                      };
                  decimalSeparator: "." | ",";
                  trimTrailingZeros: boolean;
                  negativeZero: "zero" | "preserve";
                };
                minimum?: number;
                maximum?: number;
              }
            | {
                type: "number";
                role: "motion.center-x" | "motion.center-y";
                centerReference:
                  | {
                      kind: "fixed";
                      mode: "absolute" | "incremental";
                    }
                  | {
                      kind: "property";
                      property: string;
                    };
                description: string;
                format: {
                  style: "fixed";
                  fractionDigits:
                    | {
                        kind: "fixed";
                        value: number;
                      }
                    | {
                        kind: "property";
                        property: string;
                      };
                  decimalSeparator: "." | ",";
                  trimTrailingZeros: boolean;
                  negativeZero: "zero" | "preserve";
                };
                minimum?: number;
                maximum?: number;
              }
            | {
                type: "string";
                role: "none";
                description: string;
              };
        };
        /**
         * @minItems 1
         * @maxItems 32
         */
        effects: [string, ...string[]];
        /**
         * @maxItems 32
         */
        requires: string[];
        /**
         * @minItems 1
         * @maxItems 32
         */
        evidenceRefs: [string, ...string[]];
      };
    };
  };
  source: {
    language: "javascript";
    entrypoint: "createPost";
    code: string;
  };
  /**
   * @minItems 1
   * @maxItems 128
   */
  sources: [
    (
      | {
          id: string;
          name: string;
          uri: string;
          mediaType: string;
          contentSha256: string;
          kind: "manufacturer-manual" | "controller-reference";
          documentNumber: string;
          revision: string;
        }
      | {
          id: string;
          name: string;
          uri: string;
          mediaType: string;
          contentSha256: string;
          kind: "verified-program" | "operator-test";
          recordedAt: string;
          description: string;
        }
    ),
    ...(
      | {
          id: string;
          name: string;
          uri: string;
          mediaType: string;
          contentSha256: string;
          kind: "manufacturer-manual" | "controller-reference";
          documentNumber: string;
          revision: string;
        }
      | {
          id: string;
          name: string;
          uri: string;
          mediaType: string;
          contentSha256: string;
          kind: "verified-program" | "operator-test";
          recordedAt: string;
          description: string;
        }
    )[]
  ];
  /**
   * @minItems 1
   * @maxItems 256
   */
  evidence: [
    {
      id: string;
      sourceRef: string;
      selector: {
        location: string;
        page?: number;
        section?: string;
        exact?: string;
        prefix?: string;
        suffix?: string;
      };
      claim: string;
      /**
       * @minItems 1
       * @maxItems 64
       */
      supports: [
        {
          kind: "command";
          id: string;
        },
        ...{
          kind: "command";
          id: string;
        }[]
      ];
      appliesTo: {
        /**
         * @minItems 1
         * @maxItems 64
         */
        controllerManufacturers: [string, ...string[]];
        /**
         * @minItems 1
         * @maxItems 64
         */
        controllerModels: [string, ...string[]];
        /**
         * @maxItems 64
         */
        machineModels: string[];
        firmware?: string;
      };
      review:
        | {
            status: "unreviewed";
          }
        | {
            status: "reviewed";
            reviewer: string;
            reviewedAt: string;
          };
    },
    ...{
      id: string;
      sourceRef: string;
      selector: {
        location: string;
        page?: number;
        section?: string;
        exact?: string;
        prefix?: string;
        suffix?: string;
      };
      claim: string;
      /**
       * @minItems 1
       * @maxItems 64
       */
      supports: [
        {
          kind: "command";
          id: string;
        },
        ...{
          kind: "command";
          id: string;
        }[]
      ];
      appliesTo: {
        /**
         * @minItems 1
         * @maxItems 64
         */
        controllerManufacturers: [string, ...string[]];
        /**
         * @minItems 1
         * @maxItems 64
         */
        controllerModels: [string, ...string[]];
        /**
         * @maxItems 64
         */
        machineModels: string[];
        firmware?: string;
      };
      review:
        | {
            status: "unreviewed";
          }
        | {
            status: "reviewed";
            reviewer: string;
            reviewedAt: string;
          };
    }[]
  ];
  /**
   * @minItems 1
   * @maxItems 128
   */
  fixtures: [
    {
      id: string;
      description: string;
      planFixture: string;
      properties: {
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$".
         */
        [k: string]: boolean | number | string;
      };
      expectedProgram: string;
      expectedArtifact: string;
      /**
       * @minItems 1
       * @maxItems 32
       */
      evidenceRefs: [string, ...string[]];
    },
    ...{
      id: string;
      description: string;
      planFixture: string;
      properties: {
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$".
         */
        [k: string]: boolean | number | string;
      };
      expectedProgram: string;
      expectedArtifact: string;
      /**
       * @minItems 1
       * @maxItems 32
       */
      evidenceRefs: [string, ...string[]];
    }[]
  ];
}
