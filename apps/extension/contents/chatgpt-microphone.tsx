import cssText from 'data-text:~/style.css';

import { recorderStateToIcons } from '@repo/shared';
import type {
	PlasmoCSConfig,
	PlasmoGetInlineAnchor,
	PlasmoGetStyle,
} from 'plasmo';
import { useWhisperingRecorderState } from '~lib/storage/useWhisperingStorage';
import { toggleRecordingFromContentScript } from './utils/toggleRecordingFromContentScript';
import { waitForElement } from './utils/waitForElement';

export const getInlineAnchor: PlasmoGetInlineAnchor = async () => {
	const element = (await waitForElement('#prompt-textarea')).closest('div');
	if (!element) {
		return { element: document.body, insertPosition: 'afterbegin' };
	}
	return { element, insertPosition: 'afterend' };
};

export const config: PlasmoCSConfig = {
	matches: ['https://chatgpt.com/*'],
	all_frames: true,
};

export const getStyle: PlasmoGetStyle = () => {
	const style = document.createElement('style');
	style.textContent = cssText.replaceAll(':root', ':host(plasmo-csui)');
	return style;
};

function RecorderStateAsIcon() {
	const recorderState = useWhisperingRecorderState();
	const recorderStateAsIcon = recorderStateToIcons[recorderState];
	return (
		<button
			className="group relative z-10 h-10 w-10 rounded-md text-2xl"
			onClick={toggleRecordingFromContentScript}
		>
			<div className="absolute inset-0 rounded-md bg-black bg-opacity-0 transition-opacity duration-300 group-hover:bg-opacity-10" />
			{recorderStateAsIcon}
		</button>
	);
}

export default RecorderStateAsIcon;
