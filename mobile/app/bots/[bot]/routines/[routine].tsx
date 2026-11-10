import { Host, Picker, Text as SwiftText } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { senders, type Sender } from "@wrkrsh/webhooks";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeTrigger } from "../../../../../src/shared/schedule";
import { showError } from "../../../../src/actions";
import { call, useBotDetail } from "../../../../src/data";
import { TopBar } from "../../../../src/top-bar";
import { colors, Group, Icon, Note, Row } from "../../../../src/ui";

// A value of a webhook's to copy, `name`d for assistive technology; a
// secret one shows only when asked.
const WebhookValue = ({
  label,
  name,
  secret = false,
  value,
}: {
  label: string;
  name: string;
  secret?: boolean;
  value: string;
}) => {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  return (
    <Row>
      <Text style={{ color: colors.label, fontSize: 17 }}>{label}</Text>
      <Text
        ellipsizeMode="middle"
        numberOfLines={1}
        selectable
        style={{
          color: colors.secondary,
          flex: 1,
          fontFamily: "Menlo",
          fontSize: 13,
          textAlign: "right",
        }}
      >
        {shown ? value : "•".repeat(16)}
      </Text>
      {secret ? (
        <Pressable
          accessibilityLabel={`${shown ? "Hide" : "Show"} the ${name}`}
          hitSlop={8}
          onPress={() => setShown(!shown)}
        >
          <Icon color={colors.blue} name={shown ? "eye.slash" : "eye"} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel={`Copy the ${name}`}
        hitSlop={8}
        onPress={() =>
          Clipboard.setStringAsync(value).then(() => setCopied(true), showError)
        }
      >
        <Icon color={colors.blue} name={copied ? "checkmark" : "doc.on.doc"} />
      </Pressable>
    </Row>
  );
};

// A sender's own secret, pasted and saved.
const PastedSecret = ({
  label,
  onSave,
  saved,
}: {
  label: string;
  onSave: (secret: string) => void;
  saved: string | null;
}) => {
  const [draft, setDraft] = useState(saved ?? "");
  const pasted = draft.trim();
  const changed = pasted !== "" && pasted !== saved;
  return (
    <Row>
      <Text style={{ color: colors.label, fontSize: 17 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setDraft}
        onSubmitEditing={() => changed && onSave(pasted)}
        placeholder="Paste it here"
        placeholderTextColor={colors.tertiary}
        secureTextEntry
        style={{
          color: colors.label,
          flex: 1,
          fontFamily: "Menlo",
          fontSize: 13,
          textAlign: "right",
        }}
        value={draft}
      />
      <Pressable
        accessibilityLabel={`Save the ${label.toLowerCase()}`}
        disabled={!changed}
        hitSlop={8}
        onPress={() => onSave(pasted)}
      >
        <Text
          style={{
            color: changed ? colors.blue : colors.tertiary,
            fontSize: 17,
          }}
        >
          Save
        </Text>
      </Pressable>
    </Row>
  );
};

// A routine opened from a bot's details: what wakes it, what it does, and
// for one a webhook wakes, who calls it, where, and with what secret: ours
// to copy, or theirs to paste.
export default function Routine() {
  const { bot: botId, routine: routineId } = useLocalSearchParams<{
    bot: string;
    routine: string;
  }>();
  const detail = useBotDetail(botId);
  const routine = detail?.routines.find((each) => each.id === routineId);
  const webhook = detail?.webhooks[routineId];
  const sender = webhook && senders[webhook.sender];
  const { top } = useSafeAreaInsets();
  const set = (next: Sender, secret?: string) =>
    void call({
      botId,
      routineId,
      secret,
      sender: next,
      type: "routine.webhook",
    }).catch(showError);

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      {routine ? (
        <ScrollView
          contentContainerStyle={{
            gap: 22,
            paddingBottom: 48,
            paddingHorizontal: 16,
            paddingTop: top + 64,
          }}
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 4, paddingHorizontal: 18 }}>
            <Text
              selectable
              style={{ color: colors.label, fontSize: 28, fontWeight: "700" }}
            >
              {routine.title}
            </Text>
            <Text style={{ color: colors.secondary, fontSize: 17 }}>
              {describeTrigger(routine, webhook)}
            </Text>
          </View>
          <Group>
            <Row first>
              <Text
                selectable
                style={{
                  color: colors.label,
                  flex: 1,
                  fontSize: 17,
                  lineHeight: 22,
                }}
              >
                {routine.instructions}
              </Text>
            </Row>
          </Group>
          {webhook && sender ? (
            <View style={{ gap: 8 }}>
              <Group>
                <Row first>
                  <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>
                    Sender
                  </Text>
                  <Host matchContents>
                    <Picker
                      modifiers={[pickerStyle("menu")]}
                      onSelectionChange={(next: string) => set(next as Sender)}
                      selection={webhook.sender}
                    >
                      {Object.entries(senders).map(([value, { label }]) => (
                        <SwiftText key={value} modifiers={[tag(value)]}>
                          {label}
                        </SwiftText>
                      ))}
                    </Picker>
                  </Host>
                </Row>
                <WebhookValue label="POST to" name="URL" value={webhook.url} />
                {sender.ours ? (
                  <WebhookValue
                    label={sender.secret}
                    name={sender.secret.toLowerCase()}
                    secret
                    value={webhook.secret ?? ""}
                  />
                ) : (
                  <PastedSecret
                    key={webhook.sender}
                    label={sender.secret}
                    onSave={(secret) => set(webhook.sender, secret)}
                    saved={webhook.secret}
                  />
                )}
              </Group>
              <Note>{sender.setup}</Note>
            </View>
          ) : null}
        </ScrollView>
      ) : detail === undefined ? (
        <ActivityIndicator style={{ marginTop: top + 80 }} />
      ) : null}
      <TopBar />
    </View>
  );
}
