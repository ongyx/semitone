import * as path from "node:path"
import { type Uri, window } from "vscode"
import type { Ext } from "../extension"
import type { Csproj } from "../internal/csproj"
import * as settings from "../internal/settings"
import { type CommandOptions, Decision } from "./common"

/**
 * Removes a file or directory of files of from their matching project file.
 * NOTE:
 * @param uri The file or directory URI.
 * @param csproj The csproj to remove the file or directory from.
 * @param options The options.
 */
export async function removeCommand(
	ext: Ext,
	uri?: Uri,
	csproj?: Csproj,
	options: CommandOptions = { verbose: true, isEvent: false },
): Promise<void> {
	uri ??= window.activeTextEditor?.document.uri
	if (uri === undefined) {
		if (options.verbose) {
			window.showErrorMessage(
				"No URI was specified, or no text editor is active.",
			)
		}
		return
	}

	console.log(`extension.csproj#remove(${uri.fsPath})`)

	csproj ??= await ext.cache.findProject(uri)
	if (csproj === undefined) {
		return
	}

	// Since the file or folder at the URI may have been deleted already, the only way to check if it was a directory is by fsPath.
	const isDirectory = path.extname(uri.fsPath) === ""
	const didRemove = csproj.removeItem(uri, isDirectory)

	if (options.verbose) {
		const filename = path.basename(uri.fsPath)
		window.showInformationMessage(
			didRemove
				? `${filename} was removed from ${csproj.name}.`
				: `${filename} is not in ${csproj.name}.`,
		)
		ext.statusBar.notInProject(csproj)
	}

	if (didRemove) {
		await csproj.save()
	}
}

/**
 * Asks the user to decide if pending files should be removed from their project file.
 * This depends on the `csproj.autoRemove` setting.
 * @param filename The name of the file to remove.
 * @param csproj The project file to remove to.
 * @returns The user's decision.
 */
export async function askToRemove(ext: Ext): Promise<Decision> {
	switch (settings.getAutoRemove()) {
		case settings.AutoSetting.ON:
			// Remove the files automatically.
			return Decision.Yes

		case settings.AutoSetting.OFF:
			// Don't remove the files automatically.
			return Decision.No

		case settings.AutoSetting.PROMPT: {
			const msg =
				ext.pendingRemoval.length > 1
					? `${ext.pendingRemoval.length} files were deleted, would you like to remove them from their project files?`
					: `${path.basename(ext.pendingRemoval[0].uri.fsPath)} was deleted, would you like to remove it from ${ext.pendingRemoval[0].csproj.name}?`
			// Ask the user.
			return (
				(await window.showInformationMessage(msg, Decision.Yes, Decision.No)) ??
				Decision.No
			)
		}
	}
}
