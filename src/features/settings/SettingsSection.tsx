import type { ReactNode } from "react";

// A group of settings: its name, with an action for the whole group beside
// it and a line on how it works under it, then its rows on one card.
export const SettingsSection = ({
  action,
  children,
  note,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  note?: string;
  title: string;
}) => (
  <section
    className="settings-section"
    data-title={title}
    id={`settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
  >
    <div className="settings-section-head">
      <h2>{title}</h2>
      {action}
    </div>
    {note ? <p className="settings-section-note">{note}</p> : null}
    <div className="settings-card">{children}</div>
  </section>
);
