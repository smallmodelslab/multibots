import { router, Stack } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { nextHue } from "../../src/features/bots/colors";
import type { Bot } from "../../src/shared/types";
import { showError } from "../src/actions";
import { BotAvatar } from "../src/bot-avatar";
import { call, useBots, useComputers } from "../src/data";
import { colors, Glass, Icon } from "../src/ui";

const Choice = ({
  avatar,
  detail,
  onPress,
  title,
}: {
  avatar: React.ReactNode;
  detail: string;
  onPress: () => void;
  title: string;
}) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => ({
      alignItems: "center",
      backgroundColor: pressed ? colors.fill : "transparent",
      flexDirection: "row",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 8,
    })}
  >
    {avatar}
    <View style={{ flex: 1 }}>
      <Text numberOfLines={1} style={{ color: colors.label, fontSize: 17 }}>
        {title}
      </Text>
      <Text style={{ color: colors.secondary, fontSize: 15 }}>{detail}</Text>
    </View>
  </Pressable>
);

// A conversation with a bot: one of the user's, or a new one.
export default function NewMessage() {
  const { hosts } = useComputers();
  const bots = useBots() ?? [];
  const [name, setName] = useState("");
  const [making, setMaking] = useState(false);
  const typed = name.trim();
  const matching = bots.filter((bot) =>
    bot.name.toLowerCase().includes(typed.toLowerCase()),
  );
  const exact = bots.some(
    (bot) => bot.name.toLowerCase() === typed.toLowerCase(),
  );
  const hostName = (id: string) =>
    hosts.find((host) => host.id === id)?.name ?? "";
  const open = (bot: Pick<Bot, "id">) => router.replace(`/bots/${bot.id}`);
  const make = () => {
    if (making) return;
    setMaking(true);
    call({
      hue: nextHue(bots.map((bot) => bot.hue)),
      instructions: "",
      name: typed,
      type: "bot.create",
    })
      .then(open, showError)
      .finally(() => setMaking(false));
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={{ gap: 8, paddingBottom: 24 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ padding: 16 }}>
          <Glass
            style={{
              alignItems: "center",
              borderCurve: "continuous",
              borderRadius: 26,
              flexDirection: "row",
              gap: 6,
              minHeight: 52,
              paddingHorizontal: 18,
            }}
          >
            <Text style={{ color: colors.secondary, fontSize: 17 }}>To:</Text>
            <TextInput
              autoCorrect={false}
              autoFocus
              maxLength={40}
              onChangeText={setName}
              placeholder="A bot, or a name for a new one"
              placeholderTextColor={colors.tertiary}
              style={{ color: colors.label, flex: 1, fontSize: 17 }}
              value={name}
            />
          </Glass>
        </View>
        {typed && !exact && hosts.some((host) => host.server) ? (
          <Choice
            avatar={
              <View
                style={{
                  alignItems: "center",
                  backgroundColor: colors.fill,
                  borderRadius: 22,
                  height: 44,
                  justifyContent: "center",
                  width: 44,
                }}
              >
                <Icon name="plus" size={18} />
              </View>
            }
            detail="New bot"
            onPress={make}
            title={typed}
          />
        ) : null}
        {matching.map((bot) => (
          <Choice
            avatar={<BotAvatar bot={bot} size={44} />}
            detail={`On ${hostName(bot.server)}`}
            key={bot.id}
            onPress={() => open(bot)}
            title={bot.name}
          />
        ))}
      </ScrollView>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          accessibilityLabel="Close"
          icon="xmark"
          onPress={() => router.back()}
        />
      </Stack.Toolbar>
    </>
  );
}
