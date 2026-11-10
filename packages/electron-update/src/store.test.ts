import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UpdateStore } from "./store";
import { sha256, verifyRelease, type SignedRelease } from "./protocol";

type Fixture = {
  open: () => UpdateStore;
  release: (
    sequence: number,
    bytes?: Uint8Array,
  ) => { envelope: SignedRelease; bytes: Uint8Array };
  runtime: string;
  publicKey: string;
};

function fixture(t: { after: (fn: () => void) => void }): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "electron-update-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const runtime = "a".repeat(64);
  const open = (): UpdateStore =>
    new UpdateStore(directory, runtime, publicKey);
  const release = (
    sequence: number,
    bytes: Uint8Array = Buffer.from(`JS build ${sequence}`),
  ): { envelope: SignedRelease; bytes: Uint8Array } => {
    const version = `1.0.${sequence}`;
    const payload = JSON.stringify({
      schema: 2,
      sequence,
      version,
      runtime,
      host: "c".repeat(64),
      commit: "abcdef0",
      size: bytes.length,
      sha256: sha256(bytes),
    });
    const envelope = {
      version,
      payload,
      signature: sign(null, Buffer.from(payload), keys.privateKey).toString(
        "base64",
      ),
    };
    return { envelope, bytes };
  };
  return { open, release, runtime, publicKey };
}

test("download, defer, explicit activation, healthy restart, then failed upgrade rolls back across processes", (t) => {
  const { open, release } = fixture(t);
  const first = release(10);
  open().stage(first.envelope, first.bytes);
  assert.equal(
    open().boot().path,
    null,
    "staging must not install on an unrelated quit",
  );
  open().activate(first.envelope);
  assert.ok(open().boot().path);
  open().healthy();
  assert.equal(open().state.active?.version, "1.0.10");
  const broken = release(11);
  open().stage(broken.envelope, broken.bytes);
  open().activate(broken.envelope);
  assert.ok(open().boot().path);
  // Process dies before the renderer connects; the next process recovers.
  const recovered = open();
  assert.equal(recovered.boot().recovered, true);
  assert.equal(recovered.state.active?.version, "1.0.10");
  assert.equal(recovered.accepts(broken.envelope), false);
  recovered.healthy();
  assert.equal(
    open().accepts(first.envelope),
    false,
    "replayed older feed must stay rejected",
  );
});

test("tampered downloads, on-disk mutation, wrong signer and incompatible runtime never execute", (t) => {
  const { open, release, runtime, publicKey } = fixture(t);
  const good = release(12);
  assert.throws(
    () => open().stage(good.envelope, Buffer.from("tampered")),
    /checksum/,
  );
  assert.throws(
    () =>
      verifyRelease(
        {
          ...good.envelope,
          payload: good.envelope.payload.replace(
            '"sequence":12',
            '"sequence":13',
          ),
        },
        publicKey,
        runtime,
      ),
    /signature/,
  );
  const other = generateKeyPairSync("ed25519")
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
  assert.throws(
    () => verifyRelease(good.envelope, other, runtime),
    /signature/,
  );
  assert.throws(
    () => verifyRelease(good.envelope, publicKey, "b".repeat(64)),
    /incompatible/,
  );
  open().stage(good.envelope, good.bytes);
  open().activate(good.envelope);
  writeFileSync(open().path(good.envelope), "tampered after install");
  assert.throws(() => open().boot(), /integrity/);
  assert.equal(open().boot().path, null);
});

test("an interrupted launch keeps a confirmed release; repeated unfinished launches recover its predecessor", (t) => {
  const { open, release } = fixture(t);
  for (const sequence of [1, 2]) {
    const next = release(sequence);
    open().stage(next.envelope, next.bytes);
    open().activate(next.envelope);
    open().boot();
    open().healthy();
  }
  open().boot(); // the user quits before the window is ready
  const resumed = open().boot();
  assert.equal(resumed.recovered, false);
  assert.equal(resumed.confirmed, true);
  assert.equal(open().state.active?.version, "1.0.2");
  open().boot(); // a third unfinished launch in a row
  const recovered = open();
  assert.equal(recovered.boot().recovered, true);
  assert.equal(recovered.state.active?.version, "1.0.1");
  assert.equal(recovered.state.highest, 2);
  assert.throws(() => open().activate(release(2).envelope), /eligible/);
});

test("a newer installer ignores JavaScript releases built before it", (t) => {
  const { open, release, runtime, publicKey } = fixture(t);
  for (const sequence of [5, 6]) {
    const next = release(sequence);
    open().stage(next.envelope, next.bytes);
    open().activate(next.envelope);
    open().boot();
    open().healthy();
  }
  const installed = (): UpdateStore =>
    new UpdateStore(open().directory, runtime, publicKey, 6);
  assert.equal(installed().boot().path, null);
  assert.equal(installed().accepts(release(6).envelope), false);
  assert.equal(installed().accepts(release(7).envelope), true);
});

test("malformed signed metadata is rejected", (t) => {
  const { publicKey, runtime } = fixture(t);
  for (const input of [null, {}, { payload: "{}", signature: "" }]) {
    assert.throws(() =>
      verifyRelease(input as SignedRelease, publicKey, runtime),
    );
  }
});
