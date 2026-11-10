import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import {
  PlatformColor,
  Pressable,
  Text,
  View,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";

export const colors = {
  label: PlatformColor("label"),
  secondary: PlatformColor("secondaryLabel"),
  tertiary: PlatformColor("tertiaryLabel"),
  separator: PlatformColor("separator"),
  background: PlatformColor("systemBackground"),
  grouped: PlatformColor("secondarySystemBackground"),
  fill: PlatformColor("systemGray5"),
  blue: PlatformColor("systemBlue"),
  red: PlatformColor("systemRed"),
  green: PlatformColor("systemGreen"),
};

export const Icon = ({
  name,
  size = 20,
  color = colors.label,
}: {
  name: SFSymbol;
  size?: number;
  color?: ColorValue;
}) => (
  <Image
    source={`sf:${name}`}
    style={{ height: size, width: size }}
    tintColor={color as string}
  />
);

const glass = isLiquidGlassAvailable();

// Liquid glass where the system has it, else a plain raised surface.
export const Glass = ({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) =>
  glass ? (
    <GlassView isInteractive style={style}>
      {children}
    </GlassView>
  ) : (
    <View
      style={[
        {
          backgroundColor: colors.background,
          boxShadow: "0 2px 12px rgba(0, 0, 0, 0.12)",
        },
        style,
      ]}
    >
      {children}
    </View>
  );

// A round glass button with a symbol, as the system's bars have them.
export const GlassButton = ({
  icon,
  label,
  onPress,
  size = 44,
  tint,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  size?: number;
  tint?: ColorValue;
}) => (
  <Pressable accessibilityLabel={label} hitSlop={6} onPress={onPress}>
    <Glass
      style={{
        alignItems: "center",
        borderRadius: size / 2,
        height: size,
        justifyContent: "center",
        width: size,
      }}
    >
      <Icon color={tint} name={icon} size={size * 0.42} />
    </Glass>
  </Pressable>
);

// Rows grouped on a rounded surface, as Settings shows them.
export const Group = ({ children }: { children: ReactNode }) => (
  <View
    style={{
      backgroundColor: colors.grouped,
      borderCurve: "continuous",
      borderRadius: 26,
      overflow: "hidden",
    }}
  >
    {children}
  </View>
);

export const Row = ({
  children,
  first = false,
  onPress,
}: {
  children: ReactNode;
  first?: boolean;
  onPress?: () => void;
}) => {
  const content = (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 52,
        paddingHorizontal: 18,
        paddingVertical: 12,
      }}
    >
      {children}
    </View>
  );
  return (
    <View>
      {first ? null : (
        <View
          style={{
            backgroundColor: colors.separator,
            height: 0.5,
            marginLeft: 18,
          }}
        />
      )}
      {onPress ? (
        <Pressable
          onPress={onPress}
          style={({ pressed }) => ({
            backgroundColor: pressed ? colors.fill : "transparent",
          })}
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
    </View>
  );
};

export const Note = ({
  children,
  color = colors.secondary,
}: {
  children: ReactNode;
  color?: ColorValue;
}) => (
  <Text
    selectable
    style={{ color, fontSize: 15, lineHeight: 20, paddingHorizontal: 18 }}
  >
    {children}
  </Text>
);
