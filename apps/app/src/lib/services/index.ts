import type { Accessor } from '$lib/query/types';
import type { Result } from '@epicenterhq/result';
import type { MaybePromise, WhisperingSoundNames } from '@repo/shared';
import {
	type CreateMutationOptions,
	type CreateQueryOptions,
	type DefaultError,
	type QueryKey,
	createMutation,
	createQuery,
} from '@tanstack/svelte-query';
import { settings } from '../stores/settings.svelte';
import { createSetTrayIconDesktopService } from './SetTrayIconService';
import { createClipboardServiceDesktop } from './clipboard/ClipboardService.desktop';
import { createHttpServiceDesktop } from './http/HttpService.desktop';
// import { createRecorderServiceTauri } from './recorder/RecorderService.tauri';
import { createRecorderServiceWeb } from './recorder/RecorderService.web';
import { createRunTransformationService } from './runTransformation';
import { createPlaySoundServiceDesktop } from './sound/PlaySoundService.desktop';
import { createFasterWhisperServerTranscriptionService } from './transcription/TranscriptionService.fasterWhisperServer';
import { createGroqTranscriptionService } from './transcription/TranscriptionService.groq';
import { createOpenaiTranscriptionService } from './transcription/TranscriptionService.openai';

type QueryResultFunction<TData, TError> = () => MaybePromise<
	Result<TData, TError>
>;

export function createResultQuery<
	TQueryFnData = unknown,
	TError = DefaultError,
	TData = TQueryFnData,
	TQueryKey extends QueryKey = QueryKey,
>(
	options: Accessor<
		Omit<
			CreateQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
			'queryFn'
		> & {
			queryFn: QueryResultFunction<TQueryFnData, TError>;
		}
	>,
) {
	return createQuery<TQueryFnData, TError, TData, TQueryKey>(() => {
		const { queryFn, ...optionValues } = options();
		return {
			...optionValues,

			queryFn: async () => {
				const result = await queryFn();
				if (!result.ok) throw result.error;
				return result.data;
			},
		};
	});
}

export function createResultMutation<
	TData = unknown,
	TError = DefaultError,
	TVariables = void,
	TContext = unknown,
>(
	options: Accessor<
		Omit<
			CreateMutationOptions<TData, TError, TVariables, TContext>,
			'mutationFn'
		> & {
			mutationFn: (
				variables: TVariables,
			) => MaybePromise<Result<TData, TError>>;
		}
	>,
) {
	return createMutation<TData, TError, TVariables, TContext>(() => {
		const { mutationFn, ...optionValues } = options();
		return {
			...optionValues,
			mutationFn: async (args) => {
				const result = await mutationFn(args);
				if (!result.ok) throw result.error;
				return result.data;
			},
		};
	});
}

export const ClipboardService = createClipboardServiceDesktop();

export const SetTrayIconService = createSetTrayIconDesktopService();

const HttpService = createHttpServiceDesktop();

const PlaySoundService = createPlaySoundServiceDesktop();

export const RunTransformationService = createRunTransformationService({
	HttpService,
});

/**
 * Services that are determined by the user's settings.
 */
export const userConfiguredServices = (() => {
	// const RecorderServiceTauri = createRecorderServiceTauri();
	const RecorderServiceWeb = createRecorderServiceWeb();

	return {
		get transcription() {
			switch (settings.value['transcription.selectedTranscriptionService']) {
				case 'OpenAI': {
					return createOpenaiTranscriptionService({
						HttpService,
						apiKey: settings.value['apiKeys.openai'],
					});
				}
				case 'Groq': {
					return createGroqTranscriptionService({
						HttpService,
						apiKey: settings.value['apiKeys.groq'],
						modelName: settings.value['transcription.groq.model'],
					});
				}
				case 'faster-whisper-server': {
					return createFasterWhisperServerTranscriptionService({
						HttpService,
						serverModel:
							settings.value['transcription.fasterWhisperServer.serverModel'],
						serverUrl:
							settings.value['transcription.fasterWhisperServer.serverUrl'],
					});
				}
				default: {
					return createOpenaiTranscriptionService({
						HttpService,
						apiKey: settings.value['apiKeys.openai'],
					});
				}
			}
		},
		get recorder() {
			// if (settings.value['recorder.selectedRecorderService'] === 'Tauri') {
			// 	return RecorderServiceTauri;
			// }
			return RecorderServiceWeb;
		},
	};
})();

export const playSoundIfEnabled = (soundName: WhisperingSoundNames) => {
	if (!settings.value['sound.enabled']) {
		return;
	}

	switch (soundName) {
		case 'start-vad':
			void PlaySoundService.playSound(soundName);
			break;
		case 'start':
		case 'start-manual':
			void PlaySoundService.playSound(soundName);
			break;
		case 'on-stopped-voice-activated-session':
			void PlaySoundService.playSound(soundName);
			break;
		case 'stop':
		case 'stop-manual':
			void PlaySoundService.playSound(soundName);
			break;
		case 'cancel':
			void PlaySoundService.playSound(soundName);
			break;
		case 'transcriptionComplete':
			void PlaySoundService.playSound(soundName);
			break;
	}
};
