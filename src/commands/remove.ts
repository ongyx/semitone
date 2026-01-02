import * as path from "node:path"
import pDebounce from "p-debounce"
import { RelativePattern, type Uri, window, workspace } from "vscode"
import type { Ext } from "../extension"
import type { Csproj } from "../internal/csproj"
import * as settings from "../internal/settings"
import { type CommandOptions, Decision } from "./common"

const DEBOUNCE_REMOVE = 1000

const pending: { uri: Uri; csproj: Csproj }[] = []
// NOTE: Debouncing is necessary to avoid message spam when a lot of delete events occur.
let removePendingDebounced: (() => Promise<void>) | undefined

/**
 * Removes a file or directory of files of from their matching project file.
 * NOTE:
 * @param uri The file or directory URI.
 * @param options The options.
 */
export async function removeCommand(
	ext: Ext,
	uri?: Uri,
	options: CommandOptions = { verbose: true, isEvent: false },
): Promise<void> {
	removePendingDebounced ??= pDebounce(
		removePending.bind(undefined, ext),
		DEBOUNCE_REMOVE,
	)

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

	// Since the file or folder at the URI may have been deleted already, the only way to check if it was a directory is by fsPath.
	const isFile = path.extname(uri.fsPath) !== ""

	if (isFile) {
		const csproj = await ext.cache.findProject(uri)
		if (csproj === undefined) {
			console.log(`extension.csproj#add(${uri.fsPath}): project not found`)
			if (options.verbose) {
				ext.statusBar.projectNotFound()
			}
			return
		}

		if (options.isEvent) {
			// Add it to the pending pile.
			pending.push({ uri, csproj })
		} else {
			// This command was called manually, so directly invoke removeFileInternal.
			const didRemove = await removeFileInternal(ext, uri, csproj, options)

			if (didRemove) {
				await csproj.save()
				return
			}
		}
	} else {
		// Find all files in the directory (if any) and add them to the pending pile.
		const files = await workspace.findFiles(new RelativePattern(uri, "**/*"))
		const filter = new settings.UriFilter(ext.context)

		for (const file of files.filter((f) => filter.isValid(f))) {
			const csproj = await ext.cache.findProject(file)
			if (csproj === undefined) {
				continue
			}

			pending.push({ uri: file, csproj })
		}
	}

	await removePendingDebounced()
}

/**
 * Removes all pending files.
 * @param ext The extension.
 */
async function removePending(ext: Ext): Promise<void> {
	if ((await askToRemove()) === Decision.Yes) {
		const csprojs: Map<string, Csproj> = new Map()

		for (const { uri, csproj } of pending) {
			const didRemove = await removeFileInternal(ext, uri, csproj, {
				verbose: false,
				isEvent: true,
			})

			if (didRemove) {
				csprojs.set(csproj.uri.toString(), csproj)
			}
		}

		for (const csproj of csprojs.values()) {
			await csproj.save()
		}
	}

	// Clear array in-place.
	pending.length = 0
}

/**
 * Removes a file from a project.
 * @param ext The extension.
 * @param uri The URI.
 * @param csproj The project.
 * @param options The command options.
 * @returns True if the file was removed, false otherwise.
 */
async function removeFileInternal(
	ext: Ext,
	uri: Uri,
	csproj: Csproj,
	options: CommandOptions,
): Promise<boolean> {
	const didRemove = csproj.removeItem(uri)

	if (options.verbose) {
		const filename = path.basename(uri.fsPath)
		window.showInformationMessage(
			didRemove
				? `${filename} was removed from ${csproj.name}.`
				: `${filename} is not in ${csproj.name}.`,
		)
		ext.statusBar.notInProject(csproj)
	}

	return didRemove
}

/**
 * Asks the user to decide if pending files should be removed from their project file.
 * This depends on the `csproj.autoRemove` setting.
 * @param filename The name of the file to remove.
 * @param csproj The project file to remove to.
 * @returns The user's decision.
 */
async function askToRemove(): Promise<Decision> {
	switch (settings.getAutoRemove()) {
		case settings.AutoSetting.ON:
			// Remove the files automatically.
			return Decision.Yes

		case settings.AutoSetting.OFF:
			// Don't remove the files automatically.
			return Decision.No

		case settings.AutoSetting.PROMPT: {
			const msg =
				pending.length > 1
					? `${pending.length} files were deleted, would you like to remove them from their project files?`
					: `${path.basename(pending[0].uri.fsPath)} was deleted, would you like to remove it from ${pending[0].csproj.name}?`
			// Ask the user.
			return (
				(await window.showInformationMessage(msg, Decision.Yes, Decision.No)) ??
				Decision.No
			)
		}
	}
}
