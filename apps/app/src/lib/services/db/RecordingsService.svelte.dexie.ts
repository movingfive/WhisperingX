import { Ok, tryAsync } from '@epicenterhq/result';
import type { Settings } from '@repo/shared';
import Dexie, { type Transaction } from 'dexie';
import { toast } from '../../utils/toast';
import type {
	DbService,
	PipelineRun,
	Transformation,
	TransformationResult,
} from './RecordingsService';
import { DbServiceErr } from './RecordingsService';
import { moreDetailsDialog } from '$lib/components/MoreDetailsDialog.svelte';
import { DownloadService } from '$lib/services.svelte';
import { nanoid } from 'nanoid/non-secure';

const DB_NAME = 'RecordingDB';
const DB_VERSION = 4;

export type Recording = RecordingsDbSchemaV4['recordings'];

export type RecordingsDbSchemaV4 = {
	recordings: Omit<RecordingsDbSchemaV3['recordings'], 'timestamp'> & {
		createdAt: string;
		updatedAt: string;
	};
	/**
	 * A transformation is a reusable text transformation that can be used in multiple pipelines.
	 * The actual order and pipeline-specific settings are stored in pipelineTransformations.
	 */
	transformations: {
		id: string;
		name: string;
		description: string;
		createdAt: string;
		updatedAt: string;

		type: 'find_replace' | 'prompt_transform';

		'find_replace.findText': string;
		'find_replace.replaceText': string;
		'find_replace.useRegex': boolean;

		'prompt_transform.model': string;
		'prompt_transform.systemPromptTemplate': string;
		'prompt_transform.userPromptTemplate': string;
	};
	pipelines: {
		id: string;
		title: string;
		description: string;
		createdAt: string;
		updatedAt: string;
		transformations: {
			transformationId: string;
			enabled: boolean;
		}[];
	};
	pipelineRuns: {
		id: string;
		pipelineId: string;
		recordingId: string;
		/**
		 * The input to the pipeline is the transcribed text of the recording.
		 */
		input: string;
		status: 'running' | 'completed' | 'failed';
		startedAt: string;
		completedAt: string | null;
		error: string | null;
		output: string | null;
	};
	transformationResults: {
		id: string;
		pipelineRunId: string;
		transformationId: string;
		status: 'running' | 'completed' | 'failed';
		startedAt: string;
		completedAt: string | null;
		error: string | null;
		output: string | null;
	};
};

type RecordingsDbSchemaV3 = {
	recordings: RecordingsDbSchemaV1['recordings'];
};

type RecordingsDbSchemaV2 = {
	recordingMetadata: Omit<RecordingsDbSchemaV1['recordings'], 'blob'>;
	recordingBlobs: { id: string; blob: Blob | undefined };
};

type RecordingsDbSchemaV1 = {
	recordings: {
		id: string;
		title: string;
		subtitle: string;
		timestamp: string;
		transcribedText: string;
		blob: Blob | undefined;
		/**
		 * A recording
		 * 1. Begins in an 'UNPROCESSED' state
		 * 2. Moves to 'TRANSCRIBING' while the audio is being transcribed
		 * 3. Finally is marked as 'DONE' when the transcription is complete.
		 */
		transcriptionStatus: 'UNPROCESSED' | 'TRANSCRIBING' | 'DONE';
	};
};

class RecordingsDatabase extends Dexie {
	recordings!: Dexie.Table<RecordingsDbSchemaV4['recordings'], string>;
	pipelines!: Dexie.Table<RecordingsDbSchemaV4['pipelines'], string>;
	transformations!: Dexie.Table<
		RecordingsDbSchemaV4['transformations'],
		string
	>;
	pipelineRuns!: Dexie.Table<RecordingsDbSchemaV4['pipelineRuns'], string>;
	transformationResults!: Dexie.Table<
		RecordingsDbSchemaV4['transformationResults'],
		string
	>;

	constructor() {
		super(DB_NAME);

		const handleUpgradeError = async ({
			tx,
			version,
			error,
		}: { tx: Transaction; version: number; error: unknown }) => {
			const DUMP_TABLE_NAMES = [
				'recordings',
				'recordingMetadata',
				'recordingBlobs',
			] as const;

			const dumpTable = async (tableName: string) => {
				try {
					const contents = await tx.table(tableName).toArray();
					return contents;
				} catch (error) {
					return [];
				}
			};

			const dumps = await Promise.all(
				DUMP_TABLE_NAMES.map((name) => dumpTable(name)),
			);

			const dumpState = {
				version,
				tables: Object.fromEntries(
					DUMP_TABLE_NAMES.map((name, i) => [name, dumps[i]]),
				),
			};

			const dumpString = JSON.stringify(dumpState, null, 2);

			moreDetailsDialog.open({
				title: `Failed to upgrade IndexedDb Database to version ${version}`,
				description:
					'Please download the database dump and delete the database to start fresh.',
				content: dumpString,
				buttons: [
					{
						label: 'Delete Database',
						onClick: async () => {
							try {
								// Delete all tables
								await Promise.all(
									DUMP_TABLE_NAMES.map((name) => tx.table(name).clear()),
								);
								// Delete the database
								await this.delete();
								// Reset the version
								await Dexie.delete(DB_NAME);
								toast.success({
									title: 'Database Deleted',
									description:
										'The database has been successfully deleted. Please refresh the page.',
								});
								// Force reload to reinitialize the database
								window.location.reload();
							} catch (err) {
								const error =
									err instanceof Error ? err : new Error(String(err));
								toast.error({
									title: 'Failed to Delete Database',
									description:
										'There was an error deleting the database. Please try again.',
									action: {
										type: 'more-details',
										error,
									},
								});
							}
						},
					},
					{
						label: 'Download Database Dump',
						onClick: () => {
							const blob = new Blob([dumpString], {
								type: 'application/json',
							});
							DownloadService.downloadBlob({
								name: 'recording-db-dump.json',
								blob,
							});
						},
					},
				],
			});

			throw error; // Re-throw to trigger rollback
		};

		// V1: Single recordings table
		this.version(1).stores({ recordings: '&id, timestamp' });

		// V2: Split into metadata and blobs
		this.version(2)
			.stores({
				recordings: null,
				recordingMetadata: '&id, timestamp',
				recordingBlobs: '&id',
			})
			.upgrade(async (tx) => {
				try {
					// Migrate data from recordings to split tables
					const oldRecordings = await tx
						.table<RecordingsDbSchemaV1['recordings']>('recordings')
						.toArray();

					// Create entries in both new tables
					const metadata = oldRecordings.map(
						({ blob, ...recording }) => recording,
					);
					const blobs = oldRecordings.map(({ id, blob }) => ({ id, blob }));

					await tx
						.table<RecordingsDbSchemaV2['recordingMetadata']>(
							'recordingMetadata',
						)
						.bulkAdd(metadata);
					await tx
						.table<RecordingsDbSchemaV2['recordingBlobs']>('recordingBlobs')
						.bulkAdd(blobs);
				} catch (error) {
					await handleUpgradeError({ tx, version: 2, error });
				}
			});

		// V3: Back to single recordings table
		this.version(3)
			.stores({
				recordings: '&id, timestamp',
				recordingMetadata: null,
				recordingBlobs: null,
			})
			.upgrade(async (tx) => {
				try {
					// Get data from both tables
					const metadata = await tx
						.table<RecordingsDbSchemaV2['recordingMetadata']>(
							'recordingMetadata',
						)
						.toArray();
					const blobs = await tx
						.table<RecordingsDbSchemaV2['recordingBlobs']>('recordingBlobs')
						.toArray();

					// Combine and migrate the data
					const mergedRecordings = metadata.map((record) => {
						const blob = blobs.find((b) => b.id === record.id)?.blob;
						return { ...record, blob };
					});

					await tx
						.table<RecordingsDbSchemaV3['recordings']>('recordings')
						.bulkAdd(mergedRecordings);
				} catch (error) {
					await handleUpgradeError({ tx, version: 3, error });
				}
			});
	}
}

export function createRecordingsIndexedDbService(): DbService {
	let recordings = $state<Recording[]>([]);
	const db = new RecordingsDatabase();

	const syncDbToRecordingsState = async () => {
		const allRecordingsFromDbResult = await tryAsync({
			try: async () => {
				return await db.recordings.toArray();
			},
			mapErr: (error) =>
				DbServiceErr({
					title: 'Error getting recordings from Dexie',
					description: 'Please try again',
					error,
				}),
		});

		if (!allRecordingsFromDbResult.ok) {
			toast.error({
				title: 'Failed to initialize recordings',
				description:
					'Unable to load your recordings from the database. This could be due to browser storage issues or corrupted data.',
				action: {
					type: 'more-details',
					error: allRecordingsFromDbResult.error,
				},
			});
			return;
		}
		recordings = allRecordingsFromDbResult.data;
	};

	syncDbToRecordingsState();

	return {
		get recordings() {
			return recordings;
		},

		async getRecording(id: string) {
			return tryAsync({
				try: async () => {
					const recording = await db.recordings.get(id);
					return recording || null;
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error getting recording from Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		async addRecording(recording: Recording) {
			const addRecordingResult = await tryAsync({
				try: async () => {
					await db.recordings.add(recording);
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error adding recording to Dexie',
						description: 'Please try again',
						error,
					}),
			});
			if (!addRecordingResult.ok) return addRecordingResult;
			recordings.push(recording);
			return Ok(undefined);
		},

		async updateRecording(recording: Recording) {
			const updateRecordingResult = await tryAsync({
				try: async () => {
					await db.recordings.put(recording);
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error updating recording in Dexie',
						description: 'Please try again',
						error,
					}),
			});
			if (!updateRecordingResult.ok) return updateRecordingResult;
			recordings = recordings.map((r) =>
				r.id === recording.id ? recording : r,
			);
			return Ok(undefined);
		},

		async deleteRecording(recording: Recording) {
			const deleteRecordingByIdResult = await tryAsync({
				try: async () => {
					await db.recordings.delete(recording.id);
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error deleting recording from Dexie',
						description: 'Please try again',
						error,
					}),
			});
			if (!deleteRecordingByIdResult.ok) return deleteRecordingByIdResult;
			recordings = recordings.filter((r) => r.id !== recording.id);
			return Ok(undefined);
		},

		async deleteRecordings(recordingsToDelete: Recording[]) {
			const ids = recordingsToDelete.map((r) => r.id);
			return tryAsync({
				try: () => db.recordings.bulkDelete(ids),
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error deleting recordings from Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		// Pipeline methods
		async getAllPipelines() {
			return tryAsync({
				try: async () => {
					return await db.pipelines.toArray();
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error getting all pipelines from Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		async addPipeline(pipeline) {
			return tryAsync({
				try: async () => {
					await db.pipelines.add(pipeline);
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error adding pipeline to Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		async updatePipeline(pipeline) {
			return tryAsync({
				try: async () => {
					await db.pipelines.put(pipeline);
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error updating pipeline in Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		async deletePipeline(pipeline) {
			return tryAsync({
				try: () => db.pipelines.delete(pipeline.id),
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error deleting pipeline from Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		async deletePipelineWithAssociatedTransformations(pipeline) {
			return tryAsync({
				try: async () => {
					await db.transaction(
						'rw',
						[db.pipelines, db.transformations],
						async () => {
							await db.pipelines.delete(pipeline.id);
							const transformationIds = pipeline.transformations.map(
								(t) => t.transformationId,
							);
							await db.transformations.bulkDelete(transformationIds);
						},
					);
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error deleting pipeline from Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		// Transformation methods
		async getAllTransformations() {
			return tryAsync({
				try: () => db.transformations.toArray(),
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error getting all transformations from Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		async addTransformation(transformation) {
			const addTransformationResult = await tryAsync({
				try: () => db.transformations.add(transformation),
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error adding transformation to Dexie',
						description: 'Please try again',
						error,
					}),
			});
			if (!addTransformationResult.ok) return addTransformationResult;
			return Ok(undefined);
		},

		async updateTransformation(transformation) {
			const updateTransformationResult = await tryAsync({
				try: () => db.transformations.put(transformation),
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error updating transformation in Dexie',
						description: 'Please try again',
						error,
					}),
			});
			if (!updateTransformationResult.ok) return updateTransformationResult;
			return Ok(undefined);
		},

		async deleteTransformation(transformation) {
			const deleteTransformationResult = await tryAsync({
				try: () => db.transformations.delete(transformation.id),
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error deleting transformation from Dexie',
						description: 'Please try again',
						error,
					}),
			});
			if (!deleteTransformationResult.ok) return deleteTransformationResult;
			return Ok(undefined);
		},

		// Pipeline execution methods
		async startPipelineRun(pipeline, recording) {
			const now = new Date().toISOString();
			const newPipelineRun = {
				id: nanoid(),
				pipelineId: pipeline.id,
				recordingId: recording.id,
				input: recording.transcribedText,
				status: 'running',
				startedAt: now,
				completedAt: null,
				error: null,
				output: null,
			} satisfies PipelineRun;

			const addPipelineRunResult = await tryAsync({
				try: () => db.pipelineRuns.add(newPipelineRun),
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error starting pipeline run in Dexie',
						description: 'Please try again',
						error,
					}),
			});
			if (!addPipelineRunResult.ok) return addPipelineRunResult;
			return Ok(undefined);
		},

		async updatePipelineRun(pipelineRun) {
			const updatePipelineRunResult = await tryAsync({
				try: () => db.pipelineRuns.put(pipelineRun),
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error updating pipeline run in Dexie',
						description: 'Please try again',
						error,
					}),
			});
			if (!updatePipelineRunResult.ok) return updatePipelineRunResult;
			return Ok(undefined);
		},

		async getPipelineRunsByRecording(recording: Recording) {
			return tryAsync({
				try: async () => {
					return await db.pipelineRuns
						.where('recordingId')
						.equals(recording.id)
						.reverse()
						.sortBy('startedAt');
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error getting pipeline runs from Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		async getPipelineRun(id: string) {
			return tryAsync({
				try: async () => {
					const pipelineRun = await db.pipelineRuns.get(id);
					return pipelineRun || null;
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error getting pipeline run from Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		// Transformation results methods
		async addTransformationResult(result) {
			const newResult = {
				...result,
				id: nanoid(),
				completedAt: new Date().toISOString(),
			} satisfies TransformationResult;

			const addTransformationResult = await tryAsync({
				try: () => db.transformationResults.add(newResult),
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error adding transformation result to Dexie',
						description: 'Please try again',
						error,
					}),
			});
			if (!addTransformationResult.ok) return addTransformationResult;
			return Ok(undefined);
		},

		async getTransformationResultsByPipelineRun(pipelineRun: PipelineRun) {
			return tryAsync({
				try: async () => {
					return await db.transformationResults
						.where('pipelineRunId')
						.equals(pipelineRun.id)
						.toArray();
				},
				mapErr: (error) =>
					DbServiceErr({
						title: 'Error getting transformation results from Dexie',
						description: 'Please try again',
						error,
					}),
			});
		},

		async cleanupExpiredRecordings({
			'database.recordingRetentionStrategy': recordingRetentionStrategy,
			'database.maxRecordingCount': maxRecordingCount,
		}: Settings) {
			switch (recordingRetentionStrategy) {
				case 'keep-forever': {
					return Ok(undefined);
				}
				case 'limit-count': {
					const countResult = await tryAsync({
						try: () => db.recordings.count(),
						mapErr: (error) =>
							DbServiceErr({
								title:
									'Unable to get recording count while cleaning up old recordings',
								description: 'Please try again',
								error,
							}),
					});
					if (!countResult.ok) return countResult;
					const count = countResult.data;
					if (count === 0) return Ok(undefined);

					const maxCount = Number.parseInt(maxRecordingCount);

					if (count <= maxCount) return Ok(undefined);

					return tryAsync({
						try: async () => {
							const idsToDelete = await db.recordings
								.orderBy('createdAt')
								.limit(count - maxCount)
								.primaryKeys();
							await db.recordings.bulkDelete(idsToDelete);
						},
						mapErr: (error) =>
							DbServiceErr({
								title: 'Unable to clean up old recordings',
								description: 'Some old recordings could not be deleted',
								error,
							}),
					});
				}
			}
		},
	};
}
