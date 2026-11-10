import { Hint } from "./Hint";
import { ChevronLeftIcon } from "./icons";

export const BackButton = ({
  label = "Back",
  onBack,
  shortcut,
  side,
}: {
  label?: string;
  onBack: () => void;
  shortcut?: string;
  side?: "top" | "bottom";
}) => (
  <Hint label={label} shortcut={shortcut} side={side}>
    <button
      aria-label={label}
      className="icon-button"
      onClick={onBack}
      type="button"
    >
      <ChevronLeftIcon />
    </button>
  </Hint>
);
