import {
  Composer as SharedComposer,
  type ComposerProps,
} from "@wrkrsh/composer";
import { Spinner } from "../ui/spinner";
import { Hint } from "./Hint";
export type { ComposerProps, ComposerChip } from "@wrkrsh/composer";

export const Composer = (props: ComposerProps) => (
  <SharedComposer
    {...props}
    renderHint={(label, child) => <Hint label={label}>{child}</Hint>}
    renderSpinner={(spinning) => (
      <Spinner className="size-3 text-muted-foreground" spinning={spinning} />
    )}
  />
);
