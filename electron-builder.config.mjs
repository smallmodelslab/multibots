/** @satisfies {import("electron-builder").Configuration} */
export default {
  appId: "com.wrkrsh.openbots",
  // Releases stamp their version here, not in package.json, whose contents are
  // part of the JavaScript runtime fingerprint.
  ...(process.env.OPENBOTS_VERSION && {
    extraMetadata: { version: process.env.OPENBOTS_VERSION },
  }),
  productName: "OpenBots",
  artifactName: "openbots-${version}-${os}-${arch}.${ext}",
  files: ["out/**/*", "package.json"],
  publish: {
    provider: "generic",
    url: "https://downloads.wrkrsh.com/openbots/updates",
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
        "OpenBots talks to OpenBots on your other computers over your tailnet.",
      NSMicrophoneUsageDescription:
        "OpenBots listens while you talk with a bot in a voice chat.",
    },
  },
  linux: {
    icon: "icon.png",
    executableName: "openbots",
    target: ["AppImage"],
    category: "Utility",
  },
  npmRebuild: false,
};
