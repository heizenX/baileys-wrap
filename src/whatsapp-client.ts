/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
import makeWASocket, {
	ConnectionState,
	DisconnectReason,
	GroupMetadata,
	WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';

import { WhatsAppAuthState, useWaAuthState } from './utils/use-whatsapp-auth-state.js';
import EventEmitter from 'events';
import { Boom } from '@hapi/boom';
import { WhatsAppEventMapper, WhatsAppEvents } from './whatsapp-event-mapper.js';
import NodeCache from '@cacheable/node-cache';

const CLIENT_DEPS = ['pino', '@cacheable/node-cache'] as const;

async function assertClientDeps(): Promise<void> {
	const missing: string[] = [];

	for (const dep of CLIENT_DEPS) {
		try {
			await import(dep);
		} catch {
			missing.push(dep);
		}
	}

	if (missing.length > 0) {
		throw new Error(
			`WhatsAppClient requires optional dependencies that are not installed:\n` +
				missing.map((d) => `  - ${d}`).join('\n'),
		);
	}
}

/**
 * A factory function that creates a fresh {@link WhatsAppAuthState}.
 * Called once on `start()` and again after each logout so that credentials
 * are always loaded from the source of truth (disk, DB, etc.) rather than
 * from a stale in-memory object.
 */
export type WhatsAppAuthStateFactory = () => Promise<WhatsAppAuthState>;

export interface WhatsAppClientEvents extends WhatsAppEvents {
	'session.qr': (qr: string) => void;
	'session.ready': () => void;
	'session.close': (reason: 'logged_out' | 'reconnecting' | 'connection_failure') => void;
	'session.error': (error: Error) => void;
}

/**
 * High-level WhatsApp client that manages the full session lifecycle:
 * authentication, QR generation, reconnection, and cleanup.
 *
 * Internally creates a {@link WhatsAppEventMapper} once the connection is open
 * and re-emits all domain events upward, so consumers only need to interact
 * with this class.
 *
 * By default, credentials are persisted to disk under `baileys_auth_info/`.
 * Pass a {@link WhatsAppAuthStateFactory} to the constructor to override this
 * (e.g. for database-backed sessions).
 *
 * **Why a factory instead of a plain `WhatsAppAuthState`?**
 * After a logout the session is cleared and a fresh auth state must be created
 * so that Baileys starts from scratch and requests a new QR code. Passing a
 * pre-built instance would keep stale credentials in memory and suppress the
 * QR prompt on reconnect.
 *
 * @example
 * ```ts
 * const client = new WhatsAppClient();
 *
 * client.on('session.qr', (qr) => {
 *   // Render QR code for the user to scan
 * });
 *
 * client.on('session.ready', () => {
 *   console.log('WhatsApp connected!');
 * });
 *
 * client.on('message.new', (message) => {
 *   console.log(message.sender.id, ':', message.content?.text);
 * });
 *
 * await client.start();
 * ```
 *
 * @example Using a custom auth state factory (e.g. database-backed):
 * ```ts
 * const client = new WhatsAppClient(() =>
 *   usePostgresAuthState({ pool, sessionName: 'my-session' })
 * );
 * await client.start();
 * ```
 */
export class WhatsAppClient extends EventEmitter {
	private sock: WASocket | null = null;
	private mapper: WhatsAppEventMapper | null = null;
	private isConnected = false;
	private waAuthState!: WhatsAppAuthState;
	private groupCache: NodeCache<GroupMetadata>;

	constructor(private readonly authStateFactory?: WhatsAppAuthStateFactory) {
		super();
		this.groupCache = new NodeCache({ stdTTL: 300, useClones: false });
	}

	async start(): Promise<void> {
		await assertClientDeps();
		await this.initializeAuthState();
		this.connectToWhatsApp();
	}

	private async initializeAuthState(): Promise<void> {
		this.waAuthState = this.authStateFactory
			? await this.authStateFactory()
			: await useWaAuthState({ sessionName: 'baileys_auth_info' });
	}

	private connectToWhatsApp(): void {
		this.sock = makeWASocket({
			logger: pino({ level: 'silent' }),
			printQRInTerminal: false,
			auth: this.waAuthState.state,
			// eslint-disable-next-line @typescript-eslint/require-await
			cachedGroupMetadata: async (jid) => this.groupCache.get(jid),
		});

		this.setupInternalEventHandlers();
	}

	private setupInternalEventHandlers(): void {
		if (!this.sock) return;

		this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
			await this.handleConnectionUpdate(update);
		});

		this.sock.ev.on('creds.update', this.waAuthState.saveCreds);

		this.sock.ev.on('groups.update', (updates) => {
			for (const update of updates) {
				if (update.id) {
					const cached = this.groupCache.get(update.id);
					if (cached) {
						this.groupCache.set(update.id, { ...cached, ...update });
					}
				}
			}
		});

		this.sock.ev.on('group-participants.update', async ({ id }) => {
			try {
				const metadata = await this.sock!.groupMetadata(id);
				this.groupCache.set(id, metadata);
			} catch {
				this.groupCache.del(id);
			}
		});
	}

	private setupMapper(): void {
		if (!this.sock) return;

		this.mapper = new WhatsAppEventMapper(this.sock);

		// Re-emit all domain events upward
		const domainEvents: (keyof WhatsAppEvents)[] = [
			'message.new',
			'message.forward',
			'message.edit',
			'message.delete',
			// 'chat.archive',
			// 'chat.pin',
			// 'chat.mute',
			// 'chat.ephemeral',
			// 'group.update.medatada',
			'group.update.permission',
			'group.update.members',
		];

		for (const event of domainEvents) {
			this.mapper.on(event, (...args: unknown[]) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				super.emit(event, ...(args as [any]));
			});
		}
	}

	private async handleConnectionUpdate(update: Partial<ConnectionState>): Promise<void> {
		const { connection, lastDisconnect, qr } = update;

		if (qr) {
			this.emit('session.qr', qr);
		}

		if (connection === 'close') {
			await this.handleConnectionClose(lastDisconnect);
		} else if (connection === 'open') {
			this.handleConnectionOpen();
		}
	}

	private async handleConnectionClose(
		lastDisconnect?: ConnectionState['lastDisconnect'],
	): Promise<void> {
		this.isConnected = false;

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

		// WhatsApp rejected the connection — likely an outdated Baileys version.
		// Do not attempt to reconnect; surface the error to the developer instead.
		if (statusCode === 405) {
			const error = new Error(
				`WhatsApp rejected the connection with status 405 (Method Not Allowed). ` +
					`This usually means the Baileys version is outdated and no longer supported by WhatsApp. ` +
					`Original error: ${lastDisconnect?.error?.message ?? 'unknown'}`,
			);
			this.emit('session.error', error);
			this.emit('session.close', 'connection_failure');
			return;
		}

		const isLoggedOut = statusCode === DisconnectReason.loggedOut;

		if (isLoggedOut) {
			this.emit('session.close', 'logged_out');
			await this.logout();
		} else {
			this.emit('session.close', 'reconnecting');
			await this.start();
		}
	}

	private handleConnectionOpen(): void {
		this.isConnected = true;
		this.setupMapper();
		this.emit('session.ready');
	}

	async logout(): Promise<void> {
		await this.performLogout();
		await this.cleanupSession();
		this.resetState();

		// Delay to let WhatsApp servers process the logout before reconnecting
		setTimeout(() => void this.start(), 1000);
	}

	private async performLogout(): Promise<void> {
		if (this.sock && this.isConnected) {
			try {
				await this.sock.logout();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error('Logout from WhatsApp failed, but continuing cleanup: ' + message);
			}
		}
		this.sock = null;
		this.mapper = null;
	}

	private async cleanupSession(): Promise<void> {
		await this.waAuthState.clearSession();
	}

	private resetState(): void {
		this.isConnected = false;
	}

	getSocket(): WASocket | null {
		return this.sock;
	}

	isReady(): boolean {
		return this.isConnected && this.sock !== null;
	}

	on<K extends keyof WhatsAppClientEvents>(event: K, listener: WhatsAppClientEvents[K]): this {
		return super.on(event, listener);
	}

	once<K extends keyof WhatsAppClientEvents>(event: K, listener: WhatsAppClientEvents[K]): this {
		return super.once(event, listener);
	}

	off<K extends keyof WhatsAppClientEvents>(event: K, listener: WhatsAppClientEvents[K]): this {
		return super.off(event, listener);
	}

	emit<K extends keyof WhatsAppClientEvents>(
		event: K,
		...args: Parameters<WhatsAppClientEvents[K]>
	): boolean {
		return super.emit(event, ...args);
	}
}
