import { cn } from "@/lib/utils";
import { Button } from "./button";

// A row of tabs, each a quiet button, the one on lit.
export function Tabs<T extends string>({
  className,
  onChange,
  tabs,
  value,
}: {
  className?: string;
  onChange: (tab: T) => void;
  tabs: readonly (readonly [T, string])[];
  value: T;
}) {
  return (
    <div className={cn("flex gap-0.5", className)}>
      {tabs.map(([each, label]) => (
        <Button
          aria-pressed={value === each}
          className={cn(
            "px-3",
            value === each
              ? "bg-[color-mix(in_oklab,var(--text)_6%,transparent)] text-foreground"
              : "text-muted-foreground",
          )}
          key={each}
          onClick={() => onChange(each)}
          size="sm"
          variant="ghost"
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
