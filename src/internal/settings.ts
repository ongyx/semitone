import * as path from "node:path"
import { minimatch } from "minimatch"
import {
	type ConfigurationTarget,
	type ExtensionContext,
	type Uri,
	type WorkspaceConfiguration,
	workspace,
} from "vscode"

/**
 * The extension name for retrieving settings or setting commands.
 */
export const EXT_NAME = "csproj"

/**
 * An object map of file extensions to item types.
 */
export interface ItemTypes {
	[ext: string]: string
}

/**
 * A project file to use for a specific file or directory.
 */
export interface ProjectFile {
	/**
	 * The path to the project file.
	 */
	path: string
	/**
	 * The file, directory, or a glob to match against.
	 */
	glob: string
}

// Sadly, vscode doesn't export this type.
// See https://stackoverflow.com/a/75806803 for this neat trick.
declare const inspectFn: WorkspaceConfiguration["inspect"]
/**
 * The successful result of {@link WorkspaceConfiguration.inspect}.
 */
export type InspectResult<T> = NonNullable<ReturnType<typeof inspectFn<T>>>

/**
 * The possible values for the autoAdd and autoDelete setting.
 */
export enum AutoSetting {
	ON = "on",
	PROMPT = "prompt",
	OFF = "off",
}

/**
 * Returns the workspace configuration for this extension.
 * @returns The configuration.
 */
export function getConfig(): WorkspaceConfiguration {
	return workspace.getConfiguration(EXT_NAME)
}

/**
 * Returns the projectFiles setting.
 * @returns The value.
 */
export function getProjectFiles(): ProjectFile[] {
	return getConfig().get<ProjectFile[]>("projectFiles", [])
}

/**
 * Inspects the projectFiles setting.
 * @returns The inspect result, or undefined if the setting is not defined.
 */
export function inspectProjectFiles():
	| InspectResult<ProjectFile[]>
	| undefined {
	return getConfig().inspect("projectFiles")
}

/**
 * Sets the projectFiles setting.
 * @param value The value to set.
 * @param target The config target.
 */
export async function setProjectFiles(
	value: ProjectFile[],
	target: ConfigurationTarget,
): Promise<void> {
	await getConfig().update("projectFiles", value, target)
}

/**
 * Returns the project file whose glob matches the URI.
 * @param uri The URI to match against.
 * @returns The project file, or undefined if no match was found.
 */
export function getProjectFileForUri(uri: Uri): ProjectFile | undefined {
	const rel = workspace.asRelativePath(uri)

	return getProjectFiles().find((p) => minimatch(rel, p.glob))
}

/**
 * Returns the itemTypes setting.
 * @returns The value.
 */
export function getItemTypes(): string | ItemTypes {
	return getConfig().get<string | ItemTypes>("itemType", {
		"*": "Content",
		".cs": "Compile",
		".ts": "TypeScriptCompile",
	})
}

/**
 * Returns the item type for a filename.
 * @param name The filename to check the item type for.
 * @returns The item type.
 */
export function getItemTypeForFile(name: string): string {
	const itemTypes = getItemTypes()

	if (typeof itemTypes === "string") {
		return itemTypes
	} else {
		return itemTypes[path.extname(name)] || itemTypes["*"] || "Content"
	}
}

/**
 * Returns the includeRegex setting.
 * @returns The value as a regex.
 */
export function getIncludeRegex(): RegExp | undefined {
	const pat = getConfig().get<string>("includeRegex")
	return pat ? new RegExp(pat) : undefined
}

/**
 * Returns the excludeRegex setting.
 * @returns The value as a regex.
 */
export function getExcludeRegex(): RegExp | undefined {
	const pat = getConfig().get<string | undefined>("excludeRegex", undefined)
	return pat ? new RegExp(pat) : undefined
}

/**
 * Returns the autoAdd setting.
 * @returns The value.
 */
export function getAutoAdd(): AutoSetting {
	return getConfig().get<AutoSetting>("autoAdd", AutoSetting.PROMPT)
}

/**
 * Returns the autoRemove setting.
 * @returns The value.
 */
export function getAutoRemove(): AutoSetting {
	return getConfig().get<AutoSetting>("autoRemove", AutoSetting.PROMPT)
}

/**
 * Returns the ignoredPaths variable from global state.
 * @param context The extension context.
 * @returns The value.
 */
export function getIgnoredPaths(context: ExtensionContext): string[] {
	return context.globalState.get(`${EXT_NAME}.ignorePaths`, [])
}

/**
 * Sets the ignoredPaths variable from global state.
 * @param context The extension context.
 * @param ignoredPaths The value to set.
 */
export async function setIgnoredPaths(
	context: ExtensionContext,
	ignoredPaths: string[],
): Promise<void> {
	await context.globalState.update(`${EXT_NAME}.ignorePaths`, ignoredPaths)
}

/**
 * A URI filter that checks against user settings.
 */
export class UriFilter {
	private readonly ignoredPaths: Set<string>
	private readonly includeRegex?: RegExp
	private readonly excludeRegex?: RegExp

	constructor(context: ExtensionContext) {
		this.ignoredPaths = new Set(getIgnoredPaths(context))
		// Globs would be more efficient, but backward compatibility should be kept.
		this.includeRegex = getIncludeRegex()
		this.excludeRegex = getExcludeRegex()
	}

	/**
	 * Checks if the URI is valid against `csproj.ignorePaths`, `csproj.includeRegex`, and `csproj.excludeRegex`.
	 * @param uri The URI to check.
	 * @returns True if so, otherwise false.
	 */
	isValid(uri: Uri): boolean {
		if (this.ignoredPaths.has(uri.fsPath)) {
			return false
		}

		if (
			this.includeRegex !== undefined &&
			!this.includeRegex.test(uri.fsPath)
		) {
			return false
		}

		if (this.excludeRegex?.test(uri.fsPath)) {
			return false
		}

		return true
	}
}
