// Client
export { WhatsAppClient } from './whatsapp-client.js';
export type { WhatsAppClientEvents, WhatsAppAuthStateFactory } from './whatsapp-client.js';

// Event Mapper (for advanced usage with a custom WASocket)
export { WhatsAppEventMapper } from './whatsapp-event-mapper.js';
export type { WhatsAppEvents } from './whatsapp-event-mapper.js';

// Types
export type {
	Message,
	MessageType,
	MessageStatus,
	MentionsProp,
	SenderProp,
	ContentProp,
	MediaProp,
	LocationProp,
	ContactProp,
	PollProp,
	EventProp,
	ReactionProp,
	QuotedMessage,
} from './types/message-types.js';
export { DOWNLOADABLE_MEDIA } from './types/message-types.js';

// Auth
export { useWaAuthState, usePostgresAuthState } from './utils/use-whatsapp-auth-state.js';
export type { WhatsAppAuthState } from './utils/use-whatsapp-auth-state.js';

// Mappers
export { mapBaileysMessage } from './mappers/message-mapper.js';
