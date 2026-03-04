import { downloadMediaMessage, WAMessage } from '@whiskeysockets/baileys';
import { WhatsAppClient } from '../src/whatsapp-client.js';
import qrcode from 'qrcode-terminal';
import { mkdir, writeFile } from 'fs/promises';
import { Pool } from 'pg';
import { usePostgresAuthState } from '../src/utils/use-whatsapp-auth-state.js';

async function main(): Promise<void> {
	// Opción A: WhatsAppClient gestiona la sesión
	const pool = new Pool({
		connectionString: process.env.DATABASE_URL,
	});

	const client = new WhatsAppClient(() =>
		usePostgresAuthState({ pool, sessionName: 'my-session' }),
	);
	await client.start();

	client.on('session.qr', (qr) => {
		console.log('📱 Scan QR code to login');
		qrcode.generate(qr, { small: true });
	});

	client.on('session.ready', () => {
		console.log('✅ WhatsApp ready');
	});

	client.on('session.error', (error: Error) => {
		console.error(error.message);
	});

	client.on('session.close', (reason) => {
		if (reason === 'logged_out') {
			console.warn('⚠️  Logged out from WhatsApp');
		} else if (reason === 'reconnecting') {
			console.warn('⚠️  Connection closed, reconnecting...');
		}
	});

	client.on('message.new', async (msg) => {
		if (msg.type !== 'image' || !msg.media) return;

		const buffer = await downloadMediaMessage(msg.media.url as WAMessage, 'buffer', {});

		const ext = msg.media.mimetype.split('/')[1] ?? 'jpg';
		const dir = 'downloads';
		const filename = `${dir}/${msg.id}.${ext}`;

		await mkdir(dir, { recursive: true });
		await writeFile(filename, buffer);
		console.log(`Saved image → ${filename}`);
	});

	client.on('message.forward', (msg) => {
		console.log('forwarded:', msg.id);
	});

	client.on('message.edit', (msg) => {
		console.log('edited:', msg.id);
	});

	client.on('message.delete', (msg) => {
		console.log('deleted:', msg.id);
	});

	// Opción B: el desarrollador trae su propio WASocket
	// const sock = makeWASocket({ ... });
	// const mapper = new WhatsAppEventMapper(sock);
	//
	// mapper.on('message.new', (msg) => { ... });
	// mapper.on('message.edit', (msg) => { ... });
}

main().catch(console.error);
