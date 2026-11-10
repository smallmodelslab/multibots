import { Image } from "expo-image";
import { useState } from "react";
import {
  ActionSheetIOS,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { previewOf } from "../../src/shared/preview";
import {
  uploadLimits,
  type Bot,
  type Message,
  type Upload,
} from "../../src/shared/types";
import { showError } from "./actions";
import { botKey, call, store } from "./data";
import { pickFiles, pickPhotos } from "./files";
import { colors, Glass, GlassButton, Icon } from "./ui";

const Pending = ({
  onRemove,
  upload,
}: {
  onRemove: () => void;
  upload: Upload;
}) => (
  <View>
    {upload.type.startsWith("image/") ? (
      <Image
        source={`data:${upload.type};base64,${upload.data}`}
        style={{ borderRadius: 12, height: 64, width: 64 }}
      />
    ) : (
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.fill,
          borderRadius: 12,
          gap: 4,
          height: 64,
          justifyContent: "center",
          padding: 6,
          width: 64,
        }}
      >
        <Icon name="doc" size={20} />
        <Text numberOfLines={1} style={{ color: colors.label, fontSize: 10 }}>
          {upload.name}
        </Text>
      </View>
    )}
    <Pressable
      accessibilityLabel={`Remove ${upload.name}`}
      hitSlop={8}
      onPress={onRemove}
      style={{ position: "absolute", right: -6, top: -6 }}
    >
      <Icon color={colors.secondary} name="xmark.circle.fill" size={20} />
    </Pressable>
  </View>
);

// What the user sends a bot: text, files and photos, maybe in reply to one
// of its messages. While the bot works and nothing is written, it stops it.
export const Composer = ({
  bot,
  color,
  onReplied,
  replyTo,
}: {
  bot: Bot;
  color: string;
  onReplied: () => void;
  replyTo: Message | null;
}) => {
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [sending, setSending] = useState(false);
  const ready = (text.trim() || uploads.length) && !sending;

  const attach = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { cancelButtonIndex: 2, options: ["Photos", "Files", "Cancel"] },
      (index) => {
        if (index > 1) return;
        const room = uploadLimits.count - uploads.length;
        (index === 0 ? pickPhotos(room) : pickFiles())
          .then((picked) =>
            setUploads((current) =>
              [...current, ...picked].slice(0, uploadLimits.count),
            ),
          )
          .catch(showError);
      },
    );

  // What was sent leaves the composer at once, so what the user writes
  // meanwhile is theirs; it comes back if sending fails and they wrote
  // nothing since.
  const send = () => {
    if (!ready) return;
    const draft = { text: text.trim(), uploads };
    setText("");
    setUploads([]);
    onReplied();
    setSending(true);
    call({
      botId: bot.id,
      text: draft.text,
      type: "bot.send",
      uploads: draft.uploads,
      ...(replyTo && { replyTo: replyTo.id }),
    })
      .then(
        (message) =>
          store.patch<{ messages: Message[] } | null>(
            botKey(bot.id),
            (detail) =>
              detail && !detail.messages.some((each) => each.id === message.id)
                ? { ...detail, messages: [...detail.messages, message] }
                : detail,
          ),
        (error: unknown) => {
          setText((current) => current || draft.text);
          setUploads((current) => (current.length ? current : draft.uploads));
          showError(error);
        },
      )
      .finally(() => setSending(false));
  };

  return (
    <View
      style={{
        alignItems: "flex-end",
        flexDirection: "row",
        gap: 10,
        paddingHorizontal: 16,
        paddingTop: 8,
      }}
    >
      <GlassButton icon="plus" label="Attach" onPress={attach} />
      <Glass
        style={{
          borderCurve: "continuous",
          borderRadius: 22,
          flex: 1,
          minHeight: 44,
        }}
      >
        {replyTo ? (
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 8,
              paddingHorizontal: 16,
              paddingTop: 10,
            }}
          >
            <Text
              numberOfLines={1}
              style={{ color: colors.secondary, flex: 1, fontSize: 14 }}
            >
              Replying to {previewOf(replyTo.text)}
            </Text>
            <Pressable
              accessibilityLabel="Stop replying"
              hitSlop={8}
              onPress={onReplied}
            >
              <Icon color={colors.secondary} name="xmark" size={14} />
            </Pressable>
          </View>
        ) : null}
        {uploads.length ? (
          <ScrollView
            contentContainerStyle={{ gap: 10, padding: 12 }}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {uploads.map((upload, index) => (
              <Pending
                key={`${upload.name}-${index}`}
                onRemove={() =>
                  setUploads((current) =>
                    current.filter((_, at) => at !== index),
                  )
                }
                upload={upload}
              />
            ))}
          </ScrollView>
        ) : null}
        <View style={{ alignItems: "flex-end", flexDirection: "row" }}>
          <TextInput
            multiline
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={colors.tertiary}
            style={{
              color: colors.label,
              flex: 1,
              fontSize: 17,
              maxHeight: 140,
              paddingBottom: 11,
              paddingLeft: 16,
              paddingRight: 8,
              paddingTop: 11,
            }}
            value={text}
          />
          {ready ? (
            <Pressable
              accessibilityLabel="Send"
              onPress={send}
              style={{ padding: 6 }}
            >
              <Icon color={color} name="arrow.up.circle.fill" size={32} />
            </Pressable>
          ) : bot.working && !text ? (
            <Pressable
              accessibilityLabel={`Stop ${bot.name}`}
              onPress={() =>
                call({ botId: bot.id, type: "bot.stop" }).catch(showError)
              }
              style={{ padding: 6 }}
            >
              <Icon color={colors.label} name="stop.circle.fill" size={32} />
            </Pressable>
          ) : null}
        </View>
      </Glass>
    </View>
  );
};
