/** @satisfies {import("electron-builder").Configuration} */
export default {
  appId: "com.multibots",
  // Releases stamp their version here, not in package.json, whose contents are
  // part of the JavaScript runtime fingerprint.
  ...(process.env.MULTIBOTS_VERSION && {
    extraMetadata: { version: process.env.MULTIBOTS_VERSION },
  }),
  productName: "Multibots",
  artifactName: "multibots-${version}-${os}-${arch}.${ext}",
  files: ["out/**/*", "package.json"],
  publish: {
    provider: "generic",
    url: "https://downloads.wrkrsh.com/multibots/updates",
    useMultipleRangeRequest: false,
  },
  mac: {
    icon: "icon.icon",
    target: ["zip", "dmg"],
    category: "public.app-category.productivity",
    notarize: true,
    // Voice chat uses the microphone.
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    extendInfo: {
      NSLocalNetworkUsageDescription:
        "Multibots talks to Multibots on your other computers over your tailnet.",
      NSMicrophoneUsageDescription:
        "Multibots listens while you talk with a bot in a voice chat.",
    },
  },
  linux: {
    icon: "icon.png",
    executableName: "multibots",
    target: ["AppImage"],
    category: "Utility",
  },
  npmRebuild: false,
};
