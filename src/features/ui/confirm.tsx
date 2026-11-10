import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";

type Ask = {
  /** The red word that goes ahead, such as "Delete". */
  action: string;
  /** What else goes with it, when the title doesn't say. */
  detail?: string;
  title: string;
};

type Question = Ask & { answer: (yes: boolean) => void };

let ask: ((question: Question) => void) | null = null;

/** Asks before something that can't be undone, in the app rather than the
    browser's own dialog, which an iOS web view never shows. Resolves true
    once the user picks `action`, drawn as red text. */
export const confirm = (question: Ask) =>
  new Promise<boolean>((answer) => {
    if (ask) ask({ ...question, answer });
    else answer(false);
  });

/** Where `confirm` asks; placed once in each app. */
export function Confirmations() {
  const [question, setQuestion] = useState<Question | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    ask = (next) => {
      setQuestion((previous) => {
        previous?.answer(false);
        return next;
      });
      setOpen(true);
    };
    return () => {
      ask = null;
    };
  }, []);
  const settle = (yes: boolean) => {
    question?.answer(yes);
    setOpen(false);
  };
  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
      open={open}
    >
      {question ? (
        <AlertDialogContent className="gap-5 p-5" size="sm">
          <AlertDialogHeader className="place-items-start text-left">
            <AlertDialogTitle>{question.title}</AlertDialogTitle>
            {question.detail ? (
              <AlertDialogDescription>{question.detail}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="secondary">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              variant="destructive"
            >
              {question.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );
}
