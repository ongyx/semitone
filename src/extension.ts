import pDebounce from "p-debounce"
import {
	commands,
	type ExtensionContext,
	type Uri,
	window,
	workspace,
} from "vscode"
import { addCommand } from "./commands/add"
import { Decision } from "./commands/common"
import { configureCommand } from "./commands/configure"
import {
	addIgnoredPathCommand,
	clearIgnoredPathsCommand,
} from "./commands/ignored"
import { refreshCommand } from "./commands/refresh"
import { askToRemove, removeCommand } from "./commands/remove"
import { Cache } from "./internal/cache"
import type { Csproj } from "./internal/csproj"
import * as settings from "./internal/settings"
import { Status, StatusBar } from "./internal/statusbar"

const DEBOUNCE_REMOVE = 2000
let extensionImpl: Ext | undefined

export async function activate(context: ExtensionContext) {
	if (!settings.getEnabled()) {
		return
	}

	extensionImpl = new Ext(context)
	await extensionImpl.activate()
}

export async function deactivate() {
	await extensionImpl?.deactivate()
	extensionImpl = undefined
}

/**
 * The actual extension and its commands.
 */
export class Ext {
	context: ExtensionContext
	cache: Cache
	statusBar: StatusBar
	pendingRemoval: { uri: Uri; csproj: Csproj }[]

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
			const options = { verbose: true, isEvent: true }
			await refreshCommand(this, uri, options)
			await addCommand(this, uri, options)
		}

		// NOTE: Debouncing is necessary to avoid message spam when a lot of delete events occur.
		const removePending = pDebounce(async () => {
			if ((await askToRemove(this)) === Decision.Yes) {
				for (const { uri, csproj } of this.pendingRemoval) {
					await removeCommand(this, uri, csproj, {
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

		this.context.subscriptions.push(
			commands.registerCommand(
				`extension.${settings.EXT_NAME}.add`,
				addCommand.bind(undefined, this),
			),
			commands.registerCommand(
				`extension.${settings.EXT_NAME}.remove`,
				removeCommand.bind(undefined, this),
			),
			commands.registerCommand(
				`extension.${settings.EXT_NAME}.refresh`,
				refreshCommand.bind(undefined, this),
			),
			commands.registerCommand(
				`extension.${settings.EXT_NAME}.configure`,
				configureCommand.bind(undefined, this),
			),
			commands.registerCommand(
				`extension.${settings.EXT_NAME}.addIgnoredPath`,
				addIgnoredPathCommand.bind(undefined, this),
			),
			commands.registerCommand(
				`extension.${settings.EXT_NAME}.clearIgnoredPaths`,
				clearIgnoredPathsCommand.bind(undefined, this),
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
}
