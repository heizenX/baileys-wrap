/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { WAMessage, proto } from '@whiskeysockets/baileys';
import {
	Message,
	MessageType,
	SenderProp,
	ContentProp,
	MediaProp,
	LocationProp,
	ContactProp,
	PollProp,
	EventProp,
	ReactionProp,
	MessageStatus,
	MentionsProp,
	QuotedMessage,
	DOWNLOADABLE_MEDIA,
} from '../types/message-types.js';

const REGEX_URL = /(https?:\/\/[^\s]+)/g;

// ============================================
// CONVERSION UTILITIES
// ============================================

function toNumber(timestamp: number | Long | null | undefined): number {
	if (!timestamp) return 0;
	return typeof timestamp === 'number' ? timestamp : timestamp.toNumber();
}

// ============================================
// CONTENT AND CONTEXT EXTRACTION
// ============================================

interface ContentExtractionResult {
	contentText: string;
	contextInfo: proto.IContextInfo | undefined | null;
}

function extractContentAndContext(msg: proto.IMessage, type: MessageType): ContentExtractionResult {
	let contentText = '';
	let contextInfo: proto.IContextInfo | undefined | null;

	if (type === 'text') {
		const isExtendedText = typeof msg.extendedTextMessage?.text === 'string';
		if (!isExtendedText) {
			contentText = msg.conversation!;
		} else {
			contentText = msg.extendedTextMessage!.text!;
			contextInfo = msg.extendedTextMessage!.contextInfo;
		}
	} else if (type === 'image') {
		contentText = msg.imageMessage!.caption ?? '';
		contextInfo = msg.imageMessage!.contextInfo;
	} else if (type === 'video') {
		contentText = msg.videoMessage!.caption ?? '';
		contextInfo = msg.videoMessage!.contextInfo;
	} else if (type === 'document') {
		contentText = msg.documentMessage!.caption ?? '';
		contextInfo = msg.documentMessage!.contextInfo;
	}

	return { contentText, contextInfo };
}

// ============================================
// PROPERTY CONSTRUCTION
// ============================================

function buildContentProp(text: string): ContentProp | undefined {
	if (!text) return undefined;
	return {
		text,
		hasLink: REGEX_URL.test(text),
	};
}

function buildMentions(contextInfo: proto.IContextInfo | undefined | null): MentionsProp {
	if (!contextInfo) return [];
	return contextInfo.nonJidMentions === 1 ? 'all' : (contextInfo.mentionedJid ?? []);
}

function buildLocationProp(locationMsg: proto.Message.ILocationMessage): LocationProp {
	return {
		latitude: locationMsg.degreesLatitude!,
		longitude: locationMsg.degreesLongitude!,
	};
}

function buildContactProp(contactMsg: proto.Message.IContactMessage): ContactProp {
	return {
		displayName: contactMsg.displayName!,
		vcard: contactMsg.vcard!,
	};
}

function buildPollProp(pollMsg: proto.Message.IPollCreationMessage): PollProp {
	return {
		name: pollMsg.name!,
		options: pollMsg.options!.map((opt) => opt.optionName!),
		multipleSelection: pollMsg.selectableOptionsCount === 0,
	};
}

function buildEventProp(eventMsg: proto.Message.IEventMessage): EventProp {
	const startTime = toNumber(eventMsg.startTime) * 1000;
	const endTime = toNumber(eventMsg.endTime) * 1000;
	const reminderOffsetSec = toNumber(eventMsg.reminderOffsetSec);

	return {
		name: eventMsg.name!,
		description: eventMsg.description ?? '',
		startTime: startTime,
		endTime: endTime === 0 ? undefined : endTime,
		isCanceled: eventMsg.isCanceled!,
		extraGuestsAllowed: eventMsg.extraGuestsAllowed ?? false,
		reminderOffsetSec: reminderOffsetSec === 0 ? undefined : reminderOffsetSec,
		location: eventMsg.location
			? {
					latitude: eventMsg.location.degreesLatitude ?? 0,
					longitude: eventMsg.location.degreesLongitude ?? 0,
					name: eventMsg.location.name ?? '',
				}
			: undefined,
	};
}

function buildReactionProp(reactionMessage: proto.Message.IReactionMessage): ReactionProp {
	return {
		text: reactionMessage.text!,
		targetMessageId: reactionMessage.key!.id!,
		targetMessageSenderId: (reactionMessage.key!.participant || reactionMessage.key!.remoteJid)!,
	};
}

// ============================================
// DETERMINATION OF TYPES
// ============================================

function isDownloadable(type: MessageType): boolean {
	return DOWNLOADABLE_MEDIA.has(type);
}

function getEditedMessageType(waMessage: WAMessage): MessageType {
	const msg = waMessage.message!;
	const editedMsg = msg.protocolMessage!.editedMessage!;

	if (editedMsg.conversation || editedMsg.extendedTextMessage) return 'text';
	if (editedMsg.imageMessage) return 'image';
	if (editedMsg.videoMessage) return 'video';
	if (editedMsg.documentMessage) return 'document';
	// stiker, audio, location, contact, poll and event cannot be edited

	return 'unknown';
}

function getQuotedMessageType(quotedMsg: proto.IMessage): MessageType {
	if (quotedMsg.conversation || quotedMsg.extendedTextMessage) return 'text';
	if (quotedMsg.imageMessage) return 'image';
	if (quotedMsg.videoMessage) return 'video';
	if (quotedMsg.audioMessage) return 'audio';
	if (quotedMsg.documentMessage) return 'document';
	if (quotedMsg.stickerMessage) return 'sticker';
	if (quotedMsg.locationMessage) return 'location';
	if (quotedMsg.contactMessage) return 'contact';
	if (quotedMsg.pollCreationMessage || quotedMsg.pollCreationMessageV3) return 'poll';
	if (quotedMsg.eventMessage) return 'event';

	return 'unknown';
}

// ============================================
// EXTRACCIÓN Y CONSTRUCCIÓN DE MENSAJES
// ============================================

function extractSender(waMessage: WAMessage): SenderProp {
	const key = waMessage.key;
	const participant = key.participant || key.remoteJid;
	const fromMe = key.fromMe || false;

	return {
		id: participant || '',
		name: waMessage.pushName ?? undefined,
		fromMe,
	};
}

interface MessagePropertiesResult {
	content?: ContentProp;
	location?: LocationProp;
	contact?: ContactProp;
	poll?: PollProp;
	event?: EventProp;
}

function extractMessageProperties(msg: proto.IMessage, type: MessageType): MessagePropertiesResult {
	const result: MessagePropertiesResult = {};

	if (type === 'location') {
		result.location = buildLocationProp(msg.locationMessage!);
	} else if (type === 'contact') {
		result.contact = buildContactProp(msg.contactMessage!);
	} else if (type === 'poll') {
		const pollMessage = (msg.pollCreationMessageV3 || msg.pollCreationMessage)!;
		result.poll = buildPollProp(pollMessage);
	} else if (type === 'event') {
		result.event = buildEventProp(msg.eventMessage!);
	}

	return result;
}

function extractMimetype(message: proto.IMessage): string {
	return (
		(message.imageMessage ||
			message.stickerMessage ||
			message.audioMessage ||
			message.videoMessage ||
			message.documentMessage)!.mimetype ?? ''
	);
}

function buildQuotedMessage(
	contextInfo: proto.IContextInfo,
	chatId: string,
): QuotedMessage | undefined {
	if (!contextInfo.quotedMessage) return undefined;

	const quotedMsg = contextInfo.quotedMessage;
	const type = getQuotedMessageType(quotedMsg);

	if (type === 'unknown') return undefined;

	const { contentText, contextInfo: nestedContextInfo } = extractContentAndContext(quotedMsg, type);
	const properties = extractMessageProperties(quotedMsg, type);

	const mentions = buildMentions(nestedContextInfo);
	const content = buildContentProp(contentText);

	const media: MediaProp | undefined = DOWNLOADABLE_MEDIA.has(type)
		? {
				url: {
					key: {
						remoteJid: chatId,
						fromMe: false, // Todo:
						id: contextInfo.stanzaId,
						participant: contextInfo.participant,
					},
					message: quotedMsg,
				},
				mimetype: extractMimetype(quotedMsg),
			}
		: undefined;

	return {
		id: contextInfo.stanzaId ?? '',
		sender: {
			id: contextInfo.participant ?? '',
			fromMe: false, // Todo:
		},
		type,
		content,
		media,
		mentions,
		...properties,
	};
}

// ============================================
// CONSTRUCCIÓN DE MENSAJES
// ============================================

interface FromMessageProps {
	type: MessageType;
	waMessage: WAMessage;
}

function fromNewMessage(props: FromMessageProps): Message {
	const { type, waMessage } = props;
	const id = waMessage.key.id || '';
	const chatId = waMessage.key.remoteJid || '';
	const sender = extractSender(waMessage);
	const timestamp = toNumber(waMessage.messageTimestamp) * 1000;

	const msg = waMessage.message!;

	// Extraer contenido y contexto
	const { contentText, contextInfo } = extractContentAndContext(msg, type);

	// Construir propiedades básicas
	const content = buildContentProp(contentText);
	const mentions = buildMentions(contextInfo);
	const quotedMessage = contextInfo ? buildQuotedMessage(contextInfo, chatId) : undefined;

	// Extraer propiedades específicas del tipo de mensaje
	const properties = extractMessageProperties(msg, type);

	// Manejar reacción (caso especial)
	let reaction: ReactionProp | undefined;
	if (type === 'reaction') {
		reaction = buildReactionProp(msg.reactionMessage!);
	}

	// Manejar media
	const media = isDownloadable(type)
		? { url: waMessage, mimetype: extractMimetype(msg) }
		: undefined;

	return {
		id,
		chatId,
		sender,
		status: 'new',
		type,
		content,
		media,
		reaction,
		mentions,
		timestamp: timestamp || Date.now(),
		quotedMessage,
		...properties,
		waMessage,
	};
}

function fromForwaredMessage(props: FromMessageProps): Message {
	return {
		...fromNewMessage(props),
		status: 'forwarded',
	};
}

function fromEditedMessage(props: FromMessageProps): Message {
	const { type, waMessage } = props;

	const id = waMessage.message!.protocolMessage!.key!.id ?? '';
	const chatId = waMessage.key.remoteJid || '';
	const sender = extractSender(waMessage);
	const timestamp = toNumber(waMessage.messageTimestamp) * 1000;

	const msg = waMessage.message!.protocolMessage!.editedMessage!;

	// Extraer contenido y contexto
	const { contentText, contextInfo } = extractContentAndContext(msg, type);

	// Construir propiedades
	const content = buildContentProp(contentText);
	const mentions = buildMentions(contextInfo);
	const quotedMessage = contextInfo ? buildQuotedMessage(contextInfo, chatId) : undefined;

	// Manejar media para mensajes editados
	const media = isDownloadable(type)
		? { url: waMessage, mimetype: extractMimetype(msg) }
		: undefined;

	return {
		id,
		chatId,
		sender,
		status: 'edited',
		type,
		content,
		media,
		mentions,
		timestamp,
		quotedMessage,
		waMessage,
	};
}

function fromDeletedMessage(props: FromMessageProps): Message {
	const { type, waMessage } = props;
	const msg = waMessage.message!;
	const id = msg.protocolMessage!.key!.id || waMessage.key.id || '';
	const chatId = waMessage.key.remoteJid || '';
	const sender = extractSender(waMessage);
	const timestamp = toNumber(waMessage.messageTimestamp) * 1000;
	let reaction: ReactionProp | undefined;

	if (type === 'reaction') {
		reaction = buildReactionProp(waMessage.message!.reactionMessage!);
	}

	return {
		id,
		chatId,
		sender,
		status: 'deleted',
		type,
		reaction,
		mentions: [],
		timestamp,
		waMessage,
	};
}

function getMessageInfo(m: WAMessage): {
	status: MessageStatus;
	type: MessageType;
} {
	const msg = m.message!;

	if (
		msg.editedMessage ||
		msg.protocolMessage?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT
	) {
		return {
			status: 'edited',
			type: getEditedMessageType(m),
		};
	}

	if (msg.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
		return {
			status: 'deleted',
			type: 'unknown',
		};
	}

	if (msg.conversation || msg.extendedTextMessage) {
		return {
			status: msg.extendedTextMessage?.contextInfo?.isForwarded ? 'forwarded' : 'new',
			type: 'text',
		};
	}

	if (msg.reactionMessage) {
		return {
			status: msg.reactionMessage.text ? 'new' : 'deleted',
			type: 'reaction',
		};
	}

	// MEDIA TYPES
	if (msg.imageMessage) {
		return {
			status: msg.imageMessage.contextInfo?.isForwarded ? 'forwarded' : 'new',
			type: 'image',
		};
	}

	if (msg.videoMessage) {
		return {
			status: msg.videoMessage.contextInfo?.isForwarded ? 'forwarded' : 'new',
			type: 'video',
		};
	}

	if (msg.audioMessage) {
		return {
			status: msg.audioMessage.contextInfo?.isForwarded ? 'forwarded' : 'new',
			type: 'audio',
		};
	}

	if (msg.documentMessage) {
		return {
			status: msg.documentMessage.contextInfo?.isForwarded ? 'forwarded' : 'new',
			type: 'document',
		};
	}

	if (msg.stickerMessage) {
		return {
			status: 'new',
			type: 'sticker',
		};
	}

	// LOCATION & CONTACT
	if (msg.locationMessage) {
		return {
			status: msg.locationMessage.contextInfo?.isForwarded ? 'forwarded' : 'new',
			type: 'location',
		};
	}

	if (msg.contactMessage) {
		return {
			status: msg.contactMessage.contextInfo?.isForwarded ? 'forwarded' : 'new',
			type: 'contact',
		};
	}

	// POLL & EVENT
	if (msg.pollCreationMessage || msg.pollCreationMessageV3) {
		return {
			status: 'new',
			type: 'poll',
		};
	}

	if (msg.eventMessage) {
		return {
			status: 'new',
			type: 'event',
		};
	}

	return {
		status: 'unknown',
		type: 'unknown',
	};
}

// ============================================
// PUBLIC EXPORTS
// ============================================

export function mapBaileysMessage(waMessage: WAMessage): Message | undefined {
	if (!waMessage.message) return;

	const messageInfo = getMessageInfo(waMessage);

	const props = {
		type: messageInfo.type,
		waMessage,
	};

	if (messageInfo.status === 'deleted') {
		return fromDeletedMessage(props);
	}

	if (messageInfo.status === 'unknown' || messageInfo.type === 'unknown') {
		return;
	}

	if (messageInfo.status === 'new') {
		return fromNewMessage(props);
	}

	if (messageInfo.status === 'forwarded') {
		return fromForwaredMessage(props);
	}

	if (messageInfo.status === 'edited') {
		return fromEditedMessage(props);
	}
}
