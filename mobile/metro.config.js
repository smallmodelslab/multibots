const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The desktop's protocol, schedules, voices and avatars, which the phone
// shares; what they import comes from the phone's own packages.
const desktop = path.resolve(__dirname, "../src");
const own = path.join(__dirname, "package.json");
config.watchFolders = [desktop];
config.resolver.resolveRequest = (context, name, platform) =>
  context.resolveRequest(
    context.originModulePath.startsWith(desktop) && !name.startsWith(".")
      ? { ...context, originModulePath: own }
      : context,
    name,
    platform,
  );

module.exports = config;
