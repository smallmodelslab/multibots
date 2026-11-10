import * as Clipboard from "expo-clipboard";
import { Modal, Pressable, Text, View } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";

import {
  quickReactions,
  toggleReaction,
  type Bot,
  type Message,
} from "../../src/shared/types";
import { change } from "./actions";
import { Bubble } from "./bubble";
import { botKey, call } from "./data";
import { colors, Glass, Icon } from "./ui";

const Item = ({
  destructive = false,
  first = false,
  icon,
  label,
  onPress,
}: {
  destructive?: boolean;
  first?: boolean;
  icon: SFSymbol;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    onPress={onPress}
    style={{
      alignItems: "center",
      borderTopColor: colors.separator,
      borderTopWidth: first ? 0 : 0.5,
      flexDirection: "row",
      paddingHorizontal: 18,
      paddingVertical: 13,
    }}
  >
    <Text
      style={{
        color: destructive ? colors.red : colors.label,
        flex: 1,
        fontSize: 17,
      }}
    >
      {label}
    </Text>
    <Icon color={destructive ? colors.red : colors.label} name={icon} />
  </Pressable>
);

// A change to a conversation's messages, shown at once.
const changeMessages = (
  bot: Pick<Bot, "id">,
  edit: (messages: Message[]) => Message[],
  request: Promise<unknown>,
) =>
  change<{ messages: Message[] } | null>(
    botKey(bot.id),
    (detail) => detail && { ...detail, messages: edit(detail.messages) },
    request,
  );

// A message held down, as Messages shows one: reactions over it, and what
// can be done with it under it.
export const Tapback = ({
  bot,
  color,
  message,
  onClose,
  onReply,
}: {
  bot: Pick<Bot, "id">;
  color: string;
  message: Message;
  onClose: () => void;
  onReply: () => void;
}) => {
  const mine = message.role === "user";
  const react = (emoji: string) => {
    onClose();
    changeMessages(
      bot,
      (messages) =>
        messages.map((each) =>
          each.id === message.id
            ? { ...each, reactions: toggleReaction(each.reactions, emoji) }
            : each,
        ),
      call({
        botId: bot.id,
        emoji,
        messageId: message.id,
        type: "message.react",
      }),
    );
  };
  const remove = () => {
    onClose();
    changeMessages(
      bot,
      (messages) => messages.filter((each) => each.id !== message.id),
      call({
        botId: bot.id,
        messageId: message.id,
        type: "message.delete",
      }),
    );
  };
  const side = mine ? "flex-end" : "flex-start";
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <Pressable
        onPress={onClose}
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.3)",
          flex: 1,
          gap: 12,
          justifyContent: "center",
        }}
      >
        <Glass
          style={{
            alignSelf: side,
            borderRadius: 30,
            flexDirection: "row",
            gap: 2,
            marginHorizontal: 16,
            padding: 6,
          }}
        >
          {quickReactions.map((emoji) => (
            <Pressable
              accessibilityLabel={`React ${emoji}`}
              key={emoji}
              onPress={() => react(emoji)}
              style={{
                alignItems: "center",
                backgroundColor: message.reactions?.includes(emoji)
                  ? colors.fill
                  : "transparent",
                borderRadius: 22,
                height: 44,
                justifyContent: "center",
                width: 44,
              }}
            >
              <Text style={{ fontSize: 26 }}>{emoji}</Text>
            </Pressable>
          ))}
        </Glass>
        <View
          pointerEvents="none"
          style={{ maxHeight: "50%", overflow: "hidden" }}
        >
          <Bubble bot={bot} color={color} message={message} tail />
        </View>
        <Glass
          style={{
            alignSelf: side,
            borderRadius: 22,
            marginHorizontal: 16,
            overflow: "hidden",
            width: 240,
          }}
        >
          <Item
            first
            icon="arrowshape.turn.up.left"
            label="Reply"
            onPress={() => {
              onClose();
              onReply();
            }}
          />
          <Item
            icon="doc.on.doc"
            label="Copy"
            onPress={() => {
              onClose();
              void Clipboard.setStringAsync(message.text);
            }}
          />
          {mine ? (
            <Item destructive icon="trash" label="Delete" onPress={remove} />
          ) : null}
        </Glass>
      </Pressable>
    </Modal>
  );
};
