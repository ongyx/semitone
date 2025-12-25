import * as path from "node:path"
import pDebounce from "p-debounce"
import {
	commands,
	type ExtensionContext,
	FileType,
	RelativePattern,
	type Uri,
	window,
	workspace,
} from "vscode"
import { Cache } from "./cache"
import type { Csproj } from "./csproj"
import * as settings from "./settings"
import { StatusBar } from "./statusbar"

const DEBOUNCE_REMOVE = 2000
let extensionImpl: ExtensionImpl | undefined

export async function activate(context: ExtensionContext) {
	extensionImpl = new ExtensionImpl(context)
	await extensionImpl.activate()
}

export async function deactivate() {
	await extensionImpl?.deactivate()
	extensionImpl = undefined
}

/**
 * Decision constants for prompts.
 */
enum Decision {
	Yes = "Yes",
	No = "No",
	Never = "Never",
}

interface Options {
	/**
	 * Whether or not messages should be shown.
	 */
	verbose: boolean
}

/**
 * The actual extension and its commands.
 */
class ExtensionImpl {
	private context: ExtensionContext
	private cache: Cache
	private statusBar: StatusBar
	private pendingRemoval: Uri[]
	private removePendingDebounced: () => Promise<void>

	constructor(context: ExtensionContext) {
		this.context = context
		this.cache = new Cache(context)
		this.statusBar = new StatusBar(context)
		this.pendingRemoval = []
		// NOTE: Debouncing is necessary to avoid message spam when a lot of delete events occur.
		this.removePendingDebounced = pDebounce(
			this.removePending.bind(this),
			DEBOUNCE_REMOVE,
		)
	}

	/**
	 * Activates the extension.
	 */
	async activate() {
		const deleteWatcher = workspace.createFileSystemWatcher(
			"**/*",
			true,
			true,
			false,
		)

		this.context.subscriptions.push(
			commands.registerCommand(
				`extension.${settings.EXT_NAME}.add`,
				this.addCommand.bind(this),
			),
			commands.registerCommand(
				`extension.${settings.EXT_NAME}.remove`,
				this.removeCommand.bind(this),
			),
			commands.registerCommand(
				`extension.${settings.EXT_NAME}.clearIgnoredPaths`,
				this.clearIgnoredPathsCommand.bind(this),
			),

			// When a document is saved, add it to the nearest project file.
			workspace.onDidSaveTextDocument(async (d) => this.onDocumentOpen(d.uri)),

			// When the active text editor changes, add the document to the nearest project file.
			window.onDidChangeActiveTextEditor(async (t) => {
				if (t !== undefined) {
					this.statusBar.hide()
					this.onDocumentOpen(t.document.uri)
				}
			}),

			deleteWatcher,
			// When a file/directory is deleted, add it to the removal list.
			deleteWatcher.onDidDelete(this.onFileDelete.bind(this)),
		)
	}

	/**
	 * Deactivates the extension.
	 */
	async deactivate() {
		await this.cache.clear(true)
		this.statusBar.hide()
	}

	/**
	 * Callback for a document being opened or saved by the user.
	 * @param uri The document's URI.
	 */
	private async onDocumentOpen(uri: Uri): Promise<void> {
		const filter = new settings.UriFilter(this.context)
		if (!filter.isValid(uri)) {
			return
		}

		let decision: Decision

		switch (settings.getAutoAdd()) {
			case settings.AutoSetting.ON:
				// Add the file automatically.
				decision = Decision.Yes
				break

			case settings.AutoSetting.OFF:
				// Don't add the file automatically.
				decision = Decision.No
				break

			case settings.AutoSetting.PROMPT: {
				// Ask the user.
				decision =
					(await window.showInformationMessage(
						`Would you like to add ${uri.fsPath} to the project file?`,
						Decision.Yes,
						Decision.No,
						Decision.Never,
					)) ?? Decision.No
			}
		}

		switch (decision) {
			case Decision.Yes:
				await this.addCommand(uri)
				break

			case Decision.No:
				this.statusBar.show("<none>", false)
				break

			case Decision.Never: {
				const ignoredPaths = settings.getIgnoredPaths(this.context)
				ignoredPaths.push(uri.fsPath)
				settings.setIgnoredPaths(this.context, ignoredPaths)

				window.showInformationMessage(
					`${uri.fsPath} was added to the ignore list. To clear the list, run the command "csproj: Clear ignored paths".`,
				)
				this.statusBar.hide()
				break
			}
		}
	}

	/**
	 * Callback for a file or directory being deleted.
	 * @param uri The file or directory's URI.
	 */
	private async onFileDelete(uri: Uri): Promise<void> {
		const filter = new settings.UriFilter(this.context)
		if (!filter.isValid(uri)) {
			return
		}

		this.pendingRemoval.push(uri)
		await this.removePendingDebounced()
	}

	/**
	 * Removes all pending files. `removePendingDebounced` should be called instead in most cases.
	 */
	private async removePending(): Promise<void> {
		let decision: Decision

		switch (settings.getAutoRemove()) {
			case settings.AutoSetting.ON:
				// Remove the files automatically.
				decision = Decision.Yes
				break

			case settings.AutoSetting.OFF:
				// Don't remove the files automatically.
				decision = Decision.No
				break

			case settings.AutoSetting.PROMPT: {
				const msg =
					this.pendingRemoval.length > 1
						? `${this.pendingRemoval.length} files were deleted, would you like to remove them from the project file?`
						: `${this.pendingRemoval[0]} was deleted, would you like to remove it from the project file?`
				// Ask the user.
				decision =
					(await window.showInformationMessage(
						msg,
						Decision.Yes,
						Decision.No,
					)) ?? Decision.No
			}
		}

		if (decision === Decision.Yes) {
			for (const uri of this.pendingRemoval) {
				await this.removeCommand(uri)
			}
		}

		// Clear array in-place.
		this.pendingRemoval.length = 0
	}

	/**
	 * Adds a file or directory of files to their nearest project file.
	 * @param uri The file or directory URI.
	 * @param options The options.
	 */
	private async addCommand(
		uri: Uri,
		options: Options = { verbose: true },
	): Promise<void> {
		const stat = await workspace.fs.stat(uri)
		if (stat.type & FileType.File) {
			const csproj = await this.addFile(uri, options)
			await csproj?.save()
		} else if (stat.type & FileType.Directory) {
			const csprojs = await this.addDirectory(uri, options)
			for (const csproj of csprojs) {
				await csproj.save()
			}
		} else {
			window.showErrorMessage(`URI ${uri} must be a file or directory.`)
		}
	}

	/**
	 * Adds a file to the nearest project file.
	 * @param uri The file URI.
	 * @param options The options.
	 * @returns The project file, or undefined if the project file could not be found.
	 */
	private async addFile(
		uri: Uri,
		options: Options,
	): Promise<Csproj | undefined> {
		const csproj = await this.cache.findProject(uri)
		if (csproj === undefined) {
			if (options.verbose) {
				window.showErrorMessage(`No project file found for ${uri.fsPath}.`)
			}
			return
		}

		if (csproj.hasItem(uri)) {
			if (options.verbose) {
				window.showWarningMessage(`${uri.fsPath} is already in ${csproj.name}.`)
				this.statusBar.show(csproj.name, true)
			}
			return csproj
		}

		const itemType = settings.getItemTypeForFile(uri.fsPath)
		csproj.addItem(itemType, uri)

		if (options.verbose) {
			this.statusBar.show(csproj.name, true)
		}

		return csproj
	}

	/**
	 * Adds all files in the directory to their nearest project file.
	 * @param uri The directory URI.
	 * @param options The options.
	 * @returns The project files.
	 */
	private async addDirectory(uri: Uri, options: Options): Promise<Csproj[]> {
		const filter = new settings.UriFilter(this.context)

		const changed: Map<Uri, Csproj> = new Map()
		const files = await workspace.findFiles(new RelativePattern(uri, "**/*"))
		let count = 0

		for (const file of files.filter((f) => filter.isValid(f))) {
			const csproj = await this.cache.findProject(file)
			if (csproj !== undefined && !csproj.hasItem(file)) {
				const itemType = settings.getItemTypeForFile(file.fsPath)
				csproj.addItem(itemType, file)
				changed.set(csproj.uri, csproj)
				count++
			}
		}

		if (options.verbose) {
			window.showInformationMessage(`${count} files were added.`)
		}

		return Array.from(changed.values())
	}

	/**
	 * Removes a file or directory of files from their nearest project file.
	 * @param uri The file or directory URI.
	 * @param options The options.
	 */
	private async removeCommand(uri: Uri): Promise<void> {
		const csproj = await this.cache.findProject(uri)
		if (csproj === undefined) {
			return
		}

		// Since the file or folder at the URI may have been deleted already, the only way to check if it was a directory is by fsPath.
		const isDirectory = path.extname(uri.fsPath) === ""
		csproj.removeItem(uri, isDirectory)
	}

	/**
	 * Clears all ignored paths.
	 */
	private async clearIgnoredPathsCommand(): Promise<void> {
		await settings.setIgnoredPaths(this.context, [])
	}
}
