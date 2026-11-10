import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import "./wizard.css";

// A dialog that asks one thing at a time, opened from `trigger`, which focus
// returns to. What it asks is its children's; `title` names it for
// assistive technology. Its top row (`.wizard-top`) is the app's own, as
// it holds the app's back and close buttons.
export const WizardDialog = ({
  children,
  onOpenChange,
  open,
  title,
  trigger,
}: {
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
  trigger: Dialog.Trigger.Props["render"];
}) => (
  <Dialog.Root onOpenChange={onOpenChange} open={open}>
    <Dialog.Trigger render={trigger} />
    <Dialog.Portal>
      <Dialog.Backdrop className="wizard-backdrop" />
      <Dialog.Viewport className="wizard-viewport">
        <Dialog.Popup className="wizard">
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>
);

// Whether a wizard's content is still open, for what it started that
// finishes after it may have closed.
export const useStillOpen = () => {
  const open = useRef(false);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  return open;
};

// One step, sliding in from the side it was reached from; key it by the
// step so each one slides in anew.
export const WizardStep = ({
  children,
  className,
  direction = 1,
}: {
  children: ReactNode;
  className?: string;
  direction?: 1 | -1;
}) => (
  <div
    className={className ? `wizard-step ${className}` : "wizard-step"}
    style={{ "--from": `${direction * 28}px` } as CSSProperties}
  >
    {children}
  </div>
);

// How far along the steps are.
export const WizardDots = ({
  count,
  index,
}: {
  count: number;
  index: number;
}) => (
  <div aria-hidden="true" className="wizard-dots">
    {Array.from({ length: count }, (_, position) => (
      <span
        className={
          position === index
            ? "is-current"
            : position < index
              ? "is-done"
              : undefined
        }
        key={position}
      />
    ))}
  </div>
);
