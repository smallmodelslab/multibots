import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { PlatformColor, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

export default function Layout() {
  const dark = useColorScheme() === "dark";
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ThemeProvider value={dark ? DarkTheme : DefaultTheme}>
          <Stack
            screenOptions={{
              contentStyle: {
                backgroundColor: PlatformColor("systemBackground"),
              },
              headerBackButtonDisplayMode: "minimal",
            }}
          >
            <Stack.Screen
              name="index"
              options={{
                headerLargeTitle: true,
                headerTransparent: true,
                title: "Multibots",
              }}
            />
            <Stack.Screen
              name="computers"
              options={{
                presentation: "formSheet",
                sheetAllowedDetents: [0.6, 1],
                sheetGrabberVisible: true,
                title: "Computers",
              }}
            />
            <Stack.Screen
              name="new"
              options={{ presentation: "modal", title: "New Message" }}
            />
            <Stack.Screen
              name="bots/[bot]/index"
              options={{ headerTransparent: true, title: "" }}
            />
            <Stack.Screen
              name="bots/[bot]/profile"
              options={{ headerTransparent: true, title: "" }}
            />
            <Stack.Screen
              name="bots/[bot]/routines/[routine]"
              options={{ headerTransparent: true, title: "" }}
            />
            <Stack.Screen
              name="bots/[bot]/call"
              options={{ headerShown: false, presentation: "fullScreenModal" }}
            />
          </Stack>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
