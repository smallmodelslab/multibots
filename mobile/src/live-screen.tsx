import { useEffect, useRef, useState } from "react";
import { PixelRatio, Text, View } from "react-native";
import {
  MediaStream,
  RTCPeerConnection,
  RTCRtpReceiver,
  RTCView,
  type RTCRtpTransceiver,
} from "react-native-webrtc";

import { call, messageOf } from "./data";
import { colors } from "./ui";

// Codecs in Multidesktop's order: the bot's computer answers with the first
// it can encode.
const codecs = ["video/av1", "video/h265", "video/h264"];

const preferCodecs = (transceiver: RTCRtpTransceiver) => {
  const available = RTCRtpReceiver.getCapabilities("video")?.codecs ?? [];
  const rank = (codec: { mimeType: string }) =>
    codecs.indexOf(codec.mimeType.toLowerCase());
  const media = available
    .filter((codec) => rank(codec) >= 0)
    .sort((a, b) => rank(a) - rank(b));
  const repair = available.filter((codec) =>
    /\/(rtx|red|ulpfec)$/i.test(codec.mimeType),
  );
  if (media.length) transceiver.setCodecPreferences([...media, ...repair]);
};

// What a session with the screen says of the video it sends.
type Status = { type: "status"; width: number; quality?: { scale?: number } };

// The screen of a bot's computer, live, as its bots see and use it: a
// session of that computer's Multidesktop, offered from here and answered
// through its Multibots. It runs while `shown`, only as sharp as it is shown.
export const LiveScreen = ({
  hostId,
  shown,
}: {
  hostId: string;
  shown: boolean;
}) => {
  const [stream, setStream] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const width = useRef(0);

  useEffect(() => {
    if (!shown) return;
    setProblem(null);
    setStream(null);
    let ended = false;
    let session: string | null = null;
    const peer = new RTCPeerConnection();
    preferCodecs(peer.addTransceiver("video", { direction: "recvonly" }));
    peer.addTransceiver("audio", { direction: "recvonly" });
    const control = peer.createDataChannel("control");
    let id = 0;
    const request = (operation: object) =>
      control.send(
        JSON.stringify({ id: (id += 1), type: "request", ...operation }),
      );
    let scale = 1;
    const fit = (status: Status) => {
      const native = status.width / (status.quality?.scale || 1);
      const wanted = Math.max(
        0.1,
        Math.min(1, (width.current * PixelRatio.get()) / native),
      );
      if (width.current && Math.abs(wanted - scale) > 0.05)
        request({ op: "quality", scale: (scale = wanted) });
    };
    control.addEventListener("open", () =>
      request({ audio: false, op: "stream", video: true }),
    );
    control.addEventListener("message", ({ data }) => {
      if (typeof data !== "string") return;
      const message = JSON.parse(data) as {
        type: string;
        ok?: boolean;
        error?: string;
      };
      if (message.type === "status") fit(message as Status);
      if (message.type === "reply" && message.ok === false)
        setProblem(message.error ?? "The screen refused.");
    });
    control.addEventListener("close", () => {
      if (!ended) setProblem("The screen closed.");
    });
    peer.addEventListener("track", ({ track }) => {
      if (track?.kind === "video") setStream(new MediaStream([track]).toURL());
    });
    peer.addEventListener("connectionstatechange", () => {
      if (peer.connectionState === "failed")
        setProblem("Can't reach the screen.");
    });
    void (async () => {
      await peer.setLocalDescription(await peer.createOffer({}));
      const answer = await call({
        hostId,
        sdp: peer.localDescription!.sdp,
        type: "screen.view",
      });
      if (ended) {
        void call({ hostId, session: answer.session, type: "screen.close" });
        return;
      }
      session = answer.session;
      await peer.setRemoteDescription({ sdp: answer.sdp, type: "answer" });
    })().catch((error: unknown) => {
      if (!ended) setProblem(messageOf(error));
    });
    return () => {
      ended = true;
      peer.close();
      if (session)
        void call({ hostId, session, type: "screen.close" }).catch(() => {});
    };
  }, [hostId, shown]);

  return (
    <View
      onLayout={(event) => {
        width.current = event.nativeEvent.layout.width;
      }}
      style={{
        alignItems: "center",
        aspectRatio: 16 / 10,
        backgroundColor: "#000",
        borderCurve: "continuous",
        borderRadius: 22,
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {stream && !problem ? (
        <RTCView
          objectFit="contain"
          streamURL={stream}
          style={{ height: "100%", width: "100%" }}
        />
      ) : (
        <Text style={{ color: colors.tertiary, fontSize: 15 }}>
          {problem ?? "Connecting…"}
        </Text>
      )}
    </View>
  );
};
