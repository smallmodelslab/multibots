import { router } from "expo-router";
import type { ReactNode } from "react";
import { useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassButton } from "./ui";

export const topBarHeight = 132;

// The top of a conversation or a bot's profile, as Messages has it: glass
// buttons either side of what is in the middle, over what scrolls beneath,
// which fades into it.
export const TopBar = ({
  middle,
  right,
}: {
  middle?: ReactNode;
  right?: ReactNode;
}) => {
  const { top } = useSafeAreaInsets();
  const dark = useColorScheme() === "dark";
  const surface = dark ? "0, 0, 0" : "255, 255, 255";
  return (
    <View
      pointerEvents="box-none"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(${surface}, 0.97) 72%, rgba(${surface}, 0) 100%)`,
        flexDirection: "row",
        height: top + (middle ? topBarHeight : 64),
        left: 0,
        paddingHorizontal: 16,
        paddingTop: top + 6,
        position: "absolute",
        right: 0,
        top: 0,
      }}
    >
      <View style={{ width: 44 }}>
        <GlassButton
          icon="chevron.left"
          label="Back"
          onPress={() => router.back()}
        />
      </View>
      <View pointerEvents="box-none" style={{ alignItems: "center", flex: 1 }}>
        {middle}
      </View>
      <View style={{ width: 44 }}>{right}</View>
    </View>
  );
};
