import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { appearanceOf, defaultAccessories } from "./appearance";
import { cycleMs, motions, samplePose } from "./motion";
import { renderAvatar } from "./artwork";
import { encodeAvatarGif } from "./gif";
import { createAvatarController } from "./controller";
import { Bots } from "../../main/bots";
import { Replica } from "../../main/replica";

describe("squircle engine", () => {
  test("all motions loop without a pose jump, including looking and blinking", () => {
    for (const motion of motions) {
      assert.deepEqual(samplePose(0, motion), samplePose(cycleMs, motion));
      const poses = Array.from({ length: 120 }, (_, i) =>
        samplePose(i * 50, motion),
      );
      assert.ok(poses.some((pose) => pose.openness < 0.1));
      for (const pose of poses) {
        assert.ok(Math.abs(pose.gaze.x) <= 1);
        assert.ok(Math.abs(pose.gaze.y) <= 1);
        assert.ok(Number.isFinite(pose.tilt));
      }
    }
    assert.ok(samplePose(1500).gaze.x < 0);
    assert.ok(samplePose(3300).gaze.x > 0);
  });
  test("identity stays deterministic while colors and outfits vary", () => {
    assert.deepEqual(defaultAccessories("one"), defaultAccessories("one"));
    const identities = Array.from({ length: 20 }, (_, i) =>
      appearanceOf({ id: `bot-${i}`, hue: i * 15 }),
    );
    assert.ok(
      new Set(identities.map((each) => `${each.hat}/${each.glasses}`)).size > 8,
    );
    const rasters = identities.map((appearance) =>
      new Resvg(renderAvatar(appearance, samplePose(0)), {
        font: { loadSystemFonts: false },
      })
        .render()
        .asPng(),
    );
    assert.equal(
      new Set(rasters.map((bytes) => Buffer.from(bytes).toString("base64")))
        .size,
      20,
    );
  });
  test("controller rejects invalid gaze without corrupting its previous state", () => {
    const controller = createAvatarController({
      hue: 145,
      hat: "beanie",
      glasses: "round",
    });
    controller.lookAt(-0.7, 0.4);
    const before = controller.getState();
    assert.throws(() => controller.lookAt(NaN, 0), /gaze/);
    assert.equal(controller.getState(), before);
    assert.throws(
      () =>
        controller.setState({
          appearance: { hue: NaN, hat: "none", glasses: "none" },
        }),
      /hue/,
    );
    assert.equal(controller.getState(), before);
    assert.throws(
      () =>
        createAvatarController({ hue: Infinity, hat: "none", glasses: "none" }),
      /hue/,
    );
    const still = controller.pose(0, true);
    assert.deepEqual(still, controller.pose(5000, true));
    controller.releaseGaze();
    assert.equal(controller.getState().gaze, null);
  });
  test("encodes actual RGBA frames into a GIF and rejects invalid export requests", async () => {
    const appearance = { hue: 215, hat: "cap", glasses: "square" } as const;
    let frames = 0;
    const bytes = await encodeAvatarGif(
      appearance,
      async (svg, size) => {
        frames++;
        return new Resvg(svg, {
          fitTo: { mode: "width", value: size },
          font: { loadSystemFonts: false },
        }).render().pixels;
      },
      { size: 32, fps: 2 },
    );
    assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), "GIF89a");
    assert.equal(frames, 12);
    assert.equal(bytes[bytes.length - 1], 0x3b);
    assert.equal(bytes[6]! + (bytes[7]! << 8), 32);
    await assert.rejects(
      encodeAvatarGif(appearance, async () => new Uint8Array(), { size: 16 }),
      /GIF size/,
    );
    await assert.rejects(
      encodeAvatarGif(appearance, async () => new Uint8Array(), { size: 32 }),
      /RGBA bytes/,
    );
  });
});

test("a bot's chosen color and accessories survive saving and restarting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openbots-avatar-test-"));
  const make = async () => {
    const replica = new Replica({
      dir,
      fetch: async () => null,
      hostId: "test-host",
      manifest: async () => ({}),
      merge: () => null,
      onApplied: async () => {},
      onBehind: () => {},
      send: async () => {},
      servers: () => [],
    });
    await replica.load();
    const made = new Bots({
      dir,
      hostId: "test-host",
      hostName: "Test host",
      browser: {} as never,
      chatgpt: {} as never,
      computer: {} as never,
      own: {} as never,
      plugins: {} as never,
      replica,
      servers: () => [{ id: "test-host", running: 0 }],
      webhooks: { listen: () => {} } as never,
      ask: async () => null,
      onChange: () => {},
      onError: () => {},
      analytics: { capture: () => {}, captureError: () => {} },
      onRunning: () => {},
      renderBoard: async () => "",
    });
    await made.load();
    return made;
  };
  let bots = await make();
  try {
    const created = await bots.handle({
      type: "bot.create",
      name: "Test bot",
      hue: 215,
      instructions: "",
    });
    if (!created || typeof created !== "object" || !("id" in created))
      throw new Error("Expected bot.create to return a bot.");
    await bots.handle({
      type: "bot.update",
      botId: created.id,
      hue: 330,
      accessories: { hat: "party", glasses: "round" },
    });
    await assert.rejects(
      bots.handle({ type: "bot.update", botId: created.id, hue: NaN }),
      /Bot hue/,
    );
    bots.close();
    bots = await make();
    const detail = await bots.handle({ type: "bot.get", botId: created.id });
    if (!detail || typeof detail !== "object" || !("bot" in detail))
      throw new Error("Expected bot.get to return bot details.");
    assert.equal(detail.bot.hue, 330);
    assert.deepEqual(detail.bot.accessories, {
      hat: "party",
      glasses: "round",
    });
  } finally {
    bots.close();
    await rm(dir, { recursive: true, force: true });
  }
});
