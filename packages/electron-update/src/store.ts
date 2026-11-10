import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { sha256, verifyRelease, type SignedRelease } from "./protocol";

type State = {
  active: SignedRelease | null;
  previous: SignedRelease | null;
  pending: SignedRelease | null;
  attempting: boolean;
  // Consecutive launches of the confirmed release that never became ready.
  unfinished: number;
  highest: number;
  rejected: number[];
};
// Quitting or an OS kill can interrupt a launch, so a release that already
// worked is only abandoned after repeated unfinished launches.
const unfinishedLaunchLimit = 3;
const initial = (): State => ({
  active: null,
  previous: null,
  pending: null,
  attempting: false,
  unfinished: 0,
  highest: 0,
  rejected: [],
});

// One atomic state file per immutable native runtime; payloads are never overwritten.
export class UpdateStore {
  readonly state: State;
  constructor(
    readonly directory: string,
    readonly runtime: string,
    readonly publicKey: string,
    // The installer's build sequence; earlier releases carry older app code.
    readonly installed = 0,
    readonly readArchive: (path: string) => Buffer = readFileSync,
    readonly removeArchive: (path: string) => void = unlinkSync,
  ) {
    mkdirSync(directory, { recursive: true });
    try {
      this.state = JSON.parse(
        readFileSync(join(directory, "state.json"), "utf8"),
      ) as State;
      if (
        !Number.isSafeInteger(this.state.highest) ||
        !Number.isSafeInteger(this.state.unfinished) ||
        !Array.isArray(this.state.rejected) ||
        typeof this.state.attempting !== "boolean"
      )
        throw new Error("Invalid OTA state structure");
      for (const release of [
        this.state.active,
        this.state.previous,
        this.state.pending,
      ]) {
        if (release) verifyRelease(release, publicKey, runtime);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = initial();
    }
    const superseded = (release: SignedRelease | null): boolean =>
      release !== null &&
      verifyRelease(release, publicKey, runtime).sequence <= installed;
    if (this.state.pending && superseded(this.state.pending)) {
      this.state.pending = null;
      this.state.attempting = false;
    }
    if (superseded(this.state.previous)) this.state.previous = null;
    if (superseded(this.state.active)) {
      this.state.active = null;
      this.state.attempting = false;
      this.state.unfinished = 0;
    }
  }
  save(): void {
    const path = join(this.directory, "state.json");
    writeFileSync(`${path}.tmp`, JSON.stringify(this.state), {
      mode: 0o600,
      flush: true,
    });
    renameSync(`${path}.tmp`, path);
  }
  path(envelope: SignedRelease): string {
    const release = verifyRelease(envelope, this.publicKey, this.runtime);
    return join(this.directory, `${release.sha256}.asar`);
  }
  verifiedPath(envelope: SignedRelease): string {
    const release = verifyRelease(envelope, this.publicKey, this.runtime);
    const path = this.path(envelope);
    const bytes = this.readArchive(path);
    if (bytes.length !== release.size || sha256(bytes) !== release.sha256) {
      throw new Error(
        `JavaScript update ${release.version} failed its on-disk integrity check.`,
      );
    }
    return path;
  }
  accepts(envelope: SignedRelease): boolean {
    const release = verifyRelease(envelope, this.publicKey, this.runtime);
    return (
      release.sequence > Math.max(this.state.highest, this.installed) &&
      !this.state.rejected.includes(release.sequence)
    );
  }
  stage(envelope: SignedRelease, bytes: Uint8Array): void {
    const release = verifyRelease(envelope, this.publicKey, this.runtime);
    if (!this.accepts(envelope))
      throw new Error(
        "Refusing an older or previously failed JavaScript update.",
      );
    if (bytes.length !== release.size || sha256(bytes) !== release.sha256)
      throw new Error("JavaScript update download checksum mismatch.");
    const path = this.path(envelope);
    writeFileSync(`${path}.tmp`, bytes, { mode: 0o600, flush: true });
    renameSync(`${path}.tmp`, path);
    // Staging does not activate anything on an unrelated quit.
  }
  activate(envelope: SignedRelease): void {
    this.verifiedPath(envelope);
    if (!this.accepts(envelope))
      throw new Error(
        "JavaScript update is no longer eligible for activation.",
      );
    this.state.pending = envelope;
    this.state.highest = verifyRelease(
      envelope,
      this.publicKey,
      this.runtime,
    ).sequence;
    this.save();
  }
  // A release activated in the running app must reach health like a boot.
  attempt(): void {
    this.state.attempting = true;
    this.save();
  }
  rollback(): void {
    if (this.state.pending) {
      this.state.rejected.push(
        verifyRelease(this.state.pending, this.publicKey, this.runtime)
          .sequence,
      );
    } else if (this.state.active) {
      this.state.rejected.push(
        verifyRelease(this.state.active, this.publicKey, this.runtime).sequence,
      );
      this.state.active = this.state.previous;
      this.state.previous = null;
    }
    this.state.pending = null;
    this.state.attempting = false;
    this.state.unfinished = 0;
    this.save();
  }
  boot(): { path: string | null; recovered: boolean; confirmed: boolean } {
    let recovered = false;
    if (this.state.attempting) {
      // A new release gets one launch to become ready.
      if (
        this.state.pending ||
        ++this.state.unfinished >= unfinishedLaunchLimit
      ) {
        this.rollback();
        recovered = true;
      }
    }
    const candidate = this.state.pending ?? this.state.active;
    if (!candidate) return { path: null, recovered, confirmed: false };
    try {
      const path = this.verifiedPath(candidate);
      // Every OTA boot must reach health, including later launches of active releases.
      this.state.attempting = true;
      this.save();
      return { path, recovered, confirmed: candidate === this.state.active };
    } catch (error) {
      this.rollback();
      throw error;
    }
  }
  // The last release that reached health, for CLI processes that run beside
  // the app and must not change its boot state.
  current(): string | null {
    return this.state.active ? this.verifiedPath(this.state.active) : null;
  }
  healthy(): void {
    if (this.state.pending) {
      this.state.previous = this.state.active;
      this.state.active = this.state.pending;
      this.state.pending = null;
    }
    this.state.attempting = false;
    this.state.unfinished = 0;
    this.save();
  }
  collect(): void {
    const retained = new Set(
      [this.state.active, this.state.previous, this.state.pending]
        .filter((release) => release !== null)
        .map((release) => this.path(release)),
    );
    for (const name of readdirSync(this.directory)) {
      const path = join(this.directory, name);
      if (/^[a-f0-9]{64}\.asar(?:\.tmp)?$/.test(name) && !retained.has(path))
        this.removeArchive(path);
    }
  }
}
