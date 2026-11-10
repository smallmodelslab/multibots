import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";

import {
  uploadLimits,
  type Attachment,
  type Upload,
} from "../../src/shared/types";
import { call } from "./data";

// A file of a bot's, as a data URL, read once from a server.
const dataUrls = new Map<string, string>();
export const useDataUrl = (
  botId: string,
  file: Pick<Attachment, "path" | "type">,
) => {
  const key = `${botId}:${file.path}`;
  const [url, setUrl] = useState(() => dataUrls.get(key) ?? null);
  useEffect(() => {
    if (dataUrls.has(key)) return;
    let current = true;
    call({ botId, path: file.path, type: "file.read" }).then(
      (data) => {
        const value = `data:${file.type};base64,${data}`;
        dataUrls.set(key, value);
        if (current) setUrl(value);
      },
      // Gone since it was sent.
      () => {},
    );
    return () => {
      current = false;
    };
  }, [botId, file.path, file.type, key]);
  return url;
};

// A file of a bot's opened in Quick Look, from a copy on the phone.
export const openFile = async (botId: string, path: string) => {
  const data = await call({ botId, path, type: "file.read" });
  const folder = new Directory(Paths.cache, "files", botId);
  folder.create({ idempotent: true, intermediates: true });
  const file = new File(folder, path.split("/").pop()!);
  await file.write(data, { encoding: "base64" });
  await file.preview();
};

const tooLarge = (bytes: number) => bytes > uploadLimits.bytes;
const sizeError = () =>
  new Error(`Each file can be at most ${uploadLimits.bytes / 1024 / 1024} MB.`);

export const pickPhotos = async (room: number): Promise<Upload[]> => {
  const picked = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: true,
    base64: true,
    mediaTypes: ["images"],
    quality: 0.85,
    selectionLimit: room,
  });
  if (picked.canceled) return [];
  if (picked.assets.some((asset) => tooLarge(asset.fileSize ?? 0)))
    throw sizeError();
  // The picker gives every photo as JPEG, whatever it was.
  return picked.assets.map((asset, index) => ({
    data: asset.base64!,
    name: `${asset.fileName?.replace(/\.[^.]*$/, "") ?? `Photo ${index + 1}`}.jpg`,
    type: "image/jpeg",
  }));
};

export const pickFiles = async (): Promise<Upload[]> => {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (picked.canceled) return [];
  if (picked.assets.some((asset) => tooLarge(asset.size ?? 0)))
    throw sizeError();
  return Promise.all(
    picked.assets.map(async (asset) => ({
      data: await new File(asset.uri).base64(),
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream",
    })),
  );
};
