# baileys-wrap

A thin abstraction layer over [Baileys](https://github.com/WhiskeySockets/Baileys) that replaces its raw, complex event system with a clean, strongly-typed API.

Instead of wrestling with verbose payloads, multiple events firing for the same user action, and deeply nested structures — `baileys-wrap` does that mapping once so you can focus on your bot's logic.

---

## Features

- Normalized `Message` type covering text, image, video, audio, document, sticker, location, contact, poll, event, and reaction
- Automatic detection of forwarded / edited / deleted messages
- Quoted message support including media download references
- Group metadata and permission events with intuitive boolean semantics
- Full TypeScript support — all events and payloads are strictly typed
- Two usage modes: managed session (`WhatsAppClient`) or bring-your-own-socket (`WhatsAppEventMapper`)

---

## Installation

```bash
pnpm add baileys-wrap @whiskeysockets/baileys
```

Baileys is a peer dependency — install it alongside this package.

> **Note:** Requires `@whiskeysockets/baileys >= 7.0.0-rc.9`. Not compatible with Baileys 6.x.

---

## Quick start

### Option A — Managed session (`WhatsAppClient`)

`WhatsAppClient` handles everything: auth state, QR generation, automatic reconnection, and credential cleanup on logout.

```ts
import { WhatsAppClient } from 'baileys-wrap';
import qrcode from 'qrcode-terminal';

const client = new WhatsAppClient();
await client.start();

client.on('session.qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('session.ready', () => console.log('Connected!'));

client.on('session.close', (reason) => {
	if (reason === 'logged_out') console.warn('Session revoked — waiting for new QR scan');
	else if (reason === 'reconnecting') console.warn('Connection lost — reconnecting...');
});

client.on('message.new', (msg) => {
	console.log(`[${msg.chatId}] ${msg.sender.id}: ${msg.content?.text}`);
});
```

### Option B — Bring your own socket (`WhatsAppEventMapper`)

Already managing the Baileys socket yourself? Plug in `WhatsAppEventMapper` directly:

```ts
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { WhatsAppEventMapper } from 'baileys-wrap';

const { state, saveCreds } = await useMultiFileAuthState('auth');
const sock = makeWASocket({ auth: state });
sock.ev.on('creds.update', saveCreds);

const mapper = new WhatsAppEventMapper(sock);
mapper.on('message.new', (msg) => console.log(msg));
```

---

## Custom auth state

By default credentials are stored on disk in `./baileys_auth_info`. To use a different backend, pass a factory function that returns a `WhatsAppAuthState` to the constructor.

A `WhatsAppAuthState` has three fields:

| Field          | Type                  | Description                              |
| -------------- | --------------------- | ---------------------------------------- |
| `state`        | `AuthenticationState` | Baileys auth state (creds + signal keys) |
| `saveCreds`    | `() => Promise<void>` | Called by Baileys on credential updates  |
| `clearSession` | `() => Promise<void>` | Called on logout to wipe stored data     |

> **Why a factory function?** After a logout the session is cleared and a fresh instance must be created — otherwise stale in-memory credentials would suppress the QR prompt on reconnect.

### PostgreSQL

A ready-to-use Postgres implementation is included:

```ts
import { WhatsAppClient, usePostgresAuthState } from 'baileys-wrap';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const client = new WhatsAppClient(() => usePostgresAuthState({ pool, sessionName: 'my-bot' }));

await client.start();
```

The table `whatsapp_auth` is created automatically on first run. Multiple sessions can share the same database — they are isolated by `sessionName`.

---

## Downloading media

When a message contains media, `msg.media.url` holds a `WAMessage` reference you can pass directly to Baileys' `downloadMediaMessage`:

```ts
import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';
import { mkdir, writeFile } from 'fs/promises';

client.on('message.new', async (msg) => {
	if (msg.type !== 'image' || !msg.media) return;

	const buffer = await downloadMediaMessage(msg.media.url as WAMessage, 'buffer', {});
	const ext = msg.media.mimetype.split('/')[1] ?? 'jpg';

	await mkdir('downloads', { recursive: true });
	await writeFile(`downloads/${msg.id}.${ext}`, buffer);
});
```

The same pattern works for **quoted message media** via `msg.quotedMessage?.media`.

---

## Type reference

### `Message`

| Field           | Type                | Description                                                                                 |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `id`            | `string`            | Unique message ID                                                                           |
| `chatId`        | `string`            | JID of the chat (individual or group)                                                       |
| `sender`        | `SenderProp`        | Who sent the message                                                                        |
| `status`        | `MessageStatus`     | `'new'` · `'forwarded'` · `'edited'` · `'deleted'`                                          |
| `type`          | `MessageType`       | See [message types](#messagetype) below                                                     |
| `timestamp`     | `number`            | Unix timestamp in **milliseconds**                                                          |
| `content`       | `ContentProp?`      | Present for text-bearing messages. Contains `text` and `hasLink`                            |
| `media`         | `MediaProp?`        | Present for `image`, `video`, `audio`, `document`, `sticker`. Contains `url` and `mimetype` |
| `mentions`      | `string[] \| 'all'` | Mentioned JIDs, or `'all'` for `@everyone`                                                  |
| `quotedMessage` | `QuotedMessage?`    | The message being replied to, if any                                                        |
| `reaction`      | `ReactionProp?`     | Present for `reaction` type                                                                 |
| `location`      | `LocationProp?`     | Present for `location` type                                                                 |
| `contact`       | `ContactProp?`      | Present for `contact` type                                                                  |
| `poll`          | `PollProp?`         | Present for `poll` type                                                                     |
| `event`         | `EventProp?`        | Present for `event` type                                                                    |
| `waMessage`     | `WAMessage`         | Raw Baileys message — always available as an escape hatch                                   |

### `MessageType`

`'text'` · `'image'` · `'video'` · `'audio'` · `'document'` · `'sticker'` · `'reaction'` · `'location'` · `'contact'` · `'poll'` · `'event'` · `'unknown'`

### `SenderProp`

| Field    | Type      | Description                             |
| -------- | --------- | --------------------------------------- |
| `id`     | `string`  | Sender JID                              |
| `name`   | `string?` | Push name (display name), if available  |
| `fromMe` | `boolean` | `true` when the message was sent by you |

---

## Event reference

### Session events (`WhatsAppClient` only)

| Event           | Payload                                                          | Description                                         |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `session.qr`    | `qr: string`                                                     | New QR code ready to scan. Rotates every ~20 s      |
| `session.ready` | —                                                                | Authenticated and connected                         |
| `session.close` | `reason: 'logged_out' \| 'reconnecting' \| 'connection_failure'` | Connection closed                                   |
| `session.error` | `error: Error`                                                   | Unrecoverable error (e.g. outdated Baileys version) |

### Message events

| Event             | Payload   | Description                                                                     |
| ----------------- | --------- | ------------------------------------------------------------------------------- |
| `message.new`     | `Message` | New inbound message                                                             |
| `message.forward` | `Message` | Forwarded message                                                               |
| `message.edit`    | `Message` | Edited message — `id` matches the original                                      |
| `message.delete`  | `Message` | Revoked message — `id` matches the original. Most payload fields will be absent |

### Group events

| Event                     | Payload                                      | Description                                  |
| ------------------------- | -------------------------------------------- | -------------------------------------------- |
| `group.update.metadata`   | `{ chatId, author, type, value? }`           | Name or description changed                  |
| `group.update.permission` | `{ chatId, author, permission, value }`      | Permission toggled                           |
| `group.update.members`    | `{ chatId, author, action, participants[] }` | Members added / removed / promoted / demoted |

#### `group.update.permission` — permission semantics

| `permission`     | `value: true`                          | `value: false`                    |
| ---------------- | -------------------------------------- | --------------------------------- |
| `canEdit`        | All members can edit group info        | Only admins can edit group info   |
| `sendMessages`   | All members can send messages          | Only admins can send messages     |
| `addMembers`     | All members can add others             | Only admins can add members       |
| `approveMembers` | New members **require** admin approval | New members join without approval |

> `approveMembers` is the exception: `value: true` means approval is **required** (more restrictive).

---

## License

[MIT](./LICENSE.md)
