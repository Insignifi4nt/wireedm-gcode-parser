import { Type, type Static } from '@sinclair/typebox';

export const POST_IDENTIFIER_PATTERN = '^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$';
export const POST_SEMVER_PATTERN = '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$';

export const PostIdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: POST_IDENTIFIER_PATTERN
});

export const PostVersionSchema = Type.String({
  minLength: 5,
  maxLength: 80,
  pattern: POST_SEMVER_PATTERN
});

export const Sha256Schema = Type.String({ pattern: '^[a-f0-9]{64}$' });

export const PostInstallationRefSchema = Type.Object({
  packageId: PostIdentifierSchema,
  version: PostVersionSchema,
  contentHash: Sha256Schema
}, { additionalProperties: false });

export type PostInstallationRef = Readonly<Static<typeof PostInstallationRefSchema>>;
