import { type Uri, window } from "vscode"
import type { Ext } from "../extension"
import * as settings from "../internal/settings"
import type { CommandOptions } from "./common"

/**
 * Updates the status bar.
 * @param ext The extension.
 * @param uri The file or directory URI.
 * @param options The command options.
 */
export async function refreshCommand(
	ext: Ext,
	uri?: Uri,
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

	ext.statusBar.unavailable()

	const filter = new settings.UriFilter(ext.context)
	if (!filter.isValid(uri)) {
		console.log(
			`extension.csproj#onOpen(${uri.fsPath}): ignored by user/workspace settings`,
		)
		ext.statusBar.ignored()
		return
	}

	const csproj = await ext.cache.findProject(uri)
	if (csproj === undefined) {
		ext.statusBar.projectNotFound()
		return
	}

	if (csproj.hasItem(uri)) {
		ext.statusBar.inProject(csproj)
	} else {
		ext.statusBar.notInProject(csproj)
	}
}
