import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import {
  KeyboardChatScrollView,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { botColor } from "../../../../src/features/bots/colors";
import { daysAgo } from "../../../../src/shared/preview";
import type { Message } from "../../../../src/shared/types";
import { BotAvatar } from "../../../src/bot-avatar";
import { Bubble, Typing } from "../../../src/bubble";
import { Composer } from "../../../src/composer";
import { markSeen, useBot, useBotDetail } from "../../../src/data";
import { Tapback } from "../../../src/tapback";
import { TopBar, topBarHeight } from "../../../src/top-bar";
import { colors, Glass, GlassButton, Note, Icon } from "../../../src/ui";

const hourMs = 60 * 60 * 1000;

// When a stretch of the conversation started, as Messages says it.
const stretchTime = (at: number, now: number) => {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const days = daysAgo(at, now);
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7)
    return `${date.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} at ${time}`;
};

type Item = {
  message: Message;
  // The last of what one side said in a row, which has the bubble's tail.
  tail: boolean;
  spaced: boolean;
  time: string | null;
};

const itemsOf = (messages: Message[], now: number): Item[] =>
  messages
    .map((message, index) => {
      const before = messages[index - 1];
      const after = messages[index + 1];
      const time =
        !before || message.at - before.at > hourMs
          ? stretchTime(message.at, now)
          : null;
      return {
        message,
        spaced: !before || before.role !== message.role || Boolean(time),
        tail:
          !after ||
          after.role !== message.role ||
          after.at - message.at > hourMs,
        time,
      };
    })
    .reverse();

export default function Conversation() {
  const { bot: botId } = useLocalSearchParams<{ bot: string }>();
  const { bot, host } = useBot(botId);
  const detail = useBotDetail(botId);
  const { bottom, top } = useSafeAreaInsets();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [held, setHeld] = useState<Message | null>(null);
  const [composerHeight, setComposerHeight] = useState(60);
  const color = botColor(bot?.hue ?? 215);

  useEffect(() => {
    if (bot) markSeen(bot);
  }, [bot]);
  // Deleted, here or elsewhere.
  useEffect(() => {
    if (detail === null) router.back();
  }, [detail]);

  const profile = `/bots/${botId}/profile` as const;
  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <FlatList
        contentContainerStyle={{
          paddingBottom: top + topBarHeight,
          paddingTop: composerHeight + 12,
        }}
        contentInsetAdjustmentBehavior="never"
        data={detail ? itemsOf(detail.messages, Date.now()) : []}
        inverted
        keyboardDismissMode="interactive"
        keyExtractor={(item) => item.message.id}
        ListHeaderComponent={
          bot?.working ? (
            <View style={{ paddingTop: 12 }}>
              <Typing working={bot.working} />
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <View style={{ gap: 6, paddingTop: item.spaced ? 14 : 2 }}>
            {item.time ? (
              <Text
                style={{
                  color: colors.secondary,
                  fontSize: 12,
                  fontWeight: "500",
                  paddingBottom: 6,
                  textAlign: "center",
                }}
              >
                {item.time}
              </Text>
            ) : null}
            <Bubble
              bot={{ id: botId }}
              color={color}
              message={item.message}
              onLongPress={() => setHeld(item.message)}
              tail={item.tail}
            />
          </View>
        )}
        renderScrollComponent={(props) => (
          <KeyboardChatScrollView {...props} inverted offset={bottom} />
        )}
      />
      <KeyboardStickyView
        offset={{ closed: 0, opened: bottom }}
        style={{ bottom: 0, left: 0, position: "absolute", right: 0 }}
      >
        <View
          onLayout={(event) => {
            setComposerHeight(event.nativeEvent.layout.height);
          }}
          style={{ paddingBottom: bottom + 6 }}
        >
          {bot ? (
            <Composer
              bot={bot}
              color={color}
              onReplied={() => setReplyTo(null)}
              replyTo={replyTo}
            />
          ) : (
            <Note>{host ? "" : "This bot's computer is out of reach."}</Note>
          )}
        </View>
      </KeyboardStickyView>
      <TopBar
        middle={
          bot ? (
            <Pressable
              accessibilityLabel={`${bot.name}'s profile`}
              onPress={() => router.push(profile)}
              style={{ alignItems: "center" }}
            >
              <BotAvatar bot={bot} size={60} working={Boolean(bot.working)} />
              <Glass
                style={{
                  alignItems: "center",
                  borderRadius: 18,
                  flexDirection: "row",
                  gap: 4,
                  marginTop: -6,
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.label,
                    fontSize: 17,
                    fontWeight: "600",
                    maxWidth: 180,
                  }}
                >
                  {bot.name}
                </Text>
                <Icon color={colors.tertiary} name="chevron.right" size={11} />
              </Glass>
            </Pressable>
          ) : null
        }
        right={
          bot && host?.voice ? (
            <GlassButton
              icon="phone"
              label={`Call ${bot.name}`}
              onPress={() => router.push(`/bots/${botId}/call`)}
            />
          ) : null
        }
      />
      {held ? (
        <Tapback
          bot={{ id: botId }}
          color={color}
          message={held}
          onClose={() => setHeld(null)}
          onReply={() => setReplyTo(held)}
        />
      ) : null}
    </View>
  );
}
