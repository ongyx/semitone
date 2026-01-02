import { type Uri, window } from "vscode"
import type { Ext } from "../extension"
import * as settings from "../internal/settings"
import type { CommandOptions } from "./common"
import { refreshCommand } from "./refresh"

import path = require("node:path")

/**
 * Adds an ignored path.
 * @param uri The ignored path as a URI.
 */
export async function addIgnoredPathCommand(
	ext: Ext,
	uri?: Uri,
	options: CommandOptions = { verbose: true, isEvent: false },
): Promise<void> {
	const isActiveFile = uri === undefined

	uri ??= window.activeTextEditor?.document.uri
	if (uri === undefined) {
		if (options.verbose) {
			window.showErrorMessage(
				"No URI was specified, or no text editor is active.",
			)
		}
		return
	}

	const ignoredPaths = settings.getIgnoredPaths(ext.context)
	ignoredPaths.push(uri.fsPath)
	await settings.setIgnoredPaths(ext.context, ignoredPaths)

	if (options.verbose) {
		const filename = path.basename(uri.fsPath)
		window.showInformationMessage(
			`${filename} was added to the ignore list. To clear the list, run the command "csproj: Clear ignored paths".`,
		)

		if (isActiveFile) {
			await refreshCommand(ext, uri, options)
		}
	}
}

/**
 * Clears all ignored paths.
 * @param ext The extension.
 */
export async function clearIgnoredPathsCommand(ext: Ext) {
	await settings.setIgnoredPaths(ext.context, [])
	await refreshCommand(ext)
}
