import { Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { formatCode, normalizeCode } from "../../src/shared/peer";
import { addComputer, messageOf, useComputers } from "../src/data";
import { colors, Group, Note, Row } from "../src/ui";

const fieldStyle = {
  color: colors.label,
  fontSize: 17,
  minHeight: 52,
  paddingHorizontal: 18,
};

export default function Computers() {
  const { code, hosts, offline } = useComputers();
  const [address, setAddress] = useState("");
  const [typedCode, setTypedCode] = useState(code);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A new computer, or a new code for those it knows.
  const ready =
    !busy &&
    Boolean(typedCode.trim()) &&
    (Boolean(address.trim()) ||
      normalizeCode(typedCode) !== normalizeCode(code));
  const add = () => {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    addComputer(address, typedCode)
      .then(
        () => {
          setAddress("");
          setTypedCode(formatCode(normalizeCode(typedCode)) ?? "");
        },
        (error: unknown) => setProblem(messageOf(error)),
      )
      .finally(() => setBusy(false));
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={{ gap: 28, padding: 16 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        {hosts.length || offline.length ? (
          <Group>
            {hosts.map((host, index) => (
              <Row first={index === 0} key={host.id}>
                <View
                  style={{
                    backgroundColor: colors.green,
                    borderRadius: 4,
                    height: 8,
                    width: 8,
                  }}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.label, fontSize: 17 }}>
                    {host.name}
                  </Text>
                  <Text style={{ color: colors.secondary, fontSize: 15 }}>
                    {!host.server
                      ? host.os
                      : host.model
                        ? `${host.os}, a server on ${host.model}`
                        : `${host.os}, a server not signed in to ChatGPT`}
                  </Text>
                </View>
              </Row>
            ))}
            {offline.map((each, index) => (
              <Row first={!hosts.length && index === 0} key={each.address}>
                <View
                  style={{
                    backgroundColor: colors.tertiary,
                    borderRadius: 4,
                    height: 8,
                    width: 8,
                  }}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    selectable
                    style={{ color: colors.label, fontSize: 17 }}
                  >
                    {each.address}
                  </Text>
                  <Text style={{ color: colors.secondary, fontSize: 15 }}>
                    {each.unpaired
                      ? "Has another pairing code"
                      : "Out of reach"}
                  </Text>
                </View>
              </Row>
            ))}
          </Group>
        ) : null}
        <View style={{ gap: 10 }}>
          <Group>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={!hosts.length && !offline.length}
              keyboardType="numbers-and-punctuation"
              onChangeText={setAddress}
              onSubmitEditing={add}
              placeholder="Tailscale address, like 100.101.3.7"
              placeholderTextColor={colors.tertiary}
              returnKeyType="go"
              style={fieldStyle}
              value={address}
            />
            <View
              style={{
                backgroundColor: colors.separator,
                height: 0.5,
                marginLeft: 18,
              }}
            />
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={setTypedCode}
              onSubmitEditing={add}
              placeholder="Pairing code"
              placeholderTextColor={colors.tertiary}
              returnKeyType="go"
              style={fieldStyle}
              value={typedCode}
            />
          </Group>
          {problem ? (
            <Note color={colors.red}>{problem}</Note>
          ) : (
            <Note>
              A computer running Multibots on this phone's Tailscale account,
              and the pairing code in its Settings. Your other computers are
              found through it.
            </Note>
          )}
        </View>
      </ScrollView>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button disabled={!ready} onPress={add} variant="done">
          Connect
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
