// The "Clear" confirmation popup shared by both tabs of Create new album.
/** Shows the popup with `message`; resolves true only if the admin presses the Clear button. */
export function askToClear(message: string): Promise<boolean> {
	const dialog = document.querySelector<HTMLDialogElement>('#clear-dialog')!;
	dialog.querySelector<HTMLElement>('#clear-text')!.textContent = message;

	return new Promise((resolve) => {
		const finish = () => {
			dialog.removeEventListener('close', finish);
			resolve(dialog.returnValue === 'confirm');
		};
		dialog.returnValue = '';
		dialog.addEventListener('close', finish);
		dialog.showModal();
	});
}

// Buttons and the dim area outside the popup. Escape closes it with no value, which counts as Cancel.
export function wireClearDialog() {
	const dialog = document.querySelector<HTMLDialogElement>('#clear-dialog');
	if (!dialog || dialog.dataset.wired) return;
	dialog.dataset.wired = '1';
	dialog.querySelector('#clear-confirm')!.addEventListener('click', () => dialog.close('confirm'));
	dialog.querySelector('#clear-cancel')!.addEventListener('click', () => dialog.close('cancel'));
	dialog.addEventListener('click', (e) => {
		if (e.target === dialog) dialog.close('cancel');
	});
}
