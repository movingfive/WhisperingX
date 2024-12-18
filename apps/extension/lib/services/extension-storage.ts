import { Storage, type StorageWatchCallback } from '@plasmohq/storage';
import { Err, Ok, parseJson, recorderStateSchema } from '@repo/shared';
import { z } from 'zod';
import { renderErrorAsNotification } from '~lib/errors';

/**
 * Shared state keys used for communication between extension components:
 * - Content Scripts (injected into web pages)
 * - Popup (extension popup UI)
 * - Background Service Worker
 *
 * These keys are used with the Storage API to maintain synchronized state
 * across all extension contexts. Changes to these values will trigger
 * updates in all listening components.
 *
 * @example
 * ```ts
 * // In popup
 * const [recorderState] = useStorage<RecorderState>(SHARED_STATE_KEYS.RECORDER_STATE);
 *
 * // In background service worker
 * await storage.set(SHARED_STATE_KEYS.RECORDER_STATE, 'RECORDING');
 * ```
 */

export const SHARED_EXTENSION_STATE_KEYS = {
	RECORDER_STATE: 'whispering-recorder-state',
	LATEST_RECORDING_TRANSCRIBED_TEXT:
		'whispering-latest-recording-transcribed-text',
	SETTINGS: 'whispering-settings',
} as const;

const storage = new Storage();

const createSetter = <TSchema extends z.ZodSchema, A = z.infer<TSchema>>({
	key,
	schema,
}: {
	key: string;
	schema: TSchema;
}) => {
	return { set: (value: A) => storage.set(key, value) };
};

export const extensionStorageService = {
	[SHARED_EXTENSION_STATE_KEYS.RECORDER_STATE]: createSetter({
		key: SHARED_EXTENSION_STATE_KEYS.RECORDER_STATE,
		schema: recorderStateSchema,
	}),
	[SHARED_EXTENSION_STATE_KEYS.LATEST_RECORDING_TRANSCRIBED_TEXT]: createSetter(
		{
			key: SHARED_EXTENSION_STATE_KEYS.LATEST_RECORDING_TRANSCRIBED_TEXT,
			schema: z.string(),
		},
	),
} as const;
