import type { ReactNode } from "react";

// A part of a bot's details, under its name.
export const Section = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <section className="flex flex-col gap-2">
    <h3 className="m-0 text-[13px] font-medium text-muted-foreground">
      {title}
    </h3>
    <div className="flex flex-col gap-3">{children}</div>
  </section>
);
