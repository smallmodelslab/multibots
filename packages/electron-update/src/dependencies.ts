import { createRequire, isBuiltin, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// OTA ships app code and browser assets. Bare imports retain the dependencies
// from the signed installation, including native addons and Pyodide. Preserve
// Node's import/require conditions and package exports by rebasing only the parent.
export function registerInstalledDependencies(
  installedEntry: string,
  payloadRoot: string,
): void {
  const parentURL = pathToFileURL(installedEntry).href;
  const installedRequire = createRequire(parentURL);
  const prefix =
    pathToFileURL(
      join(realpathSync(dirname(payloadRoot)), basename(payloadRoot)),
    ).href + "/";
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        context.parentURL?.startsWith(prefix) &&
        !isBuiltin(specifier) &&
        specifier !== "electron" &&
        !specifier.startsWith(".") &&
        !specifier.startsWith("/") &&
        !/^[a-zA-Z][\w+.-]*:/.test(specifier)
      ) {
        if (context.conditions.includes("require")) {
          return {
            url: pathToFileURL(installedRequire.resolve(specifier)).href,
            shortCircuit: true,
          };
        }
        return nextResolve(specifier, { ...context, parentURL });
      }
      return nextResolve(specifier, context);
    },
  });
}
