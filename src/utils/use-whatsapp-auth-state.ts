/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters */
import {
	AuthenticationState,
	useMultiFileAuthState,
	initAuthCreds,
	BufferJSON,
	proto,
	AuthenticationCreds,
	SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { rm } from 'fs/promises';
import { join } from 'path';
import { Pool } from 'pg';

export interface WhatsAppAuthState {
	state: AuthenticationState;
	saveCreds: () => Promise<void>;
	clearSession: () => Promise<void>;
}

export const useWaAuthState = async (props: {
	sessionName: string;
}): Promise<WhatsAppAuthState> => {
	const { sessionName } = props;

	const multiFileAuthState = await useMultiFileAuthState(sessionName);

	const clearSession = async (): Promise<void> => {
		try {
			const fullPath = join(process.cwd(), sessionName);
			await rm(fullPath, { recursive: true, force: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Error al limpiar el directorio de sesión: ${message}`);
		}
	};

	return { ...multiFileAuthState, clearSession };
};

// ---------------------------------------------------------------------------
// POSTGRES IMPLEMENTATION
// ---------------------------------------------------------------------------

export interface PostgresAuthStateProps {
	/**
	 * An existing `pg.Pool` instance.
	 * The caller is responsible for creating and closing the pool.
	 */
	pool: Pool;

	/**
	 * Identifier for the session. Allows multiple WhatsApp sessions
	 * to coexist in the same database.
	 */
	sessionName: string;
}

// ---------------------------------------------------------------------------
// SQL helpers
// Uses pool.query() directly so each query gets its own connection from the
// pool, avoiding the "client already executing a query" deprecation warning
// that occurs when a single PoolClient runs multiple queries in parallel.
// ---------------------------------------------------------------------------

const TABLE = 'whatsapp_auth';

async function ensureTable(pool: Pool): Promise<void> {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS ${TABLE} (
			session_name TEXT   NOT NULL,
			key          TEXT   NOT NULL,
			value        TEXT   NOT NULL,
			PRIMARY KEY (session_name, key)
		)
	`);
}

async function readRow(pool: Pool, sessionName: string, key: string): Promise<string | null> {
	const result = await pool.query<{ value: string }>(
		`SELECT value FROM ${TABLE} WHERE session_name = $1 AND key = $2`,
		[sessionName, key],
	);
	return result.rows[0]?.value ?? null;
}

async function upsertRow(
	pool: Pool,
	sessionName: string,
	key: string,
	value: string,
): Promise<void> {
	await pool.query(
		`INSERT INTO ${TABLE} (session_name, key, value)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (session_name, key) DO UPDATE SET value = EXCLUDED.value`,
		[sessionName, key, value],
	);
}

async function deleteRow(pool: Pool, sessionName: string, key: string): Promise<void> {
	await pool.query(`DELETE FROM ${TABLE} WHERE session_name = $1 AND key = $2`, [sessionName, key]);
}

async function deleteAllRows(pool: Pool, sessionName: string): Promise<void> {
	await pool.query(`DELETE FROM ${TABLE} WHERE session_name = $1`, [sessionName]);
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function serialize(value: unknown): string {
	return JSON.stringify(value, BufferJSON.replacer);
}

function deserialize<T>(raw: string): T {
	return JSON.parse(raw, BufferJSON.reviver) as T;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Baileys `AuthenticationState` backed by a PostgreSQL table.
 *
 * Creates the table `whatsapp_auth` automatically on the first call.
 * Each session is isolated by `sessionName`, so multiple WhatsApp sessions
 * can share the same database.
 *
 * @example
 * ```ts
 * import { Pool } from 'pg';
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const authState = await usePostgresAuthState({ pool, sessionName: 'my-session' });
 * const client = new WhatsAppClient(authState);
 * await client.start();
 * ```
 */
export const usePostgresAuthState = async (
	props: PostgresAuthStateProps,
): Promise<WhatsAppAuthState> => {
	const { pool, sessionName } = props;

	await ensureTable(pool);

	// -----------------------------------------------------------------------
	// Load or initialise credentials
	// -----------------------------------------------------------------------

	const loadCreds = async (): Promise<AuthenticationCreds> => {
		const raw = await readRow(pool, sessionName, 'creds');
		return raw ? deserialize<AuthenticationCreds>(raw) : initAuthCreds();
	};

	const creds = await loadCreds();

	// -----------------------------------------------------------------------
	// Signal key store
	// -----------------------------------------------------------------------

	const keys: AuthenticationState['keys'] = {
		get: async <T extends keyof SignalDataTypeMap>(
			type: T,
			ids: string[],
		): Promise<Record<string, SignalDataTypeMap[T]>> => {
			const result: Record<string, SignalDataTypeMap[T]> = {};

			await Promise.all(
				ids.map(async (id) => {
					const raw = await readRow(pool, sessionName, `${type}:${id}`);
					if (!raw) return;

					let value = deserialize<SignalDataTypeMap[T]>(raw);

					if (type === 'app-state-sync-key' && value) {
						value = proto.Message.AppStateSyncKeyData.fromObject(
							value as Record<string, unknown>,
						) as unknown as SignalDataTypeMap[T];
					}

					result[id] = value;
				}),
			);

			return result;
		},

		set: async (
			data: Partial<{
				[K in keyof SignalDataTypeMap]: Record<string, SignalDataTypeMap[K] | null>;
			}>,
		): Promise<void> => {
			await Promise.all(
				(Object.entries(data) as [keyof SignalDataTypeMap, Record<string, unknown>][]).map(
					async ([type, ids]) => {
						await Promise.all(
							Object.entries(ids).map(async ([id, value]) => {
								const dbKey = `${type}:${id}`;
								if (value) {
									await upsertRow(pool, sessionName, dbKey, serialize(value));
								} else {
									await deleteRow(pool, sessionName, dbKey);
								}
							}),
						);
					},
				),
			);
		},
	};

	// -----------------------------------------------------------------------
	// saveCreds — persists only the creds object
	// -----------------------------------------------------------------------

	const saveCreds = async (): Promise<void> => {
		await upsertRow(pool, sessionName, 'creds', serialize(creds));
	};

	// -----------------------------------------------------------------------
	// clearSession — removes all rows for this session
	// -----------------------------------------------------------------------

	const clearSession = async (): Promise<void> => {
		try {
			await deleteAllRows(pool, sessionName);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Error al limpiar la sesión de WhatsApp en PostgreSQL: ${message}`);
		}
	};

	// -----------------------------------------------------------------------

	return {
		state: { creds, keys },
		saveCreds,
		clearSession,
	};
};
