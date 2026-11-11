# App Privacy

Answers for App Store Connect → App Privacy, worked out from the phone
app (`mobile/app`, `mobile/src`) and the desktop protocol it shares
(`src/shared`). Enter them again when what the app collects changes.

## Tracking

No.

## Data collected

**Identifiers → Device ID**: App Functionality, not linked to the person, not
used for tracking. The label reads "Data Not Linked to You". The app takes
JavaScript updates through EAS Update (`expo-updates`), and each check of
Expo's update server carries a random install ID (`EAS-Client-ID`) with the
platform and runtime version. Nothing else is collected.

The phone has no account, no analytics, no crash reporting and no server of
ours. Everything it sends goes to the user's own computers or, during a
ChatGPT voice call, to OpenAI under the user's own ChatGPT account. Apple
counts data as collected only when the developer or its partners can get
at it, and neither applies:

- **The user's computers.** Messages, photos and files the user picks,
  routine edits, and their voice on calls that use the user's own speech
  models go over Tailscale to Multibots on the user's own Macs or Linux
  computers (`src/shared/peer.ts`, `mobile/src/data.ts`), which hold the
  bots. The live screen is a WebRTC stream from that computer to the phone
  over the tailnet.
- **OpenAI, on a ChatGPT voice call.** The user's computer places the call
  with its own ChatGPT sign-in, and the phone's microphone audio then goes
  straight to OpenAI over WebRTC (`mobile/src/voice.ts`,
  `src/main/voice.ts`). It is the user's own ChatGPT account and only while
  they are on a call they started; we have no access to it and no
  agreement with OpenAI for it. If you prefer to declare it anyway: User
  Content → Audio Data, App Functionality, not linked, not tracking.
- **On the phone only.** The computers' Tailscale addresses
  (`computers.json`) and the pairing code (`pairing.json`) stay in the
  app's documents folder.
