import type { WAMessage } from '@whiskeysockets/baileys';

export type MessageStatus = 'new' | 'forwarded' | 'edited' | 'deleted' | 'unknown';

export type MessageType =
	| 'text'
	| 'sticker'
	| 'image'
	| 'audio'
	| 'video'
	| 'document'
	| 'reaction'
	| 'location'
	| 'contact'
	| 'poll'
	| 'event'
	| 'unknown';

export type MentionsProp = string[] | 'all';

export const DOWNLOADABLE_MEDIA = new Set<MessageType>([
	'sticker',
	'image',
	'audio',
	'video',
	'document',
]);

export interface SenderProp {
	id: string;
	name?: string;
	fromMe: boolean;
}

export interface MediaProp {
	url: WAMessage | string;
	mimetype: string;
}

export interface ContentProp {
	text: string;
	hasLink: boolean;
}

export interface LocationProp {
	latitude: number;
	longitude: number;
}

export interface ContactProp {
	displayName: string;
	vcard: string;
}

export interface PollProp {
	name: string;
	options: string[];
	multipleSelection: boolean;
}

export interface EventProp {
	name: string;
	description: string;
	startTime: number;
	endTime?: number;
	isCanceled: boolean;
	extraGuestsAllowed: boolean;
	joinLink?: string;
	reminderOffsetSec?: number;
	location?: LocationProp & { name?: string };
}

export interface ReactionProp {
	text: string;
	targetMessageId: string;
	targetMessageSenderId: string;
}

export interface QuotedMessage {
	id: string;
	sender: SenderProp;
	type: MessageType;
	content?: ContentProp;
	media?: MediaProp; // in the url we should construct a fake WAMessage based on the quoted message
	location?: LocationProp;
	contact?: ContactProp;
	poll?: PollProp;
	event?: EventProp;
	mentions: MentionsProp;
}

export interface Message {
	id: string;
	chatId: string;
	sender: SenderProp;
	status: MessageStatus;
	type: MessageType;
	content?: ContentProp;
	media?: MediaProp;
	reaction?: ReactionProp;
	location?: LocationProp;
	contact?: ContactProp;
	poll?: PollProp;
	event?: EventProp;
	mentions: MentionsProp;
	timestamp: number;
	quotedMessage?: QuotedMessage;
	waMessage: WAMessage;
}
