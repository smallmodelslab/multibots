import type { ConfigContext, ExpoConfig } from "expo/config";

// A release build carries the version its GitHub workflow chose.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  version: process.env.APP_VERSION ?? config.version,
});
