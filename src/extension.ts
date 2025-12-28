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
import { Status, StatusBar } from "./statusbar"

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

/**
 * Common command options.
 */
interface Options {
	/**
	 * Whether or not messages should be shown.
	 */
	verbose: boolean

	/**
	 * Whether or not the command was called from an event listener.
	 */
	isEvent: boolean
}

/**
 * The actual extension and its commands.
 */
class ExtensionImpl {
	private context: ExtensionContext
	private cache: Cache
	private statusBar: StatusBar
	private pendingRemoval: { uri: Uri; csproj: Csproj }[]

	constructor(context: ExtensionContext) {
		this.context = context
		this.cache = new Cache(context)
		this.statusBar = new StatusBar(context)
		this.pendingRemoval = []
	}

	/**
	 * Activates the extension.
	 */
	async activate() {
		console.log("extension.csproj#activate")

		const deleteWatcher = workspace.createFileSystemWatcher(
			"**/*",
			true,
			true,
			false,
		)

		const onOpen = async (uri: Uri) => {
			this.statusBar.unavailable()

			const filter = new settings.UriFilter(this.context)
			if (!filter.isValid(uri)) {
				console.log(
					`extension.csproj#onOpen(${uri.fsPath}): ignored by user/workspace settings`,
				)
				this.statusBar.ignored()
				return
			}

			await this.addCommand(uri, { verbose: true, isEvent: true })
		}

		// NOTE: Debouncing is necessary to avoid message spam when a lot of delete events occur.
		const removePending = pDebounce(async () => {
			if ((await this.askToRemove()) === Decision.Yes) {
				for (const { uri, csproj } of this.pendingRemoval) {
					await this.removeCommand(uri, csproj, {
						verbose: false,
						isEvent: true,
					})
				}
			}

			// Clear array in-place.
			this.pendingRemoval.length = 0
		}, DEBOUNCE_REMOVE)

		const onDelete = async (uri: Uri) => {
			const filter = new settings.UriFilter(this.context)
			if (!filter.isValid(uri)) {
				return
			}

			const csproj = await this.cache.findProject(uri)
			if (csproj !== undefined) {
				this.pendingRemoval.push({ uri, csproj })
				await removePending()
			}
		}

		const clearIgnoredPathsCommand = async () => {
			await settings.setIgnoredPaths(this.context, [])

			const current = window.activeTextEditor?.document.uri
			if (current !== undefined) {
				await onOpen(current)
			}
		}

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
				clearIgnoredPathsCommand,
			),

			// When a document is saved without a project file, add it to its matching project file.
			workspace.onDidSaveTextDocument(async (d) => {
				if (this.statusBar.status === Status.Unavailable) {
					await onOpen(d.uri)
				}
			}),

			// When the active text editor changes, add the document to its matching project file.
			window.onDidChangeActiveTextEditor(async (t) => {
				if (t !== undefined) {
					// Clear status first, in case there are any prompts.
					await onOpen(t.document.uri)
				}
			}),

			deleteWatcher,
			// When a file/directory is deleted, add it to the removal list.
			deleteWatcher.onDidDelete(onDelete),
		)

		// If a file is already open, trigger onOpen manually.
		const document = window.activeTextEditor?.document
		if (document !== undefined) {
			await onOpen(document.uri)
		}
	}

	/**
	 * Deactivates the extension.
	 */
	async deactivate() {
		console.log("extension.csproj#deactivate")
		await this.cache.clear(true)
		this.statusBar.unavailable()
	}

	/**
	 * Adds a file or directory of files to their matching project file.
	 * If the URI is not an absolute path or it ends with `.csproj`, this is a no-op.
	 * @param uri The file or directory URI.
	 * @param options The options.
	 */
	private async addCommand(
		uri?: Uri,
		options: Options = { verbose: true, isEvent: false },
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

		console.log(`extension.csproj#add(${uri.fsPath})`)

		const stat = await workspace.fs.stat(uri)

		if (stat.type & FileType.File) {
			const csproj = await this.cache.findProject(uri)

			if (csproj !== undefined) {
				if (await this.addFileInternal(uri, csproj, options)) {
					csproj.save()
				}
			} else {
				console.log(
					`extension.csproj#add(${uri.fsPath}): project file not found`,
				)
				if (options.verbose) {
					this.statusBar.projectNotFound()
				}
			}
		} else if (stat.type & FileType.Directory) {
			const csprojs = await this.addDirInternal(uri, options)
			for (const csproj of csprojs) {
				await csproj.save()
			}

			return
		}
	}

	/**
	 * Removes a file or directory of files of from their matching project file.
	 * NOTE:
	 * @param uri The file or directory URI.
	 * @param csproj The csproj to remove the file or directory from.
	 * @param options The options.
	 */
	private async removeCommand(
		uri?: Uri,
		csproj?: Csproj,
		options: Options = { verbose: true, isEvent: false },
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

		csproj ??= await this.cache.findProject(uri)
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
			this.statusBar.notInProject(csproj)
		}

		if (didRemove) {
			await csproj.save()
		}
	}

	/**
	 * Adds a file to the project file.
	 * @param uri The file URI.
	 * @param csproj The project file.
	 * @param options The options.
	 * @returns True if the file was added, false otherwise.
	 */
	private async addFileInternal(
		uri: Uri,
		csproj: Csproj,
		options: Options,
	): Promise<boolean> {
		const filename = path.basename(uri.fsPath)

		if (csproj.hasItem(uri)) {
			if (options.verbose) {
				this.statusBar.inProject(csproj)
			}
			console.log(`extension.csproj#add(${uri.fsPath}): already in project`)
			return false
		}

		const decision = options.isEvent
			? await this.askToAdd(filename, csproj)
			: Decision.Yes

		switch (decision) {
			case Decision.Yes: {
				const itemType = settings.getItemTypeForFile(uri.fsPath)
				csproj.addItem(itemType, uri)

				if (options.verbose) {
					window.showInformationMessage(
						`${filename} was added to ${csproj.name}.`,
					)
					this.statusBar.inProject(csproj)
				}
				return true
			}

			case Decision.No:
				if (options.verbose) {
					this.statusBar.notInProject(csproj)
				}
				return false

			case Decision.Never: {
				await this.addIgnoredPath(uri)

				if (options.verbose) {
					window.showInformationMessage(
						`${filename} was added to the ignore list. To clear the list, run the command "csproj: Clear ignored paths".`,
					)
					this.statusBar.ignored()
				}
				return false
			}
		}
	}

	/**
	 * Adds all files in the directory to their matching project file.
	 * Make sure to call {@link Csproj.save} afterward.
	 * @param uri The directory URI.
	 * @param options The options.
	 * @returns The project files.
	 */
	private async addDirInternal(uri: Uri, options: Options): Promise<Csproj[]> {
		const changed: Map<Uri, Csproj> = new Map()
		const files = await workspace.findFiles(new RelativePattern(uri, "**/*"))
		const filter = new settings.UriFilter(this.context)
		let added = 0
		let skipped = 0

		for (const file of files.filter((f) => filter.isValid(f))) {
			const csproj = await this.cache.findProject(file)

			// Since this is a batch operation, there's no need to show a message for every file added.
			if (
				csproj !== undefined &&
				(await this.addFileInternal(file, csproj, {
					verbose: false,
					isEvent: false,
				}))
			) {
				changed.set(csproj.uri, csproj)
				added++
			} else {
				skipped++
			}
		}

		if (options.verbose) {
			window.showInformationMessage(
				`${added} files were added, ${skipped} files were skipped.`,
			)
		}

		return Array.from(changed.values())
	}

	/**
	 * Asks the user to decide if a file should be added to a project file.
	 * This depends on the `csproj.autoAdd` setting.
	 * @param filename The name of the file to add.
	 * @param csproj The project file to add to.
	 * @returns The user's decision.
	 */
	private async askToAdd(filename: string, csproj: Csproj): Promise<Decision> {
		switch (settings.getAutoAdd()) {
			case settings.AutoSetting.ON:
				// Add the file automatically.
				return Decision.Yes

			case settings.AutoSetting.OFF:
				// Don't add the file automatically.
				return Decision.No

			case settings.AutoSetting.PROMPT: {
				// Ask the user.
				return (
					(await window.showInformationMessage(
						`Would you like to add ${filename} to ${csproj.name}?`,
						Decision.Yes,
						Decision.No,
						Decision.Never,
					)) ?? Decision.No
				)
			}
		}
	}

	/**
	 * Asks the user to decide if pending files should be removed from their project file.
	 * This depends on the `csproj.autoRemove` setting.
	 * @param filename The name of the file to remove.
	 * @param csproj The project file to remove to.
	 * @returns The user's decision.
	 */
	private async askToRemove(): Promise<Decision> {
		switch (settings.getAutoRemove()) {
			case settings.AutoSetting.ON:
				// Remove the files automatically.
				return Decision.Yes

			case settings.AutoSetting.OFF:
				// Don't remove the files automatically.
				return Decision.No

			case settings.AutoSetting.PROMPT: {
				const msg =
					this.pendingRemoval.length > 1
						? `${this.pendingRemoval.length} files were deleted, would you like to remove them from their project files?`
						: `${path.basename(this.pendingRemoval[0].uri.fsPath)} was deleted, would you like to remove it from ${this.pendingRemoval[0].csproj.name}?`
				// Ask the user.
				return (
					(await window.showInformationMessage(
						msg,
						Decision.Yes,
						Decision.No,
					)) ?? Decision.No
				)
			}
		}
	}

	/**
	 * Adds an ignored path.
	 * @param uri The ignored path as a URI.
	 */
	private async addIgnoredPath(uri: Uri): Promise<void> {
		const ignoredPaths = settings.getIgnoredPaths(this.context)
		ignoredPaths.push(uri.fsPath)
		await settings.setIgnoredPaths(this.context, ignoredPaths)
	}
}
