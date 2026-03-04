import { WASocket } from '@whiskeysockets/baileys';
import EventEmitter from 'events';
import { mapBaileysMessage } from './mappers/message-mapper.js';
import { Message } from './types/message-types.js';

export interface WhatsAppEvents {
	// Messages
	'message.new': (message: Message) => void;
	'message.forward': (message: Message) => void;
	'message.edit': (message: Message) => void;
	'message.delete': (message: Message) => void;

	// Note: The events cannot be heard clearly
	// Chats (individual and groups)
	// 'chat.archive': (data: { chatId: string; isArchived: boolean }) => void;
	// 'chat.pin': (data: { chatId: string; isPinned: boolean }) => void;
	// 'chat.mute': (data: { chatId: string; until: number | null }) => void;
	// 'chat.ephemeral': (data: { chatId: string; duration: number }) => void;

	// Groups
	'group.update.metadata': (data: {
		chatId: string;
		author: string;
		type: 'name' | 'description' | 'icon' | 'inviteCode';
		value?: string;
	}) => void;

	'group.update.permission': (data: {
		chatId: string;
		author: string;
		permission: 'canEdit' | 'sendMessages' | 'addMembers' | 'approveMembers';
		value: boolean;
	}) => void;

	'group.update.members': (data: {
		chatId: string;
		author: string;
		action: 'add' | 'remove' | 'promote' | 'demote' | 'modify';
		participants: { id: string; phoneNumber: string; isAdmin: boolean }[];
	}) => void;
}

// ============================================
// INTERNAL EMIT HELPER TYPE
// ============================================

type EmitFn = <K extends keyof WhatsAppEvents>(
	event: K,
	data: Parameters<WhatsAppEvents[K]>[0],
) => void;

// ============================================
// CHAT MAPPERS
// ============================================

// function bindChatEvents(sock: WASocket, emit: EmitFn): void {
// 	sock.ev.on('chats.update', (updates) => {
// 		for (const update of updates) {
// 			const chatId = update.id;
// 			if (!chatId) continue;

// 			if ('archived' in update) {
// 				emit('chat.archive', { chatId, isArchived: update.archived ?? false });
// 			}

// 			if ('pinned' in update) {
// 				emit('chat.pin', { chatId, isPinned: update.pinned != null && update.pinned > 0 });
// 			}

// 			if ('muteEndTime' in update) {
// 				// muteEndTime: positive number → muted until (ms), -1 → permanent mute, null → unmuted
// 				const raw = update.muteEndTime;
// 				const until = raw == null || raw < 0 ? null : raw;
// 				emit('chat.mute', { chatId, until });
// 			}

// 			if ('ephemeralExpiration' in update && update.ephemeralExpiration != null) {
// 				emit('chat.ephemeral', { chatId, duration: update.ephemeralExpiration });
// 			}
// 		}
// 	});
// }

// ============================================
// GROUP MAPPERS
// ============================================

function bindGroupEvents(sock: WASocket, emit: EmitFn): void {
	sock.ev.on('groups.update', (updates) => {
		for (const update of updates) {
			const chatId = update.id ?? '';
			const author = update.author ?? '';

			// Metadata changes
			if (update.subject != null) {
				emit('group.update.metadata', { chatId, author, type: 'name', value: update.subject });
			}
			if (update.desc != null) {
				emit('group.update.metadata', { chatId, author, type: 'description', value: update.desc });
			}

			// Permission changes
			// restrict: true → only admins can edit group info → members canEdit=false
			if (update.restrict != null) {
				emit('group.update.permission', {
					chatId,
					author,
					permission: 'canEdit',
					value: !update.restrict,
				});
			}
			// announce: true → only admins can send messages → members sendMessages=false
			if (update.announce != null) {
				emit('group.update.permission', {
					chatId,
					author,
					permission: 'sendMessages',
					value: !update.announce,
				});
			}
			// memberAddMode: true → any member can add others
			if (update.memberAddMode != null) {
				emit('group.update.permission', {
					chatId,
					author,
					permission: 'addMembers',
					value: update.memberAddMode,
				});
			}
			// joinApprovalMode: true → new members must be approved by an admin
			if (update.joinApprovalMode != null) {
				emit('group.update.permission', {
					chatId,
					author,
					permission: 'approveMembers',
					value: update.joinApprovalMode,
				});
			}
		}
	});

	sock.ev.on('group-participants.update', ({ id, author, participants, action }) => {
		emit('group.update.members', {
			chatId: id,
			author,
			action,
			participants: participants.map((p) => {
				if (typeof p === 'string') {
					return { id: p, phoneNumber: '', isAdmin: false };
				}
				const participant = p as { id: string; phoneNumber?: string; admin?: string | null };
				return {
					id: participant.id,
					phoneNumber: participant.phoneNumber ?? '',
					isAdmin: participant.admin != null,
				};
			}),
		});
	});
}

/**
 * Maps raw Baileys socket events into strongly-typed domain events.
 *
 * Receives an already-authenticated {@link WASocket} and translates its low-level
 * event stream into a clean, predictable API. Does **not** manage authentication,
 * reconnection, or credentials — those are the caller's responsibility.
 *
 * @example
 * ```ts
 * const mapper = new WhatsAppEventMapper(sock);
 *
 * mapper.on('message.new', (message) => {
 *   console.log('New message from', message.sender.id);
 * });
 *
 * mapper.on('group.update.members', ({ chatId, action, participants }) => {
 *   console.log(`${action} in ${chatId}:`, participants);
 * });
 * ```
 *
 * @see {@link WhatsAppClient} for the high-level client that manages the full lifecycle.
 */
export class WhatsAppEventMapper extends EventEmitter {
	constructor(private readonly sock: WASocket) {
		super();
		this.bindSocketEvents();
	}

	private bindSocketEvents(): void {
		// Typed helper so bindChatEvents / bindGroupEvents keep strong typing
		// without reaching into class internals directly.
		const emitEvent: EmitFn = (event, data) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			this.emit(event, data as any);
		};

		this.sock.ev.on('messages.upsert', ({ messages, type }) => {
			if (type !== 'notify') return;

			for (const waMessage of messages) {
				const mapped = mapBaileysMessage(waMessage);
				if (!mapped) continue;

				switch (mapped.status) {
					case 'new':
						this.emit('message.new', mapped);
						break;
					case 'forwarded':
						this.emit('message.forward', mapped);
						break;
					case 'edited':
						this.emit('message.edit', mapped);
						break;
					case 'deleted':
						this.emit('message.delete', mapped);
						break;
				}
			}
		});

		// bindChatEvents(this.sock, emitEvent);
		bindGroupEvents(this.sock, emitEvent);
	}

	on<K extends keyof WhatsAppEvents>(event: K, listener: WhatsAppEvents[K]): this {
		return super.on(event, listener);
	}

	once<K extends keyof WhatsAppEvents>(event: K, listener: WhatsAppEvents[K]): this {
		return super.once(event, listener);
	}

	off<K extends keyof WhatsAppEvents>(event: K, listener: WhatsAppEvents[K]): this {
		return super.off(event, listener);
	}

	emit<K extends keyof WhatsAppEvents>(event: K, ...args: Parameters<WhatsAppEvents[K]>): boolean {
		return super.emit(event, ...args);
	}
}
