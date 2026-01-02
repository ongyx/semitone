import {
	commands,
	type ExtensionContext,
	type Uri,
	window,
	workspace,
} from "vscode"
import { addCommand } from "./commands/add"
import { configureCommand } from "./commands/configure"
import {
	addIgnoredPathCommand,
	clearIgnoredPathsCommand,
} from "./commands/ignored"
import { refreshCommand } from "./commands/refresh"
import { removeCommand } from "./commands/remove"
import { Cache } from "./internal/cache"
import * as settings from "./internal/settings"
import { Status, StatusBar } from "./internal/statusbar"

let extImpl: Ext | undefined

export async function activate(context: ExtensionContext) {
	if (!settings.getEnabled()) {
		return
	}

	extImpl = new Ext(context)
	await extImpl.activate()
}

export async function deactivate() {
	await extImpl?.deactivate()
	extImpl = undefined
}

/**
 * The actual extension and its commands.
 */
export class Ext {
	context: ExtensionContext
	cache: Cache
	statusBar: StatusBar

	constructor(context: ExtensionContext) {
		this.context = context
		this.cache = new Cache(context)
		this.statusBar = new StatusBar(context)
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
			// Refresh status on open.
			await refreshCommand(this, uri, options)

			if (this.statusBar.status === Status.NotInProject) {
				await addCommand(this, uri, options)
			}
		}

		const onDelete = async (uri: Uri) => {
			const filter = new settings.UriFilter(this.context)
			if (filter.isValid(uri)) {
				const csproj = await this.cache.findProject(uri)
				if (csproj !== undefined) {
					await removeCommand(this, uri, { verbose: true, isEvent: true })
				}
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
