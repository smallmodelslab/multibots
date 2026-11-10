import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

import { call, messageOf } from "../data";

// Codecs in Multidesktop's order: the bot's computer answers with the first
// it can encode.
const codecs = ["video/av1", "video/h265", "video/h264"];

const preferCodecs = (transceiver: RTCRtpTransceiver) => {
  const available = RTCRtpReceiver.getCapabilities("video")?.codecs ?? [];
  const rank = (codec: RTCRtpCodec) =>
    codecs.indexOf(codec.mimeType.toLowerCase());
  const media = available
    .filter((codec) => rank(codec) >= 0)
    .sort((a, b) => rank(a) - rank(b));
  const repair = available.filter((codec) =>
    /\/(rtx|red|ulpfec)$/i.test(codec.mimeType),
  );
  if (media.length) transceiver.setCodecPreferences([...media, ...repair]);
};

// Whether `element` can be seen: the window shown, and some of it in view,
// neither scrolled away nor in a closed panel.
const useSeen = (element: RefObject<Element | null>) => {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry!.intersectionRatio > 0),
    );
    observer.observe(element.current!);
    return () => observer.disconnect();
  }, [element]);
  const shown = useSyncExternalStore(
    (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    () => !document.hidden,
  );
  return shown && inView;
};

// What a session with the screen says of the video it sends.
type Status = { type: "status"; width: number; quality?: { scale?: number } };

// Another computer's screen, live, as its bots see and use it: a session of
// its Multidesktop's, offered from here and answered through OpenBots on
// that computer. It shows while it can be seen, at the size it is shown.
export const LiveScreen = ({ hostId }: { hostId: string }) => {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const seen = useSeen(frame);

  useEffect(() => {
    if (!seen) return;
    setProblem(null);
    setLive(false);
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
    // Only as sharp as the video is shown.
    const fit = (status: Status) => {
      const native = status.width / (status.quality?.scale || 1);
      const shown = (video.current?.clientWidth ?? 0) * devicePixelRatio;
      const wanted = Math.max(0.1, Math.min(1, shown / native));
      if (shown && Math.abs(wanted - scale) > 0.05)
        request({ op: "quality", scale: (scale = wanted) });
    };
    control.onopen = () => request({ audio: false, op: "stream", video: true });
    control.onmessage = ({ data }) => {
      if (typeof data !== "string") return;
      const message = JSON.parse(data) as {
        type: string;
        ok?: boolean;
        error?: string;
      };
      if (message.type === "status") fit(message as Status);
      if (message.type === "reply" && message.ok === false)
        setProblem(message.error ?? "The screen refused.");
    };
    peer.ontrack = ({ receiver, track }) => {
      if (track.kind !== "video" || !video.current) return;
      receiver.jitterBufferTarget = 0;
      video.current.srcObject = new MediaStream([track]);
      setLive(true);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed")
        setProblem("Can't reach the screen.");
    };
    control.onclose = () => {
      if (!ended) setProblem("The screen closed.");
    };
    void (async () => {
      await peer.setLocalDescription(await peer.createOffer());
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
  }, [hostId, seen]);

  return (
    <div
      className="live-screen"
      data-live={(live && !problem) || undefined}
      ref={frame}
    >
      <video autoPlay muted playsInline ref={video} />
      {problem || !live ? (
        <span className="live-screen-notice">{problem ?? "Connecting…"}</span>
      ) : null}
    </div>
  );
};
