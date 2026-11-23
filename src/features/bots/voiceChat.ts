import { useSyncExternalStore } from "react";

import {
  createHearing,
  loudness,
  speakingLevel,
  toHearingRate,
  wav,
} from "../../shared/hearing";
import type { Bot, Host } from "../../shared/types";
import { bridge, call, messageOf } from "../data";
import { toastError } from "../shell/Toasts";

// A voice chat with a bot, from this window, one at a time. On ChatGPT it
// is the microphone and speakers on a WebRTC call to OpenAI, which the
// bot's computer places with its ChatGPT sign-in and listens in on to hand
// what the user says to the bot. On the user's own models this window hears
// the user itself, sending each thing they say once they pause, and plays
// what the bot says.
export type VoiceChat = {
  botId: string;
  // The call, once its host has placed it.
  callId: string | null;
  // Connected, rather than still connecting.
  live: boolean;
  muted: boolean;
  // The voice is speaking.
  speaking: boolean;
};

let chat: VoiceChat | null = null;
let current: {
  end: () => void;
  // It ended at the host: what was heard of the bot plays out first.
  ended: () => void;
  mute: (muted: boolean) => void;
  // Its host has shown the call as the bot's.
  seen: boolean;
} | null = null;
const listeners = new Set<() => void>();

const set = (next: VoiceChat | null) => {
  chat = next;
  for (const listener of listeners) listener();
};

export const useVoiceChat = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => chat,
  );

export const endVoiceChat = () => current?.end();

// A window going away, or reloading, hangs up.
window.addEventListener("pagehide", endVoiceChat);

// The host ends a call it can no longer hand on, such as when its socket to
// the call closes, or the bot or its computer goes: the window hangs up once
// the bot it saw in the call is no longer in it.
export const followVoiceChat = (bots: Bot[] | null) => {
  if (!chat?.callId || !current) return;
  const bot = bots?.find((each) => each.id === chat?.botId);
  if (bot?.call === chat.callId) current.seen = true;
  else if (current.seen) current.ended();
};

export const muteVoiceChat = (muted: boolean) => current?.mute(muted);

// Placing the call on ChatGPT: the microphone goes to OpenAI over WebRTC,
// and its voice comes back the same way. An answer without one is the call
// the bot's computer placed on the user's models instead.
const chatgptCall = async ({ microphone, onEnd, place, update }: Placing) => {
  const peer = new RTCPeerConnection();
  const speaker = new Audio();
  const context = new AudioContext();
  let meter = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(meter);
    peer.close();
    void context.close();
    speaker.srcObject = null;
  };
  onEnd(stop);
  peer.ontrack = ({ streams: [stream] }) => {
    if (!stream) return;
    speaker.srcObject = stream;
    void speaker.play();
    const analyser = context.createAnalyser();
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let speaking = false;
    meter = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const level = loudness(samples);
      if (level > speakingLevel !== speaking) {
        speaking = level > speakingLevel;
        update({ speaking });
      }
    }, 100);
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") update({ live: true });
    else if (peer.connectionState === "failed") {
      toastError("The voice chat dropped.");
      endVoiceChat();
    }
  };
  for (const track of microphone.getAudioTracks())
    peer.addTrack(track, microphone);
  await peer.setLocalDescription(await peer.createOffer());
  const answer = await place(peer.localDescription!.sdp);
  if (answer?.sdp)
    await peer.setRemoteDescription({ sdp: answer.sdp, type: "answer" });
  else stop();
  return answer;
};

const base64 = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      done(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(blob);
  });

// Chromium's, which TypeScript's DOM does not have yet.
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack });
  readonly readable: ReadableStream<AudioData>;
}

// The microphone's samples at the hearing rate, as they come.
const hearing = async (
  track: MediaStreamTrack,
  onSamples: (samples: Float32Array) => void,
) => {
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  for (;;) {
    const { done, value: frame } = await reader.read();
    if (done) return;
    const raw = new Float32Array(frame.numberOfFrames);
    frame.copyTo(raw, { format: "f32-planar", planeIndex: 0 });
    const rate = frame.sampleRate;
    frame.close();
    onSamples(toHearingRate(raw, rate));
  }
};

// Placing the call on the user's own models: this window cuts what the
// user says into what they say between pauses and sends each, and plays
// what the bot says in order. While the bot speaks, it does not hear, so
// that it does not hear the bot.
const ownCall = async ({
  bot,
  ended: endedThere,
  microphone,
  onDrain,
  onEnd,
  place,
  update,
}: Placing) => {
  const placed = await place(null);
  if (!placed) return;
  const id = placed.callId;
  const context = new AudioContext();
  let source: AudioBufferSourceNode | null = null;
  let ended = false;
  onEnd(() => {
    ended = true;
    source?.stop();
    void context.close();
  });
  update({ live: true });

  let playing = Promise.resolve();
  // A clip on its way when the call ends there plays too.
  let listening: Promise<unknown> = Promise.resolve();
  onDrain(async () => {
    await listening.catch(() => {});
    await playing;
  });
  let speaking = false;
  const play = async (clip: { audio: string; type: string }) => {
    if (ended) return;
    const bytes = Uint8Array.from(atob(clip.audio), (char) =>
      char.charCodeAt(0),
    );
    const buffer = await context.decodeAudioData(bytes.buffer);
    if (ended) return;
    speaking = true;
    update({ speaking });
    await new Promise<void>((done) => {
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => done();
      source.start();
    });
    source = null;
    speaking = false;
    update({ speaking });
  };
  void (async () => {
    while (!ended) {
      const asked = call({
        botId: bot.id,
        callId: id,
        type: "voice.listen",
      });
      listening = asked;
      const heard = await asked.catch(async () => {
        await new Promise((done) => setTimeout(done, 2_000));
        return null;
      });
      if (heard?.ended) {
        endedThere();
        return;
      }
      const clip = heard?.clip;
      if (clip)
        playing = playing
          .then(() => play(clip))
          .catch((error: unknown) => {
            toastError(messageOf(error));
          });
    }
  })();

  // One at a time, so the bot hears what the user said in the order they
  // said it.
  let sending = Promise.resolve();
  const send = (samples: Float32Array) => {
    const audio = base64(new Blob([wav(samples)], { type: "audio/wav" }));
    sending = sending.then(() =>
      audio
        .then((audio) =>
          ended
            ? null
            : call({
                audio,
                botId: bot.id,
                callId: id,
                type: "voice.hear",
              }),
        )
        .then(
          () => {},
          (error: unknown) => {
            if (!ended) toastError(messageOf(error));
          },
        ),
    );
  };
  const hear = createHearing(send);
  await hearing(microphone.getAudioTracks()[0]!, (samples) =>
    hear(samples, ended || speaking),
  );
};

type Placing = {
  bot: Pick<Bot, "id">;
  microphone: MediaStream;
  // What to stop once the chat ends, and what to wait for when it ends at
  // the host, as the bot's words still playing.
  onEnd: (stop: () => void) => void;
  onDrain: (wait: () => Promise<void>) => void;
  // It ended at the host.
  ended: () => void;
  // Asks the bot's computer for the call: null once it ended meanwhile.
  place: (
    sdp: string | null,
  ) => Promise<{ callId: string; sdp: string | null } | null>;
  update: (change: Partial<VoiceChat>) => void;
};

export const startVoiceChat = async (
  bot: Pick<Bot, "id">,
  kind: NonNullable<Host["voice"]>["kind"],
) => {
  current?.end();
  let microphone: MediaStream | null = null;
  let callId: string | null = null;
  // Muted before the microphone opened, it opens muted.
  let muted = false;
  const stops: (() => void)[] = [];
  let drain = () => Promise.resolve();
  let ending = false;
  const update = (change: Partial<VoiceChat>) => {
    if (current === session && chat) set({ ...chat, ...change });
  };
  const session = {
    end: () => {
      if (current !== session) return;
      current = null;
      set(null);
      for (const stop of stops) stop();
      for (const track of microphone?.getTracks() ?? []) track.stop();
      if (callId)
        call({ botId: bot.id, callId, type: "voice.stop" }).catch(() => {});
    },
    // Hung up here meanwhile, or another chat begun, it ends no more.
    ended: () => {
      if (current !== session || ending) return;
      ending = true;
      toastError("The voice chat ended.");
      void drain().then(session.end, session.end);
    },
    mute: (next: boolean) => {
      muted = next;
      for (const track of microphone?.getTracks() ?? []) track.enabled = !muted;
      update({ muted });
    },
    seen: false,
  };
  current = session;
  set({
    botId: bot.id,
    callId: null,
    live: false,
    muted: false,
    speaking: false,
  });

  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    if (current !== session) {
      for (const track of microphone.getTracks()) track.stop();
      return;
    }
    for (const track of microphone.getAudioTracks()) track.enabled = !muted;
    const placing: Placing = {
      bot,
      microphone,
      onEnd: (stop) => stops.push(stop),
      onDrain: (wait) => {
        drain = wait;
      },
      ended: () => session.ended(),
      place: async (sdp) => {
        const answer = await call({
          botId: bot.id,
          sdp,
          type: "voice.start",
        });
        callId = answer.callId;
        // Ended while the call was being placed: it ends there too.
        if (current !== session) {
          call({
            botId: bot.id,
            callId,
            type: "voice.stop",
          }).catch(() => {});
          return null;
        }
        update({ callId });
        return answer;
      },
      update,
    };
    if (kind === "own") await ownCall(placing);
    else {
      const answer = await chatgptCall(placing);
      if (answer && !answer.sdp)
        await ownCall({ ...placing, place: async () => answer });
    }
  } catch (error) {
    if (current !== session) return;
    toastError(
      error instanceof DOMException && error.name === "NotAllowedError"
        ? `Multibots isn't allowed to use the microphone.${bridge.platform === "darwin" ? " Allow it in System Settings › Privacy & Security › Microphone." : ""}`
        : messageOf(error),
    );
    session.end();
  }
};
