import { PlatformColor, View } from "react-native";
import { SvgXml } from "react-native-svg";

import {
  appearanceOf,
  type Identity,
} from "../../src/features/avatars/appearance";
import { renderAvatar } from "../../src/features/avatars/artwork";
import { samplePose } from "../../src/features/avatars/motion";

const rest = samplePose(0);

// A bot's squircle face as the desktop draws it, at rest, with a dot while
// it works.
export const BotAvatar = ({
  bot,
  size,
  working = false,
}: {
  bot: Identity;
  size: number;
  working?: boolean;
}) => {
  const dot = Math.max(10, Math.round(size * 0.24));
  return (
    <View style={{ height: size, width: size }}>
      <SvgXml
        height={size}
        width={size}
        xml={renderAvatar(appearanceOf(bot), rest)}
      />
      {working ? (
        <View
          style={{
            backgroundColor: "#34C759",
            borderColor: PlatformColor("systemBackground"),
            borderRadius: dot / 2,
            borderWidth: 2,
            bottom: size * 0.1,
            height: dot,
            position: "absolute",
            right: size * 0.06,
            width: dot,
          }}
        />
      ) : null}
    </View>
  );
};
