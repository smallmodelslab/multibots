import { createHash, verify } from "node:crypto";

export type Release = {
  schema: 2;
  version: string;
  sequence: number;
  // The native contract this bundle runs on.
  runtime: string;
  // Everything in the bundle but the window code; equal hosts mean installing
  // only has to reload the windows.
  host: string;
  commit: string;
  sha256: string;
  size: number;
};
export type SignedRelease = {
  version: string;
  payload: string;
  signature: string;
};
export const maxBundleBytes = 150 * 1024 * 1024;
export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
export const releaseVersion = (sequence: number): string => `1.0.${sequence}`;

const digest = /^[a-f0-9]{64}$/;

export function verifyRelease(
  envelope: SignedRelease,
  publicKey: string,
  runtime: string,
): Release {
  if (
    typeof envelope?.payload !== "string" ||
    envelope.payload.length > 4096 ||
    typeof envelope.signature !== "string" ||
    !verify(
      null,
      Buffer.from(envelope.payload),
      publicKey,
      Buffer.from(envelope.signature, "base64"),
    )
  ) {
    throw new Error("JavaScript update signature is invalid.");
  }
  const release = JSON.parse(envelope.payload) as Release;
  if (
    release.schema !== 2 ||
    !Number.isSafeInteger(release.sequence) ||
    release.sequence < 1 ||
    release.version !== releaseVersion(release.sequence) ||
    envelope.version !== release.version ||
    release.runtime !== runtime ||
    !digest.test(release.runtime) ||
    !digest.test(release.host) ||
    !/^[a-f0-9]{7,40}$|^unknown$/.test(release.commit) ||
    !digest.test(release.sha256) ||
    !Number.isSafeInteger(release.size) ||
    release.size < 1 ||
    release.size > maxBundleBytes
  ) {
    throw new Error(
      "JavaScript update metadata is malformed or incompatible with this native runtime.",
    );
  }
  return release;
}

export const artifactPath = (product: string, release: Release): string =>
  `${product}/javascript/${release.runtime}/releases/${release.version}/${product}-${release.version}.asar`;
// An installer follows its version's channel, as electron-builder names its
// feeds: X.Y.Z reads latest.json and X.Y.Z-nightly.N reads nightly.json.
export const feedPath = (
  product: string,
  runtime: string,
  installer: string,
): string =>
  `${product}/javascript/${runtime}/updates/${/^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(installer)?.[1] ?? "latest"}.json`;
