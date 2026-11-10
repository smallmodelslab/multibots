// How a webhook's sender proves a request is theirs. Any sender can show
// the webhook's key as `Authorization: Bearer <key>`. The popular senders
// that cannot set that header sign each request with a secret instead,
// checked here their way. For "Any" and GitHub the webhook makes the
// secret and the user gives it to the sender; Stripe, Slack and senders of
// Standard Webhooks make their own, which the user pastes into the
// webhook. On Web Crypto, for Multiwork's Convex and OpenBots' relay.

export type Sender = "bearer" | "github" | "stripe" | "slack" | "standard";

// What the user reads: the sender's name, what its secret is called,
// whether the webhook makes it (`ours`), and how to set the sender up.
export const senders: Record<
  Sender,
  { label: string; secret: string; ours: boolean; setup: string }
> = {
  bearer: {
    label: "Any (Bearer key)",
    secret: "Key",
    ours: true,
    setup: "Send it as Authorization: Bearer <key>.",
  },
  github: {
    label: "GitHub",
    secret: "Secret",
    ours: true,
    setup:
      "In GitHub's webhook settings, paste these as the Payload URL and the Secret, with content type application/json.",
  },
  stripe: {
    label: "Stripe",
    secret: "Signing secret",
    ours: false,
    setup:
      "In Stripe, add the URL as a webhook endpoint, then paste its signing secret here.",
  },
  slack: {
    label: "Slack",
    secret: "Signing secret",
    ours: false,
    setup:
      "Paste your Slack app's signing secret (Basic Information) here first, then the URL as its Event Subscriptions Request URL.",
  },
  standard: {
    label: "Standard Webhooks",
    secret: "Signing secret",
    ours: false,
    setup:
      "For Clerk, Resend, Polar, OpenAI and other senders of Standard Webhooks: add the URL as an endpoint there, then paste its signing secret here.",
  },
};

export const isSender = (value: unknown): value is Sender =>
  typeof value === "string" && Object.hasOwn(senders, value);

const encoder = new TextEncoder();

// Text as bytes on an ArrayBuffer, which Web Crypto's types ask for in the
// DOM's lib and Workers' alike.
const bytes = (text: string) => new Uint8Array(encoder.encode(text));

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const hmac = async (key: Uint8Array<ArrayBuffer>, text: string) =>
  new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await crypto.subtle.importKey(
        "raw",
        key,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
      bytes(text),
    ),
  );

// Equal, in a time that does not tell where two strings of one length
// differ.
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
};

// A signature's time, in seconds, within five minutes of now, so a request
// caught on its way cannot be sent again later.
const recent = (seconds: string | null, now: number) =>
  seconds !== null &&
  /^\d+$/.test(seconds) &&
  Math.abs(now / 1000 - Number(seconds)) <= 5 * 60;

// The keys a Standard Webhooks secret may sign with: the base64 after its
// `whsec_` (or all of it), as the standard has it, and its own bytes, as
// Polar signs. Either is the sender's.
const standardKeys = (secret: string) => {
  const keys = [bytes(secret)];
  try {
    keys.unshift(
      Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (char) =>
        char.charCodeAt(0),
      ),
    );
  } catch {
    // Not base64, so only its own bytes.
  }
  return keys;
};

const signed = async (
  sender: Sender,
  secret: string,
  headers: Headers,
  body: string,
  now: number,
) => {
  const key = bytes(secret);
  switch (sender) {
    case "bearer": {
      const shown = /^Bearer\s+(\S+)$/i.exec(
        headers.get("authorization") ?? "",
      )?.[1];
      return shown !== undefined && same(shown, secret);
    }
    case "github":
      return same(
        headers.get("x-hub-signature-256") ?? "",
        `sha256=${hex(await hmac(key, body))}`,
      );
    case "stripe": {
      const parts = (headers.get("stripe-signature") ?? "")
        .split(",")
        .map((part) => part.split("="));
      const at = parts.find(([name]) => name === "t")?.[1] ?? null;
      if (!recent(at, now)) return false;
      const expected = hex(await hmac(key, `${at}.${body}`));
      return parts.some(
        ([name, value]) => name === "v1" && same(value ?? "", expected),
      );
    }
    case "slack": {
      const at = headers.get("x-slack-request-timestamp");
      if (!recent(at, now)) return false;
      return same(
        headers.get("x-slack-signature") ?? "",
        `v0=${hex(await hmac(key, `v0:${at}:${body}`))}`,
      );
    }
    case "standard": {
      // Svix, which Clerk and Resend send through, names them svix-*.
      const header = (name: string) =>
        headers.get(`webhook-${name}`) ?? headers.get(`svix-${name}`);
      const id = header("id");
      const at = header("timestamp");
      if (!id || !recent(at, now)) return false;
      const expected = await Promise.all(
        standardKeys(secret).map(
          async (each) =>
            `v1,${btoa(String.fromCharCode(...(await hmac(each, `${id}.${at}.${body}`))))}`,
        ),
      );
      return (header("signature") ?? "")
        .split(" ")
        .some((signature) => expected.some((each) => same(signature, each)));
    }
  }
};

// Slack's check of a new Request URL, whose challenge is answered back.
const slackChallenge = (body: string) => {
  try {
    const { challenge, type } = JSON.parse(body) as Record<string, unknown>;
    return type === "url_verification" && typeof challenge === "string"
      ? challenge
      : null;
  } catch {
    return null;
  }
};

// What to do with a request to a webhook: "take" it; "refuse" it (401),
// as one not from its sender or before the user gave a sender's secret
// (`secret` null); or answer a sender's own check (Slack's URL
// verification, GitHub's ping) with 200 and `answer`, taking it no further.
export const check = async (
  sender: Sender,
  secret: string | null,
  headers: Headers,
  body: string,
  now = Date.now(),
): Promise<"take" | "refuse" | { answer: string }> => {
  try {
    if (secret === null || !(await signed(sender, secret, headers, body, now)))
      return "refuse";
  } catch {
    // A pasted secret that is not one, such as a whsec_ that is not base64.
    return "refuse";
  }
  if (sender === "github" && headers.get("x-github-event") === "ping")
    return { answer: "" };
  const challenge = sender === "slack" ? slackChallenge(body) : null;
  return challenge === null ? "take" : { answer: challenge };
};
