import {
  Host as SwiftHost,
  Picker,
  Text as SwiftText,
} from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { Image } from "expo-image";
import { File, Paths } from "expo-file-system";
import { router, Stack, useIsFocused, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeTrigger } from "../../../../src/shared/schedule";
import type { Bot, BotDetail, Host } from "../../../../src/shared/types";
import {
  languages,
  speeds,
  voices,
  type VoiceSettings,
} from "../../../../src/shared/voice";
import { change, pin, remove, showError } from "../../../src/actions";
import { BotAvatar } from "../../../src/bot-avatar";
import {
  botKey,
  call,
  useBot,
  useBotDetail,
  useWhiteboardImage,
} from "../../../src/data";
import { openFile } from "../../../src/files";
import { LiveScreen } from "../../../src/live-screen";
import { TopBar } from "../../../src/top-bar";
import { colors, GlassButton, Group, Note, Row, Icon } from "../../../src/ui";

const tabs = [
  ["computer", "Computer"],
  ["whiteboard", "Whiteboard"],
  ["library", "Library"],
  ["details", "Details"],
] as const;
type Tab = (typeof tabs)[number][0];

const update = (
  bot: Bot,
  edit: Partial<Pick<Bot, "name" | "instructions" | "voice">>,
) =>
  change<BotDetail | null>(
    botKey(bot.id),
    (current) =>
      current ? { ...current, bot: { ...current.bot, ...edit } } : current,
    call({ botId: bot.id, type: "bot.update", ...edit }),
  );

const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.round(size / 1024)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;

const Label = ({ children }: { children: string }) => (
  <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>{children}</Text>
);
const Value = ({ children }: { children: string }) => (
  <Text
    numberOfLines={1}
    selectable
    style={{ color: colors.secondary, flexShrink: 1, fontSize: 17 }}
  >
    {children}
  </Text>
);
const Title = ({ children }: { children: string }) => (
  <Text
    style={{
      color: colors.secondary,
      fontSize: 13,
      paddingBottom: 6,
      paddingHorizontal: 18,
    }}
  >
    {children}
  </Text>
);

const ComputerTab = ({
  detail,
  host,
  shown,
}: {
  detail: BotDetail;
  host: Host;
  shown: boolean;
}) => (
  <>
    {host.screen === "ready" ? (
      <LiveScreen hostId={host.id} shown={shown} />
    ) : host.screen === "blocked" ? (
      <Note>
        Bots on {host.name} can use its screen once it is allowed there.
      </Note>
    ) : null}
    <Group>
      <Row first>
        <Label>Computer</Label>
        <Value>{host.name}</Value>
      </Row>
      <Row>
        <Label>System</Label>
        <Value>{host.os}</Value>
      </Row>
      <Row>
        <Label>Model</Label>
        <Value>{host.model ?? "Not signed in to ChatGPT"}</Value>
      </Row>
    </Group>
    {detail.commands.length ? (
      <View>
        <Title>Commands</Title>
        <Group>
          {detail.commands.toReversed().map((command, index) => (
            <Row first={index === 0} key={index}>
              <Text
                numberOfLines={2}
                selectable
                style={{
                  color: colors.label,
                  flex: 1,
                  fontFamily: "Menlo",
                  fontSize: 13,
                }}
              >
                {command}
              </Text>
            </Row>
          ))}
        </Group>
      </View>
    ) : null}
  </>
);

// The board the bot and the user draw on, as its computer draws it; it opens
// to zoom in.
const WhiteboardTab = ({ bot }: { bot: Bot }) => {
  const image = useWhiteboardImage(bot.id);
  const [ratio, setRatio] = useState(4 / 3);
  if (image === undefined) return <ActivityIndicator />;
  if (image === null) return <Note>Nothing drawn yet.</Note>;
  const open = async () => {
    const file = new File(Paths.cache, `${bot.name} whiteboard.png`);
    await file.write(image, { encoding: "base64" });
    await file.preview();
  };
  return (
    <Pressable
      accessibilityLabel="Open the whiteboard"
      onPress={() => open().catch(showError)}
    >
      <Image
        contentFit="contain"
        onLoad={({ source }) => setRatio(source.width / source.height)}
        source={`data:image/png;base64,${image}`}
        style={{
          aspectRatio: ratio,
          backgroundColor: "#fff",
          borderCurve: "continuous",
          borderRadius: 22,
          width: "100%",
        }}
      />
    </Pressable>
  );
};

const LibraryTab = ({ bot, detail }: { bot: Bot; detail: BotDetail }) =>
  detail.files.length ? (
    <Group>
      {detail.files.map((file, index) => (
        <Row
          first={index === 0}
          key={file.path}
          onPress={() => openFile(bot.id, file.path).catch(showError)}
        >
          <Icon color={colors.secondary} name="doc" />
          <Text
            ellipsizeMode="middle"
            numberOfLines={1}
            style={{ color: colors.label, flex: 1, fontSize: 17 }}
          >
            {file.path}
          </Text>
          <Text style={{ color: colors.secondary, fontSize: 15 }}>
            {bytes(file.size)}
          </Text>
        </Row>
      ))}
    </Group>
  ) : (
    <Note>No files yet.</Note>
  );

// One of the bot's voice settings, as a menu of what it can be.
const VoiceSetting = ({
  first = false,
  label,
  onChange,
  options,
  value,
}: {
  first?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: [value: string, name: string][];
  value: string;
}) => (
  <Row first={first}>
    <Label>{label}</Label>
    <SwiftHost matchContents>
      <Picker
        modifiers={[pickerStyle("menu")]}
        onSelectionChange={(next: string) => onChange(next)}
        selection={value}
      >
        {options.map(([each, name]) => (
          <SwiftText key={each} modifiers={[tag(each)]}>
            {name}
          </SwiftText>
        ))}
      </Picker>
    </SwiftHost>
  </Row>
);

// Its voice is one of ChatGPT's, or of the speech server's when its
// computer speaks on the user's own model, where it may also keep the
// server's default.
const VoiceSettings = ({
  bot,
  host,
  voice,
}: {
  bot: Bot;
  host: Host;
  voice: VoiceSettings;
}) => {
  const set = (change: Partial<VoiceSettings>) =>
    update(bot, { voice: { ...voice, ...change } });
  const own = host.voice?.kind === "own" ? host.voice.voices : null;
  return (
    <Group>
      {own ? (
        <VoiceSetting
          first
          label="Voice"
          onChange={(value) =>
            set({ ownVoice: value === "default" ? null : value })
          }
          options={[
            ["default", "Default"],
            ...own.map((each): [string, string] => [each, each]),
          ]}
          value={
            voice.ownVoice && own.includes(voice.ownVoice)
              ? voice.ownVoice
              : "default"
          }
        />
      ) : (
        <VoiceSetting
          first
          label="Voice"
          onChange={(value) => set({ voice: value })}
          options={voices.map((each) => [
            each,
            each[0]!.toUpperCase() + each.slice(1),
          ])}
          value={voice.voice}
        />
      )}
      <VoiceSetting
        label="Speed"
        onChange={(value) => set({ speed: value as VoiceSettings["speed"] })}
        options={Object.entries(speeds)}
        value={voice.speed}
      />
      <VoiceSetting
        label="Language"
        onChange={(value) => set({ language: value === "auto" ? null : value })}
        options={[
          ["auto", "Auto-detect"],
          ...languages.map((each): [string, string] => [each, each]),
        ]}
        value={voice.language ?? "auto"}
      />
    </Group>
  );
};

// A field that keeps what it says until it loses focus, then saves it.
const useField = (saved: string, save: (value: string) => void) => {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    onBlur: () => {
      if (draft !== null && draft !== saved) save(draft);
      setDraft(null);
    },
    onChangeText: setDraft,
    value: draft ?? saved,
  };
};

const DetailsTab = ({
  bot,
  detail,
  host,
}: {
  bot: Bot;
  detail: BotDetail;
  host: Host;
}) => {
  const name = useField(detail.bot.name, (value) => {
    if (value.trim()) update(bot, { name: value.trim() });
  });
  const instructions = useField(detail.bot.instructions, (value) =>
    update(bot, { instructions: value }),
  );
  return (
    <>
      <Group>
        <Row first>
          <TextInput
            {...name}
            accessibilityLabel="Name"
            maxLength={40}
            style={{ color: colors.label, flex: 1, fontSize: 17 }}
          />
        </Row>
      </Group>
      <Group>
        <TextInput
          {...instructions}
          accessibilityLabel="Instructions"
          multiline
          placeholder="What's it for?"
          placeholderTextColor={colors.tertiary}
          style={{
            color: colors.label,
            fontSize: 17,
            lineHeight: 22,
            minHeight: 110,
            paddingHorizontal: 18,
            paddingVertical: 14,
          }}
        />
      </Group>
      {detail.routines.length ? (
        <View>
          <Title>Routines</Title>
          <Group>
            {detail.routines.map((routine, index) => (
              <Row
                first={index === 0}
                key={routine.id}
                onPress={() =>
                  router.push(`/bots/${bot.id}/routines/${routine.id}`)
                }
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.label, fontSize: 17 }}>
                    {routine.title}
                  </Text>
                  <Text style={{ color: colors.secondary, fontSize: 15 }}>
                    {describeTrigger(routine, detail.webhooks[routine.id])}
                  </Text>
                </View>
                <Switch
                  onValueChange={(enabled) =>
                    void call({
                      botId: bot.id,
                      enabled,
                      routineId: routine.id,
                      type: "routine.enable",
                    }).catch(showError)
                  }
                  value={routine.enabled}
                />
              </Row>
            ))}
          </Group>
        </View>
      ) : null}
      <View>
        <Title>Voice chat</Title>
        <VoiceSettings bot={bot} host={host} voice={detail.bot.voice} />
      </View>
      <Group>
        <Row first>
          <Label>Pinned</Label>
          <Switch
            onValueChange={(pinned) => pin(bot, pinned)}
            value={bot.pinnedAt !== null}
          />
        </Row>
      </Group>
      <Group>
        <Row
          first
          onPress={() =>
            void remove(bot).then((gone) => gone && router.dismissTo("/"))
          }
        >
          <Text style={{ color: colors.red, fontSize: 17 }}>Delete Bot</Text>
        </Row>
      </Group>
    </>
  );
};

// A bot's own page, as Messages shows a contact's: the bot, and tabs for
// the computer it runs on, the whiteboard it shares with the user, the files
// it keeps and its details.
export default function Profile() {
  const { bot: botId } = useLocalSearchParams<{ bot: string }>();
  const { bot, host } = useBot(botId);
  const detail = useBotDetail(botId);
  const [tab, setTab] = useState<Tab>("computer");
  const focused = useIsFocused();
  const { top } = useSafeAreaInsets();

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      {bot && host ? (
        <ScrollView
          contentContainerStyle={{
            gap: 22,
            paddingBottom: 48,
            paddingTop: top + 56,
          }}
          contentInsetAdjustmentBehavior="never"
          keyboardDismissMode="interactive"
        >
          <View style={{ alignItems: "center", gap: 6 }}>
            <BotAvatar bot={bot} size={128} working={Boolean(bot.working)} />
            <Text
              selectable
              style={{ color: colors.label, fontSize: 32, fontWeight: "700" }}
            >
              {bot.name}
            </Text>
            <Text style={{ color: colors.secondary, fontSize: 15 }}>
              {bot.working ?? `On ${host.name}`}
            </Text>
            {host.voice ? (
              <View style={{ paddingTop: 12 }}>
                <GlassButton
                  icon="phone.fill"
                  label={`Call ${bot.name}`}
                  onPress={() => router.push(`/bots/${botId}/call`)}
                  size={56}
                />
              </View>
            ) : null}
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
              paddingHorizontal: 12,
            }}
          >
            {tabs.map(([value, label]) => (
              <Pressable
                accessibilityState={{ selected: tab === value }}
                key={value}
                onPress={() => setTab(value)}
                style={{ paddingHorizontal: 11, paddingVertical: 6 }}
              >
                <Text
                  style={{
                    color: tab === value ? colors.label : colors.secondary,
                    fontSize: 17,
                    fontWeight: tab === value ? "600" : "400",
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ gap: 22, paddingHorizontal: 16 }}>
            {!detail ? (
              <ActivityIndicator />
            ) : tab === "computer" ? (
              <ComputerTab detail={detail} host={host} shown={focused} />
            ) : tab === "whiteboard" ? (
              <WhiteboardTab bot={bot} />
            ) : tab === "library" ? (
              <LibraryTab bot={bot} detail={detail} />
            ) : (
              <DetailsTab bot={bot} detail={detail} host={host} key={bot.id} />
            )}
          </View>
        </ScrollView>
      ) : null}
      <TopBar />
    </View>
  );
}
