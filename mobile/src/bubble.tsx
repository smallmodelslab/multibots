import { Image } from "expo-image";
import { useEffect } from "react";
import { Pressable, Text, useColorScheme, View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import {
  GestureDetector,
  useLongPressGesture,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { previewOf } from "../../src/shared/preview";
import type { Attachment, Bot, Message } from "../../src/shared/types";
import { showError } from "./actions";
import { openFile, useDataUrl } from "./files";
import { colors, Icon } from "./ui";

// The bubble shades: what the user says in the bot's colour, what the bot
// says in the system's grey.
export const botGrey = { dark: "#26252A", light: "#E9E9EB" };

const Tail = ({ color, mine }: { color: string; mine: boolean }) => (
  <Svg
    height={18}
    style={{
      bottom: 0,
      position: "absolute",
      [mine ? "right" : "left"]: -6,
      transform: [{ scaleX: mine ? 1 : -1 }],
    }}
    viewBox="0 0 16 18"
    width={16}
  >
    <Path d="M0 0H6C6 8 9 14 16 18C9 18 3 16 0 12Z" fill={color} />
  </Svg>
);

type Attached = { bot: Pick<Bot, "id">; file: Attachment };

const AttachedImage = ({ bot, file }: Attached) => {
  const url = useDataUrl(bot.id, file);
  return (
    <Pressable onPress={() => openFile(bot.id, file.path).catch(showError)}>
      <Image
        contentFit="cover"
        source={url}
        style={{
          backgroundColor: colors.fill,
          borderCurve: "continuous",
          borderRadius: 18,
          height: 180,
          width: 240,
        }}
      />
    </Pressable>
  );
};

const AttachedFile = ({ bot, file }: Attached) => (
  <Pressable
    onPress={() => openFile(bot.id, file.path).catch(showError)}
    style={{
      alignItems: "center",
      backgroundColor: colors.fill,
      borderCurve: "continuous",
      borderRadius: 18,
      flexDirection: "row",
      gap: 8,
      maxWidth: 260,
      paddingHorizontal: 14,
      paddingVertical: 10,
    }}
  >
    <Icon name="doc" size={20} />
    <Text numberOfLines={1} style={{ color: colors.label, flexShrink: 1 }}>
      {file.name}
    </Text>
  </Pressable>
);

export const Bubble = ({
  bot,
  color,
  message,
  onLongPress,
  tail,
}: {
  bot: Pick<Bot, "id">;
  color: string;
  message: Message;
  onLongPress?: () => void;
  tail: boolean;
}) => {
  const dark = useColorScheme() === "dark";
  // Held down, natively, so that the markdown's own text view, which takes
  // touches, does not keep it from the message.
  const held = useLongPressGesture({
    enabled: Boolean(onLongPress),
    minDuration: 300,
    onActivate: () => onLongPress?.(),
    runOnJS: true,
  });
  if (message.role === "error")
    return (
      <Text
        selectable
        style={{
          color: colors.red,
          fontSize: 13,
          paddingHorizontal: 32,
          textAlign: "center",
        }}
      >
        {message.text}
      </Text>
    );
  const mine = message.role === "user";
  const fill = mine ? color : dark ? botGrey.dark : botGrey.light;
  const ink = mine ? "#FFFFFF" : dark ? "#FFFFFF" : "#000000";
  const text = message.forwarded?.text ?? message.text;
  return (
    <View
      style={{
        alignItems: mine ? "flex-end" : "flex-start",
        gap: 4,
        paddingHorizontal: 16,
      }}
    >
      {message.replyTo ? (
        <Text
          numberOfLines={2}
          style={{
            borderColor: colors.separator,
            borderRadius: 14,
            borderWidth: 1,
            color: colors.secondary,
            fontSize: 15,
            maxWidth: "70%",
            paddingHorizontal: 12,
            paddingVertical: 6,
          }}
        >
          {previewOf(message.replyTo.text)}
        </Text>
      ) : null}
      {message.forwarded ? (
        <Text style={{ color: colors.secondary, fontSize: 12 }}>
          Forwarded from {message.forwarded.author}
        </Text>
      ) : null}
      <GestureDetector gesture={held}>
        <View
          style={{
            alignItems: mine ? "flex-end" : "flex-start",
            gap: 4,
            maxWidth: "78%",
          }}
        >
          {message.attachments?.map((file) =>
            file.type.startsWith("image/") ? (
              <AttachedImage bot={bot} file={file} key={file.path} />
            ) : (
              <AttachedFile bot={bot} file={file} key={file.path} />
            ),
          )}
          {text ? (
            <View>
              <View
                style={{
                  backgroundColor: fill,
                  borderCurve: "continuous",
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                }}
              >
                {mine ? (
                  <Text style={{ color: ink, fontSize: 17, lineHeight: 22 }}>
                    {text}
                  </Text>
                ) : (
                  <EnrichedMarkdownText
                    allowTrailingMargin={false}
                    flavor="github"
                    markdown={text}
                    markdownStyle={{
                      code: { backgroundColor: dark ? "#3A393F" : "#D9D9DE" },
                      codeBlock: {
                        backgroundColor: dark ? "#1C1B20" : "#F4F4F6",
                        borderRadius: 10,
                        fontSize: 14,
                      },
                      h1: { color: ink, fontSize: 22 },
                      h2: { color: ink, fontSize: 20 },
                      h3: { color: ink, fontSize: 18 },
                      link: { color: dark ? "#64A8FF" : "#0A66D8" },
                      list: { color: ink, fontSize: 17 },
                      paragraph: { color: ink, fontSize: 17, lineHeight: 22 },
                    }}
                    selectable={false}
                  />
                )}
                {tail ? <Tail color={fill} mine={mine} /> : null}
              </View>
            </View>
          ) : null}
          {message.reactions?.length ? (
            <View
              style={{
                backgroundColor: fill,
                borderColor: colors.background,
                borderRadius: 16,
                borderWidth: 2,
                flexDirection: "row",
                paddingHorizontal: 6,
                paddingVertical: 2,
                position: "absolute",
                top: -16,
                [mine ? "left" : "right"]: -10,
              }}
            >
              <Text style={{ fontSize: 15 }}>{message.reactions.join("")}</Text>
            </View>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
};

const TypingDot = ({ index }: { index: number }) => {
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withDelay(
      index * 180,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 360 }),
          withTiming(0.3, { duration: 360 }),
        ),
        -1,
      ),
    );
  }, [index, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        {
          backgroundColor: colors.secondary,
          borderRadius: 4.5,
          height: 9,
          width: 9,
        },
        style,
      ]}
    />
  );
};

// The bot at work: its bubble typing, and what it is doing.
export const Typing = ({ working }: { working: string }) => {
  const dark = useColorScheme() === "dark";
  const fill = dark ? botGrey.dark : botGrey.light;
  return (
    <View style={{ alignItems: "flex-start", gap: 4, paddingHorizontal: 16 }}>
      <View
        style={{
          backgroundColor: fill,
          borderRadius: 20,
          flexDirection: "row",
          gap: 5,
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        {[0, 1, 2].map((index) => (
          <TypingDot index={index} key={index} />
        ))}
        <Tail color={fill} mine={false} />
      </View>
      <Text
        numberOfLines={1}
        style={{ color: colors.secondary, fontSize: 12, paddingLeft: 6 }}
      >
        {working}
      </Text>
    </View>
  );
};
