import type { ReactNode } from "react";

// One setting: what it is, where it stands, and at most a couple of short
// actions that never wrap.
export const SettingRow = ({
  action,
  children,
  detail,
  detailId,
  label,
  mono = false,
}: {
  action?: ReactNode;
  // Anything shown under the row, such as a form or a notice.
  children?: ReactNode;
  detail?: ReactNode;
  // For an action the detail explains, such as why it is disabled.
  detailId?: string;
  label: ReactNode;
  mono?: boolean;
}) => (
  <div className="setting">
    <div className="setting-row">
      <div className="setting-label">{label}</div>
      <div
        className={mono ? "setting-detail is-mono" : "setting-detail"}
        id={detailId}
      >
        {detail}
      </div>
      {action ? <div className="setting-action">{action}</div> : null}
    </div>
    {children}
  </div>
);
