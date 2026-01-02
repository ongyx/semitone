import * as path from "node:path"
import { FileType, RelativePattern, type Uri, window, workspace } from "vscode"
import type { Ext } from "../extension"
import type { Csproj } from "../internal/csproj"
import * as settings from "../internal/settings"
import { type CommandOptions, Decision } from "./common"
import { addIgnoredPathCommand } from "./ignored"

/**
 * Adds a file or directory of files to their matching project.
 * If the URI is not an absolute path or it ends with `.csproj`, this is a no-op.
 * @param uri The file or directory URI.
 * @param options The options.
 */
export async function addCommand(
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

	console.log(`extension.csproj#add(${uri.fsPath})`)

	const stat = await workspace.fs.stat(uri)

	if (stat.type & FileType.File) {
		const csproj = await ext.cache.findProject(uri)

		if (csproj !== undefined) {
			if (await addFileInternal(ext, uri, csproj, options)) {
				csproj.save()
			}
		} else {
			console.log(`extension.csproj#add(${uri.fsPath}): project not found`)
			if (options.verbose) {
				ext.statusBar.projectNotFound()
			}
		}
	} else if (stat.type & FileType.Directory) {
		const csprojs = await addDirInternal(ext, uri, options)
		for (const csproj of csprojs) {
			await csproj.save()
		}

		return
	}
}

/**
 * Adds a file to the project.
 * @param uri The file URI.
 * @param csproj The project.
 * @param options The options.
 * @returns True if the file was added, false otherwise.
 */
async function addFileInternal(
	ext: Ext,
	uri: Uri,
	csproj: Csproj,
	options: CommandOptions,
): Promise<boolean> {
	const filename = path.basename(uri.fsPath)

	if (csproj.hasItem(uri)) {
		if (options.verbose) {
			ext.statusBar.inProject(csproj)
		}
		console.log(`extension.csproj#add(${uri.fsPath}): already in project`)
		return false
	}

	const decision = options.isEvent
		? await askToAdd(filename, csproj)
		: Decision.Yes

	switch (decision) {
		case Decision.Yes: {
			const itemType = settings.getItemTypeForFile(uri.fsPath)
			csproj.addItem(itemType, uri)

			if (options.verbose) {
				window.showInformationMessage(
					`${filename} was added to ${csproj.name}.`,
				)
				ext.statusBar.inProject(csproj)
			}
			return true
		}

		case Decision.No:
			if (options.verbose) {
				ext.statusBar.notInProject(csproj)
			}
			return false

		case Decision.Never: {
			await addIgnoredPathCommand(ext, uri)

			if (options.verbose) {
				ext.statusBar.ignored()
			}
			return false
		}
	}
}

/**
 * Adds all files in the directory to their matching project.
 * Make sure to call {@link Csproj.save} afterward.
 * @param uri The directory URI.
 * @param options The options.
 * @returns The projects.
 */
async function addDirInternal(
	ext: Ext,
	uri: Uri,
	options: CommandOptions,
): Promise<Csproj[]> {
	const changed: Map<string, Csproj> = new Map()
	const files = await workspace.findFiles(new RelativePattern(uri, "**/*"))
	const filter = new settings.UriFilter(ext.context)
	let added = 0
	let skipped = 0

	for (const file of files.filter((f) => filter.isValid(f))) {
		const csproj = await ext.cache.findProject(file)

		// Since this is a batch operation, there's no need to show a message for every file added.
		if (
			csproj !== undefined &&
			(await addFileInternal(ext, file, csproj, {
				verbose: false,
				isEvent: false,
			}))
		) {
			changed.set(csproj.uri.toString(), csproj)
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
 * Asks the user to decide if a file should be added to a project.
 * This depends on the `csproj.autoAdd` setting.
 * @param filename The name of the file to add.
 * @param csproj The project to add to.
 * @returns The user's decision.
 */
async function askToAdd(filename: string, csproj: Csproj): Promise<Decision> {
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
