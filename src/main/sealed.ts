import { readFile, writeFile } from "node:fs/promises";

// What must stay on this computer, such as a sign-in or a server's key, is
// sealed by the system keychain where there is one. Linux without a keyring
// has only Electron's fixed-password fallback, so there it is a file only
// the user can read, as Codex keeps its sign-in. Electron is loaded only to
// seal, so what merely may seal runs outside it too, as under test.
const storage = async () => (await import("electron")).safeStorage;
const keychain = async () => {
  const safeStorage = await storage();
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" ||
      safeStorage.getSelectedStorageBackend() !== "basic_text")
  );
};

// What a sealed file holds, from its bytes.
export const unseal = async <T>(saved: Buffer) =>
  JSON.parse(
    saved[0] === 0x7b
      ? saved.toString()
      : (await storage()).decryptString(saved),
  ) as T;

export const readSealed = async <T>(file: string): Promise<T | null> => {
  const saved = await readFile(file).catch(() => null);
  return saved ? unseal<T>(saved) : null;
};

// Each file's writes, in the order they were asked for.
const writes = new Map<string, Promise<unknown>>();

export const writeSealed = (file: string, value: unknown) => {
  const text = JSON.stringify(value);
  const write = (writes.get(file) ?? Promise.resolve())
    .catch(() => {})
    .then(async () =>
      writeFile(
        file,
        (await keychain()) ? (await storage()).encryptString(text) : text,
        { mode: 0o600 },
      ),
    );
  writes.set(file, write);
  return write;
};
