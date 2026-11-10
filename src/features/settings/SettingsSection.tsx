import type { ReactNode } from "react";

// A group of settings: its name, with an action for the whole group beside
// it, then its rows on one card.
export const SettingsSection = ({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
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
    <div className="settings-card">{children}</div>
  </section>
);
