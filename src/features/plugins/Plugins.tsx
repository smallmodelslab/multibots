import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { Plugin, PluginsState } from "../../shared/types";
import { bridge, messageOf } from "../data";
import { SettingRow } from "../settings/SettingRow";
import { SettingsSection } from "../settings/SettingsSection";
import { Hint } from "../shell/Hint";
import { CloseIcon } from "../shell/icons";
import { toastError } from "../shell/Toasts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PlaceholderBar } from "../ui/placeholder";
import { Spinner } from "../ui/spinner";
import "./plugins.css";

// The apps this computer's bots reach through Composio: once there is a
// Composio key, those connected first, then every other app Composio
// offers, which connect with a sign-in in the browser.

type Catalog = { query: string; plugins: Plugin[]; cursor: string | null };

// What the page last showed, so opening it again shows that at once while
// it asks Composio again.
let shown: { connected: Plugin[]; catalog: Catalog } | null = null;

const ComposioKey = () => {
  const id = useId();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true);
    setProblem(null);
    bridge.setComposioKey(key).catch((error: unknown) => {
      setBusy(false);
      setProblem(messageOf(error));
    });
  };
  return (
    <SettingsSection title="Composio">
      <form className="setting" onSubmit={submit}>
        <div className="setting-row">
          <label className="setting-label" htmlFor={id}>
            API key
          </label>
          <div className="setting-detail">
            <Input
              autoComplete="off"
              autoFocus
              disabled={busy}
              id={id}
              onChange={(event) => {
                setKey(event.currentTarget.value);
                setProblem(null);
              }}
              type="password"
              value={key}
            />
          </div>
          <div className="setting-action">
            <Button disabled={busy || !key.trim()} size="sm" type="submit">
              <Spinner spinning={busy} />
              Save
            </Button>
          </div>
        </div>
        <p className="m-0 pb-2.5 text-muted-foreground">
          {problem ? (
            <span className="text-destructive" role="alert">
              {problem}
            </span>
          ) : (
            <>
              Connects your bots to apps like Gmail, Slack and GitHub.{" "}
              <a
                className="text-[var(--link)] no-underline hover:underline"
                href="https://platform.composio.dev"
                rel="noreferrer"
                target="_blank"
              >
                Get a key
              </a>
            </>
          )}
        </p>
      </form>
    </SettingsSection>
  );
};

const PluginLogo = ({ plugin }: { plugin: Plugin }) => {
  const [broken, setBroken] = useState(false);
  return plugin.logo && !broken ? (
    <img
      alt=""
      className="plugin-logo"
      draggable={false}
      onError={() => setBroken(true)}
      src={plugin.logo}
    />
  ) : (
    <span aria-hidden className="plugin-logo is-letter">
      {plugin.name.slice(0, 1)}
    </span>
  );
};

const statusText = {
  connected: "Connected",
  needsReconnecting: "Sign in again",
  notConnected: null,
};

// An app: connected ones show where they stand and disconnect from the ×
// on hover; any other connects on a click.
const PluginTile = ({
  onConnect,
  onDisconnect,
  pending,
  plugin,
}: {
  onConnect: () => void;
  onDisconnect: (() => void) | null;
  pending: boolean;
  plugin: Plugin;
}) => {
  const body = (
    <>
      <PluginLogo plugin={plugin} />
      <span className="plugin-text">
        <span className="plugin-name">{plugin.name}</span>
        {pending || statusText[plugin.status] ? (
          <span className="plugin-status">
            {pending ? "Finish in your browser" : statusText[plugin.status]}
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <div className="plugin hover-actions">
      {plugin.status === "connected" ? (
        <div className="plugin-body">{body}</div>
      ) : (
        <button className="plugin-body glow" onClick={onConnect} type="button">
          {body}
        </button>
      )}
      {onDisconnect ? (
        <Hint label="Disconnect">
          <button
            aria-label={`Disconnect ${plugin.name}`}
            className="icon-button hover-action plugin-remove"
            onClick={onDisconnect}
            type="button"
          >
            <CloseIcon />
          </button>
        </Hint>
      ) : null}
    </div>
  );
};

const PlaceholderTiles = () => (
  <>
    {Array.from({ length: 12 }, (_, index) => (
      <div className="plugin" key={index}>
        <div className="plugin-body">
          <PlaceholderBar height={28} round row={index} width={28} />
          <PlaceholderBar height={12} row={index} width="60%" />
        </div>
      </div>
    ))}
  </>
);

const Catalog = ({ connecting }: { connecting: string[] }) => {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [connected, setConnected] = useState(shown?.connected ?? null);
  const [catalog, setCatalog] = useState(shown?.catalog ?? null);
  // What went wrong loading each, until it loads.
  const [connectedError, setConnectedError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const loadingMore = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Those connected, again whenever a sign-in starts or ends.
  const signIns = connecting.join(" ");
  useEffect(() => {
    let current = true;
    bridge.plugins({ connected: true, cursor: null, search: "" }).then(
      ({ plugins }) => {
        if (!current) return;
        setConnected(plugins);
        setConnectedError(null);
      },
      (failure: unknown) => current && setConnectedError(messageOf(failure)),
    );
    return () => {
      current = false;
    };
  }, [signIns]);

  useEffect(() => {
    let current = true;
    bridge.plugins({ connected: false, cursor: null, search: query }).then(
      ({ cursor, plugins }) => {
        if (!current) return;
        setCatalog({ cursor, plugins, query });
        setCatalogError(null);
      },
      (failure: unknown) => current && setCatalogError(messageOf(failure)),
    );
    return () => {
      current = false;
    };
  }, [query]);

  useEffect(() => {
    if (connected && catalog && !catalog.query) shown = { catalog, connected };
  }, [catalog, connected]);

  // More load on their own as the end comes near.
  useEffect(() => {
    const node = end.current;
    if (!node || !catalog?.cursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || loadingMore.current) return;
        loadingMore.current = true;
        bridge
          .plugins({ connected: false, cursor: catalog.cursor, search: query })
          .then(
            ({ cursor, plugins }) =>
              setCatalog((last) =>
                last === catalog
                  ? { ...last, cursor, plugins: [...last.plugins, ...plugins] }
                  : last,
              ),
            (failure: unknown) => toastError(messageOf(failure)),
          )
          .finally(() => {
            loadingMore.current = false;
          });
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [catalog, query]);

  const connect = (plugin: Plugin) =>
    void bridge
      .connectPlugin(plugin.slug)
      .catch((failure: unknown) => toastError(messageOf(failure)));
  const disconnect = (plugin: Plugin) => {
    setConnected((last) =>
      last ? last.filter((each) => each.slug !== plugin.slug) : last,
    );
    bridge.disconnectPlugin(plugin.slug).catch((failure: unknown) => {
      toastError(messageOf(failure));
      setConnected((last) => (last ? [plugin, ...last] : last));
    });
  };

  const matches = (plugin: Plugin) =>
    !query ||
    `${plugin.name} ${plugin.slug}`.toLowerCase().includes(query.toLowerCase());
  const ready = connected && catalog?.query === query;
  const error = connectedError ?? catalogError;
  const slugs = new Set(connected?.map((plugin) => plugin.slug));
  const listed = ready
    ? [
        ...connected.filter(matches),
        ...catalog.plugins
          .filter((plugin) => !slugs.has(plugin.slug))
          .map((plugin) => ({ ...plugin, status: "notConnected" as const })),
      ]
    : [];
  return (
    <>
      <input
        aria-label="Search apps"
        className="plugins-search"
        onChange={(event) => setSearch(event.currentTarget.value)}
        placeholder="Search apps"
        value={search}
      />
      {error && !ready ? (
        <p className="m-0 text-destructive">{error}</p>
      ) : ready && !listed.length ? (
        <p className="m-0 text-muted-foreground">No apps found</p>
      ) : (
        <div className="plugins-grid">
          {ready ? (
            listed.map((plugin) => (
              <PluginTile
                key={plugin.slug}
                onConnect={() => connect(plugin)}
                onDisconnect={
                  slugs.has(plugin.slug) ? () => disconnect(plugin) : null
                }
                pending={
                  connecting.includes(plugin.slug) &&
                  plugin.status !== "connected"
                }
                plugin={plugin}
              />
            ))
          ) : (
            <PlaceholderTiles />
          )}
        </div>
      )}
      <div ref={end} />
    </>
  );
};

export const Plugins = ({ plugins }: { plugins: PluginsState }) => (
  <div className="pane settings-pane">
    <div className="settings-scroll">
      <div className="settings plugins">
        {plugins.composio ? (
          <>
            <Catalog connecting={plugins.connecting} />
            <SettingsSection title="Composio">
              <SettingRow
                action={
                  <Button
                    onClick={() => {
                      shown = null;
                      void bridge
                        .setComposioKey("")
                        .catch((failure: unknown) =>
                          toastError(messageOf(failure)),
                        );
                    }}
                    size="sm"
                    variant="destructive"
                  >
                    Remove
                  </Button>
                }
                detail="Kept on this computer"
                label="API key"
              />
            </SettingsSection>
          </>
        ) : (
          <ComposioKey />
        )}
      </div>
    </div>
  </div>
);
