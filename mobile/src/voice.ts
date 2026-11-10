import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamBuffer,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { mediaDevices, RTCPeerConnection } from "react-native-webrtc";

import {
  createHearing,
  hearingRate,
  speakingLevel,
  toHearingRate,
  wav,
} from "../../src/shared/hearing";
import type { Bot, Host } from "../../src/shared/types";
import { call, messageOf } from "./data";

export type VoiceCall = {
  // The call, once the bot's computer has placed it.
  callId: string | null;
  // Connected, rather than still connecting.
  live: boolean;
  // The bot's voice is speaking.
  speaking: boolean;
  // Why it ended, once it did.
  ended: string | null;
};

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};

const extensions: Record<string, string> = {
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
};

// A voice chat with a bot, for as long as the screen holding it is open. On
// ChatGPT it is the microphone and speaker on a WebRTC call to OpenAI, which
// the bot's computer places and listens in on. On the user's own models the
// phone hears the user itself, sending each thing they say once they pause,
// and plays what the bot says, as the desktop's window does.
export const useVoiceCall = (
  bot: Pick<Bot, "id">,
  kind: NonNullable<Host["voice"]>["kind"],
  muted: boolean,
) => {
  const [state, setState] = useState<VoiceCall>({
    callId: null,
    ended: null,
    live: false,
    speaking: false,
  });
  const heard = useRef<((buffer: AudioStreamBuffer) => void) | null>(null);
  const mute = useRef<(muted: boolean) => void>(() => {});
  const { stream } = useAudioStream({
    onBuffer: (buffer) => heard.current?.(buffer),
    sampleRate: hearingRate,
  });

  useEffect(() => {
    let ended = false;
    let callId: string | null = null;
    const stops: (() => void)[] = [];
    const update = (change: Partial<VoiceCall>) => {
      if (!ended) setState((current) => ({ ...current, ...change }));
    };
    const place = async (sdp: string | null) => {
      const answer = await call({
        botId: bot.id,
        sdp,
        type: "voice.start",
      });
      callId = answer.callId;
      update({ callId });
      // Hung up while it was being placed: it ends there too.
      if (ended)
        void call({
          botId: bot.id,
          callId,
          type: "voice.stop",
        }).catch(() => {});
      return ended ? null : answer;
    };

    const own = async (placed: { callId: string } | null) => {
      if (!(await requestRecordingPermissionsAsync()).granted)
        throw new Error(
          "OpenBots isn't allowed to use the microphone. Allow it in Settings.",
        );
      const answer = placed ?? (await place(null));
      if (!answer) return;
      const id = answer.callId;
      update({ live: true });

      // One at a time, so the bot hears what the user said in the order
      // they said it.
      let sending = Promise.resolve();
      const hear = createHearing((samples) => {
        const audio = base64(wav(samples));
        sending = sending.then(() =>
          ended
            ? undefined
            : call({
                audio,
                botId: bot.id,
                callId: id,
                type: "voice.hear",
              }).then(
                () => {},
                (error: unknown) => update({ ended: messageOf(error) }),
              ),
        );
      });
      let silenced = false;
      mute.current = (next) => {
        silenced = next;
      };
      heard.current = (buffer) => {
        if (ended || silenced) return;
        hear(
          toHearingRate(new Float32Array(buffer.data), buffer.sampleRate),
          false,
        );
      };
      // The microphone's stream takes the phone's audio for recording
      // alone, so while the bot speaks the phone stops hearing and plays.
      stops.push(() => stream.stop());
      await stream.start();

      const play = async (clip: { audio: string; type: string }) => {
        if (ended) return;
        const file = new File(
          Paths.cache,
          `voice-${Date.now()}.${extensions[clip.type] ?? "wav"}`,
        );
        await file.write(clip.audio, { encoding: "base64" });
        stream.stop();
        hear(new Float32Array(0), true);
        await setAudioModeAsync({ playsInSilentMode: true });
        update({ speaking: true });
        await new Promise<void>((done) => {
          const player = createAudioPlayer(file.uri);
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            subscription.remove();
            player.remove();
            done();
          };
          const subscription = player.addListener(
            "playbackStatusUpdate",
            (status) => {
              if (status.didJustFinish) finish();
            },
          );
          stops.push(finish);
          player.play();
        });
        file.delete();
        update({ speaking: false });
        if (!ended) await stream.start();
      };
      let playing = Promise.resolve();
      while (!ended) {
        const heard = await call({
          botId: bot.id,
          callId: id,
          type: "voice.listen",
        }).catch(async () => {
          await new Promise((done) => setTimeout(done, 2_000));
          return null;
        });
        if (heard?.ended) {
          update({ ended: "The voice chat ended." });
          return;
        }
        const clip = heard?.clip;
        if (clip)
          playing = playing
            .then(() => play(clip))
            .catch((error: unknown) => update({ ended: messageOf(error) }));
      }
    };

    const chatgpt = async () => {
      const microphone = await mediaDevices.getUserMedia({ audio: true });
      stops.push(() => microphone.getTracks().forEach((track) => track.stop()));
      const peer = new RTCPeerConnection();
      stops.push(() => peer.close());
      for (const track of microphone.getAudioTracks())
        peer.addTrack(track, microphone);
      mute.current = (next) => {
        for (const track of microphone.getAudioTracks()) track.enabled = !next;
      };
      peer.addEventListener("connectionstatechange", () => {
        if (peer.connectionState === "connected") update({ live: true });
        else if (peer.connectionState === "failed")
          update({ ended: "The voice chat dropped." });
      });
      // How loud the bot's voice is, which the call's statistics say.
      const meter = setInterval(() => {
        void peer.getStats().then((report) => {
          let level = 0;
          report.forEach(
            (entry: { type: string; kind?: string; audioLevel?: number }) => {
              if (entry.type === "inbound-rtp" && entry.kind === "audio")
                level = entry.audioLevel ?? 0;
            },
          );
          update({ speaking: level > speakingLevel });
        });
      }, 250);
      stops.push(() => clearInterval(meter));
      await peer.setLocalDescription(await peer.createOffer({}));
      const answer = await place(peer.localDescription!.sdp);
      if (!answer) return;
      if (answer.sdp)
        await peer.setRemoteDescription({ sdp: answer.sdp, type: "answer" });
      else {
        // The bot's computer placed it on the user's models instead.
        while (stops.length) stops.pop()!();
        await own(answer);
      }
    };

    (kind === "own" ? own(null) : chatgpt()).catch((error: unknown) =>
      update({ ended: messageOf(error) }),
    );
    return () => {
      ended = true;
      heard.current = null;
      for (const stop of stops) stop();
      if (callId)
        void call({
          botId: bot.id,
          callId,
          type: "voice.stop",
        }).catch(() => {});
    };
  }, [bot.id, kind, stream]);

  useEffect(() => mute.current(muted), [muted, state.live]);

  return state;
};
