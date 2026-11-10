import { Link, router, Stack } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";

import { botPreview, listTime } from "../../src/shared/preview";
import type { Bot } from "../../src/shared/types";
import { pin, remove } from "../src/actions";
import { BotAvatar } from "../src/bot-avatar";
import { useBots, useComputers, useSeen } from "../src/data";
import { colors, Note, Icon } from "../src/ui";

// When a bot last did something, which orders the list, newest first.
const activity = (bot: Bot) => bot.last?.at ?? bot.createdAt;

const chatOf = (bot: Bot) => `/bots/${bot.id}` as const;

const Dot = ({ shown }: { shown: boolean }) => (
  <View
    style={{
      backgroundColor: shown ? colors.blue : "transparent",
      borderRadius: 5,
      height: 10,
      width: 10,
    }}
  />
);

const Pinned = ({ bot, unread }: { bot: Bot; unread: boolean }) => (
  <Link asChild href={chatOf(bot)}>
    <Link.Trigger>
      <Pressable style={{ alignItems: "center", gap: 6, width: "33.3%" }}>
        <View>
          <BotAvatar bot={bot} size={84} working={Boolean(bot.working)} />
          <View style={{ left: 2, position: "absolute", top: 18 }}>
            <Dot shown={unread} />
          </View>
        </View>
        <Text
          numberOfLines={1}
          style={{ color: colors.secondary, fontSize: 13, maxWidth: 104 }}
        >
          {bot.name}
        </Text>
      </Pressable>
    </Link.Trigger>
    <Link.Menu>
      <Link.MenuAction icon="pin.slash" onPress={() => pin(bot, false)}>
        Unpin
      </Link.MenuAction>
      <Link.MenuAction
        destructive
        icon="trash"
        onPress={() => void remove(bot)}
      >
        Delete
      </Link.MenuAction>
    </Link.Menu>
  </Link>
);

const Action = ({
  color,
  icon,
  label,
  onPress,
}: {
  color: string;
  icon: "pin.fill" | "trash.fill";
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityLabel={label}
    onPress={onPress}
    style={{
      alignItems: "center",
      backgroundColor: color,
      justifyContent: "center",
      width: 80,
    }}
  >
    <Icon color="white" name={icon} size={22} />
  </Pressable>
);

const BotRow = ({
  bot,
  now,
  unread,
}: {
  bot: Bot;
  now: number;
  unread: boolean;
}) => (
  <Swipeable
    friction={2}
    renderLeftActions={(_progress, _translation, swipeable) => (
      <Action
        color="#FF9F0A"
        icon="pin.fill"
        label={`Pin ${bot.name}`}
        onPress={() => {
          swipeable.close();
          pin(bot, true);
        }}
      />
    )}
    renderRightActions={(_progress, _translation, swipeable) => (
      <Action
        color="#FF3B30"
        icon="trash.fill"
        label={`Delete ${bot.name}`}
        onPress={() => {
          swipeable.close();
          void remove(bot);
        }}
      />
    )}
  >
    <Pressable
      onPress={() => router.push(chatOf(bot))}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.fill : colors.background,
        flexDirection: "row",
        gap: 10,
        paddingLeft: 8,
      })}
    >
      <Dot shown={unread} />
      <BotAvatar bot={bot} size={56} working={Boolean(bot.working)} />
      <View
        style={{
          borderBottomColor: colors.separator,
          borderBottomWidth: 0.5,
          flex: 1,
          gap: 2,
          paddingRight: 16,
          paddingVertical: 12,
        }}
      >
        <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
          <Text
            numberOfLines={1}
            style={{
              color: colors.label,
              flex: 1,
              fontSize: 17,
              fontWeight: "600",
            }}
          >
            {bot.name}
          </Text>
          {bot.last ? (
            <Text style={{ color: colors.secondary, fontSize: 15 }}>
              {listTime(bot.last.at, now)}
            </Text>
          ) : null}
          <Icon color={colors.tertiary} name="chevron.right" size={13} />
        </View>
        <Text
          numberOfLines={2}
          style={{ color: colors.secondary, fontSize: 15, lineHeight: 20 }}
        >
          {bot.working ?? botPreview(bot)}
        </Text>
      </View>
    </Pressable>
  </Swipeable>
);

export default function Bots() {
  const { hosts, offline } = useComputers();
  const bots = useBots();
  const seen = useSeen();
  const [query, setQuery] = useState("");
  const now = Date.now();
  const typed = query.trim().toLowerCase();
  const unread = (bot: Bot) =>
    bot.last?.role === "bot" && seen[bot.id] !== bot.last.id;
  const pinned = typed
    ? []
    : (bots ?? [])
        .filter((bot) => bot.pinnedAt !== null)
        .sort((a, b) => a.pinnedAt! - b.pinnedAt!);
  const rest = (bots ?? [])
    .filter((bot) =>
      typed
        ? `${bot.name} ${bot.last?.text ?? ""}`.toLowerCase().includes(typed)
        : bot.pinnedAt === null,
    )
    .sort((a, b) => activity(b) - activity(a));

  return (
    <>
      <ScrollView
        contentContainerStyle={{ gap: 20, paddingBottom: 24, paddingTop: 8 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {!hosts.length && !offline.length ? (
          <View style={{ alignItems: "center", gap: 14, paddingTop: 120 }}>
            <Note>Your bots live on your computers.</Note>
            <Pressable onPress={() => router.push("/computers")}>
              <Text
                style={{ color: colors.blue, fontSize: 17, fontWeight: "600" }}
              >
                Add a Computer
              </Text>
            </Pressable>
          </View>
        ) : !hosts.length ? (
          <View style={{ paddingTop: 120 }}>
            <Note>Can't reach your computers right now.</Note>
          </View>
        ) : null}
        {pinned.length ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              paddingHorizontal: 8,
              rowGap: 18,
            }}
          >
            {pinned.map((bot) => (
              <Pinned bot={bot} key={bot.id} unread={unread(bot)} />
            ))}
          </View>
        ) : null}
        <View>
          {rest.map((bot) => (
            <BotRow bot={bot} key={bot.id} now={now} unread={unread(bot)} />
          ))}
        </View>
      </ScrollView>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          accessibilityLabel="Computers"
          icon="desktopcomputer"
          onPress={() => router.push("/computers")}
        />
      </Stack.Toolbar>
      <Stack.SearchBar
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        placeholder="Search"
      />
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.SearchBarSlot />
        <Stack.Toolbar.Button
          accessibilityLabel="New message"
          disabled={!hosts.length}
          icon="square.and.pencil"
          onPress={() => router.push("/new")}
          separateBackground
        />
      </Stack.Toolbar>
    </>
  );
}
