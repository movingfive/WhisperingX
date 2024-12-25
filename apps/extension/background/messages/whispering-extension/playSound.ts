import { Ok } from '@epicenterhq/result';
import type { PlasmoMessaging } from '@plasmohq/messaging';
import {
	WhisperingErr,
	type WhisperingResult,
	type WhisperingSoundNames,
} from '@repo/shared';
import { getActiveTabId } from '~lib/getActiveTabId';

export type PlaySoundMessage = {
	sound: WhisperingSoundNames;
};
export type PlaySoundResult = WhisperingResult<undefined>;

const handler: PlasmoMessaging.MessageHandler<
	PlaySoundMessage,
	PlaySoundResult
> = async ({ body }, res) => {
	const playSound = async () => {
		if (!body?.sound) {
			return WhisperingErr({
				title: 'Error invoking playSound command',
				description:
					'Sound must be provided in the request body of the message',
			});
		}
		const { sound } = body;
		console.info('Playing sound', sound);
		const getActiveTabIdResult = await getActiveTabId();
		if (!getActiveTabIdResult.ok) {
			return WhisperingErr({
				title: 'Failed to get active tab ID',
				description: 'Failed to get active tab ID to play sound',
				action: { type: 'more-details', error: getActiveTabIdResult.error },
			});
		}
		const activeTabId = getActiveTabIdResult.data;
		if (!activeTabId) {
			return WhisperingErr({
				title: 'Failed to get active tab ID',
				description: 'Failed to get active tab ID to play sound',
			});
		}
		const sendMessageResult = await chrome.tabs.sendMessage(activeTabId, {
			message: 'playSound',
			sound,
		});
		if (!sendMessageResult) {
			return WhisperingErr({
				title: `Failed to play ${sound} sound`,
				description: `Failed to play ${sound} sound in active tab ${activeTabId}`,
				action: { type: 'more-details', error: sendMessageResult },
			});
		}
		return Ok(undefined);
	};
	res.send(await playSound());
};

export default handler;
