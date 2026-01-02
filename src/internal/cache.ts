import {
	type ExtensionContext,
	type FileSystemWatcher,
	Uri,
	workspace,
} from "vscode"
import { Csproj } from "./csproj"
import * as settings from "./settings"

/**
 * The glob for finding project files.
 */
export const PROJECT_GLOB = "**/*.csproj"

/**
 * Cache for MSBuild project files.
 */
export class Cache {
	private projects: Map<string, Csproj>
	private watcher: FileSystemWatcher

	constructor(context: ExtensionContext) {
		this.projects = new Map()
		this.watcher = workspace.createFileSystemWatcher(PROJECT_GLOB)

		// Remove project file from the cache on file change or delete.
		this.watcher.onDidChange((uri) => this.invalidate(uri))
		this.watcher.onDidDelete((uri) => this.invalidate(uri))

		context.subscriptions.push(this.watcher)
	}

	/**
	 * Opens a project file and adds it to the cache.
	 * @param uri The URI of the project file.
	 * @returns The cached or opened project file.
	 */
	async openProject(uri: Uri): Promise<Csproj> {
		const key = uri.toString()

		let csproj = this.projects.get(key)
		if (csproj === undefined) {
			csproj = await Csproj.open(uri)
			this.projects.set(key, csproj)
		}

		return csproj
	}

	/**
	 * Finds the project file to use for the URI according to the `projectFiles` setting.
	 * @param uri The URI.
	 * @returns The cached or opened project file for the URI.
	 */
	async findProject(uri: Uri): Promise<Csproj | undefined> {
		const folder = workspace.getWorkspaceFolder(uri)
		if (folder === undefined) {
			return
		}

		// Get the first project file with a matching glob for the document URI.
		const projectPath = settings.getProjectFileForUri(uri)?.path
		if (projectPath === undefined) {
			return
		}

		// Open the project file in the workspace of the given document.
		return this.openProject(Uri.joinPath(folder.uri, projectPath))
	}

	/**
	 * Removes a project file from the cache. If the URI is not in the cache, this is a no-op.
	 * @param doSave Whether or not to save the project file first.
	 * @returns True if the file was cached, otherwise false.
	 */
	async invalidate(uri: Uri, doSave: boolean = false): Promise<boolean> {
		return this.invalidateInternal(uri.toString(), doSave)
	}

	/**
	 * Invalidates the cache and clears all project files.
	 * @param doSave Whether or not to save the project files first.
	 */
	async clear(doSave: boolean = false) {
		for (const key of this.projects.keys()) {
			await this.invalidateInternal(key, doSave)
		}
	}

	private async invalidateInternal(
		key: string,
		doSave: boolean,
	): Promise<boolean> {
		const csproj = this.projects.get(key)
		if (csproj !== undefined && doSave) {
			await csproj.save()
		}

		return this.projects.delete(key)
	}
}
