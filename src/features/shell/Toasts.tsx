import { Toast } from "@base-ui/react/toast";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { CloseIcon } from "./icons";

const manager = Toast.createToastManager();

// Says that something went wrong, at the bottom of the window, until it times
// out or is dismissed. The same message again shows once, with its time
// reset.
export const toastError = (message: string) =>
  manager.add({ description: message, id: message });

export const toastAction = (
  message: string,
  label: string,
  action: () => void,
) => {
  let used = false;
  const id = manager.add({
    description: message,
    actionProps: {
      children: label,
      onClick: () => {
        if (used) return;
        used = true;
        manager.close(id);
        action();
      },
    },
  });
  return () => manager.close(id);
};

export const ToastProvider = ({ children }: { children: ReactNode }) => (
  <Toast.Provider timeout={6000} toastManager={manager}>
    {children}
  </Toast.Provider>
);

// Where toasts show: wherever this is placed, which positions them.
export const Toasts = () => (
  <Toast.Viewport className="toast-viewport">
    <ToastList />
  </Toast.Viewport>
);

const ToastList = () =>
  Toast.useToastManager().toasts.map((toast) => (
    <Toast.Root
      className="toast"
      key={toast.id}
      swipeDirection="down"
      toast={toast}
    >
      <Toast.Content className="toast-content">
        <Toast.Description className="toast-message" />
        <Toast.Action render={<Button size="sm" variant="ghost" />} />
        <Toast.Close aria-label="Dismiss" className="icon-button toast-close">
          <CloseIcon />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
