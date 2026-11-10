import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { avatarColor } from "../../../../src/features/avatars/parts";
import { BotAvatar } from "../../../src/bot-avatar";
import { useBot } from "../../../src/data";
import { Icon } from "../../../src/ui";
import { useVoiceCall } from "../../../src/voice";

const CallButton = ({
  color,
  icon,
  ink = "white",
  label,
  onPress,
}: {
  color: string;
  icon: "mic.slash.fill" | "mic.fill" | "phone.down.fill";
  ink?: string;
  label: string;
  onPress: () => void;
}) => (
  <View style={{ alignItems: "center", gap: 8 }}>
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        alignItems: "center",
        backgroundColor: color,
        borderRadius: 38,
        height: 76,
        justifyContent: "center",
        width: 76,
      }}
    >
      <Icon color={ink} name={icon} size={30} />
    </Pressable>
    <Text style={{ color: "rgba(255, 255, 255, 0.8)", fontSize: 13 }}>
      {label}
    </Text>
  </View>
);

const Call = ({
  bot,
  kind,
}: {
  bot: NonNullable<ReturnType<typeof useBot>["bot"]>;
  kind: "chatgpt" | "own";
}) => {
  const { bottom, top } = useSafeAreaInsets();
  const [muted, setMuted] = useState(false);
  const call = useVoiceCall(bot, kind, muted);
  const [seen, setSeen] = useState(false);
  // The bot's computer ends a call it can no longer hand on: once the bot
  // it showed in this call is out of it, so is the phone. A call it was in
  // before, which this one ends, is not this one.
  useEffect(() => {
    if (call.callId && bot.call === call.callId) setSeen(true);
    else if (seen) router.back();
  }, [bot.call, call.callId, seen]);
  return (
    <View
      style={{
        alignItems: "center",
        experimental_backgroundImage: `linear-gradient(to bottom, ${avatarColor(bot.hue)}, #111114 70%)`,
        flex: 1,
        justifyContent: "space-between",
        paddingBottom: bottom + 32,
        paddingTop: top + 72,
      }}
    >
      <View style={{ alignItems: "center", gap: 14 }}>
        <BotAvatar bot={bot} size={150} />
        <Text style={{ color: "white", fontSize: 32, fontWeight: "600" }}>
          {bot.name}
        </Text>
        <Text
          selectable
          style={{
            color: "rgba(255, 255, 255, 0.75)",
            fontSize: 17,
            paddingHorizontal: 32,
            textAlign: "center",
          }}
        >
          {call.ended ??
            (!call.live
              ? "Connecting…"
              : call.speaking
                ? "Speaking"
                : "Listening")}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 64 }}>
        <CallButton
          color={
            muted ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 255, 255, 0.2)"
          }
          icon={muted ? "mic.slash.fill" : "mic.fill"}
          ink={muted ? "#111114" : "white"}
          label={muted ? "Unmute" : "Mute"}
          onPress={() => setMuted(!muted)}
        />
        <CallButton
          color="#FF3B30"
          icon="phone.down.fill"
          label="End"
          onPress={() => router.back()}
        />
      </View>
    </View>
  );
};

export default function VoiceChat() {
  const { bot: botId } = useLocalSearchParams<{ bot: string }>();
  const { bot, host } = useBot(botId);
  useEffect(() => {
    if (!bot || !host?.voice) router.back();
  }, [bot, host]);
  return bot && host?.voice ? (
    <Call bot={bot} kind={host.voice.kind} />
  ) : (
    <View style={{ backgroundColor: "#111114", flex: 1 }} />
  );
}
