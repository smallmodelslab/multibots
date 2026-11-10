import { useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { spin } from "../shell/spin";

/** Turns in whole rotations while `spinning`: it eases up to speed, and
    once the work is done it finishes the turn it's on, eases to rest and
    goes, rather than vanishing mid-turn. It keeps turning when less motion
    is asked for, since it says work is going on. */
function Spinner({
  spinning = true,
  className,
  ...props
}: React.ComponentProps<"svg"> & { spinning?: boolean }) {
  const [shown, setShown] = useState(spinning);
  const [element, setElement] = useState<SVGSVGElement | null>(null);
  const control = useMemo(() => (element ? spin(element) : null), [element]);
  if (spinning && !shown) setShown(true);
  useEffect(() => {
    if (!control) return;
    if (spinning) control.start();
    else void control.stop().then(() => setShown(false));
  }, [control, spinning]);
  useEffect(() => () => control?.cancel(), [control]);
  if (!shown) return null;
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4", className)}
      ref={setElement}
      {...props}
    />
  );
}

export { Spinner };
