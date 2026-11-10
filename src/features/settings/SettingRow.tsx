import type { ReactNode } from "react";

// One setting: what it is, where it stands, and at most a couple of short
// actions that never wrap.
export const SettingRow = ({
  action,
  children,
  detail,
  label,
  mono = false,
}: {
  action?: ReactNode;
  // Anything shown under the row, such as a form or a notice.
  children?: ReactNode;
  detail?: ReactNode;
  label: ReactNode;
  mono?: boolean;
}) => (
  <div className="setting">
    <div className="setting-row">
      <div className="setting-label">{label}</div>
      <div className={mono ? "setting-detail is-mono" : "setting-detail"}>
        {detail}
      </div>
      {action ? <div className="setting-action">{action}</div> : null}
    </div>
    {children}
  </div>
);
