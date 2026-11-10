import { Alert } from "react-native";

import type { Bot } from "../../src/shared/types";
import { botsKey, call, messageOf, store } from "./data";

export const showError = (error: unknown) =>
  Alert.alert("Something went wrong", messageOf(error));

// Shows a change at once, ahead of the computer; if the computer refuses
// it, says why and reads what it has again.
export const change = <T>(
  key: string,
  edit: (value: T) => T,
  request: Promise<unknown>,
) => {
  store.patch(key, edit);
  request.catch((error: unknown) => {
    store.refresh(key);
    showError(error);
  });
};

export const pin = (bot: Bot, pinned: boolean) =>
  change<Bot[]>(
    botsKey,
    (list) =>
      list.map((each) =>
        each.id === bot.id
          ? { ...each, pinnedAt: pinned ? Date.now() : null }
          : each,
      ),
    call({ botId: bot.id, pinned, type: "bot.update" }),
  );

// Asks first; true once the bot is gone.
export const remove = (bot: Bot) =>
  new Promise<boolean>((done) =>
    Alert.alert(
      `Delete ${bot.name}?`,
      "Its conversation, routines and files go with it.",
      [
        { onPress: () => done(false), style: "cancel", text: "Cancel" },
        {
          onPress: () =>
            call({ botId: bot.id, type: "bot.delete" }).then(
              () => done(true),
              (error: unknown) => {
                showError(error);
                done(false);
              },
            ),
          style: "destructive",
          text: "Delete",
        },
      ],
    ),
  );
