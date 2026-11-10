import { Dialog } from "@base-ui/react/dialog";

import { BackButton } from "./BackButton";
import { Hint } from "./Hint";
import { CloseIcon } from "./icons";

// Back, where there is a step to go back to, and close.
export const WizardTop = ({ onBack }: { onBack?: (() => void) | null }) => (
  <div className="wizard-top">
    {onBack ? <BackButton onBack={onBack} /> : <span />}
    <Hint label="Close">
      <Dialog.Close aria-label="Close" className="icon-button">
        <CloseIcon />
      </Dialog.Close>
    </Hint>
  </div>
);
