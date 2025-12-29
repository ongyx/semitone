import * as path from "node:path"
import {
	ConfigurationTarget,
	type QuickPickItem,
	QuickPickItemKind,
	type Uri,
	window,
	workspace,
} from "vscode"
import type { Ext } from "../extension"
import { PROJECT_GLOB } from "../internal/cache"
import type { InspectResult, ProjectFile } from "../internal/settings"
import * as settings from "../internal/settings"
import { spaceCase } from "../internal/utils"
import { Decision } from "./common"

/**
 * A quick pick separator.
 */
class SeparatorItem implements QuickPickItem {
	kind: QuickPickItemKind = QuickPickItemKind.Separator
	label: string

	constructor(label: string) {
		this.label = label
	}
}

/**
 * A quick pick item for a decision.
 */
class DecisionItem implements QuickPickItem {
	decision: Decision
	label: string

	constructor(decision: Decision) {
		this.decision = this.label = decision
	}
}

/**
 * A quick pick item for adding a project file.
 */
class AddItem implements QuickPickItem {
	label: string = "$(add) Add project file..."
}

/**
 * A quick pick item for an existing project file.
 */
class ExistingItem implements QuickPickItem {
	file: ProjectFile
	target: ConfigurationTarget
	index: number
	label: string
	description: string

	constructor(file: ProjectFile, target: ConfigurationTarget, index: number) {
		this.file = file
		this.target = target
		this.index = index
		this.label = `$(file) ${file.path}`
		this.description = file.glob
	}

	static fromInspect(
		inspect: InspectResult<ProjectFile[]>,
		target: ConfigurationTarget,
	): ExistingItem[] {
		const projectFiles = getConfigForTarget(inspect, target) ?? []

		return projectFiles.map((f, i) => new ExistingItem(f, target, i))
	}
}

/**
 * A quick pick item for removing an existing project file.
 */
class RemoveExistingItem implements QuickPickItem {
	label: string

	constructor(existingItem: ExistingItem) {
		this.label = `$(eraser) Remove ${existingItem.file.path}`
	}
}

/**
 * A quick pick item for shifting the position of an existing project file.
 */
class ShiftExistingItem implements QuickPickItem {
	isUpOrDown: boolean
	label: string

	constructor(existingItem: ExistingItem, isUpOrDown: boolean) {
		this.isUpOrDown = isUpOrDown
		this.label = `$(${isUpOrDown ? "arrow-up" : "arrow-down"}) Shift ${existingItem.file.path} ${isUpOrDown ? "above" : "below"} previous project file`
	}
}

/**
 * A quick pick item for selecting a project file path.
 */
class SelectPathItem implements QuickPickItem {
	uri: Uri
	label: string
	description: string

	constructor(uri: Uri) {
		this.uri = uri
		this.label = path.basename(uri.fsPath)
		this.description = `workspace: ${workspace.getWorkspaceFolder(uri)?.name ?? "(unknown)"}`
	}
}

/**
 * A quick pick item for adding a custom project file path.
 */
class CustomPathItem implements QuickPickItem {
	label: string = "$(edit) Add custom path..."
}

/**
 * A quick pick item for a configuration target.
 */
class ConfigTargetItem implements QuickPickItem {
	target: ConfigurationTarget
	label: string
	description: string

	constructor(target: ConfigurationTarget) {
		this.target = target
		this.label = getTargetName(target)
		switch (target) {
			case ConfigurationTarget.Global:
				this.description = "(Add to user settings)"
				break
			case ConfigurationTarget.Workspace:
				this.description = "(Add to workspace settings)"
				break
			case ConfigurationTarget.WorkspaceFolder:
				this.description = "(Add to workspace folder settings)"
				break
		}
	}
}

/**
 * Shows a dialog for configuing the projectFiles setting.
 */
export async function configureCommand(_ext: Ext) {
	const inspect = settings.inspectProjectFiles()
	if (inspect === undefined) {
		window.showErrorMessage("Failed to get the projectFiles setting.")
		return
	}

	const item = await mainMenu(inspect)
	if (item instanceof AddItem) {
		await addProjectFile(inspect)
	} else if (item instanceof ExistingItem) {
		await modifyMenu(inspect, item)
	}
}

/**
 * Shows a quick pick for the main menu.
 */
async function mainMenu(
	inspect: InspectResult<ProjectFile[]>,
): Promise<ExistingItem | AddItem | undefined> {
	const items = [
		new AddItem(),
		new SeparatorItem(getTargetName(ConfigurationTarget.Global)),
		...ExistingItem.fromInspect(inspect, ConfigurationTarget.Global),
		new SeparatorItem(getTargetName(ConfigurationTarget.Workspace)),
		...ExistingItem.fromInspect(inspect, ConfigurationTarget.Workspace),
		new SeparatorItem(getTargetName(ConfigurationTarget.WorkspaceFolder)),
		...ExistingItem.fromInspect(inspect, ConfigurationTarget.WorkspaceFolder),
	]

	return window.showQuickPick(items, {
		title: "Configure project files",
		placeHolder:
			"Pick an existing project file, or add a new one (type to search)",
	})
}

/**
 * Shows a quick pick for the modify menu.
 */
async function modifyMenu(
	inspect: InspectResult<ProjectFile[]>,
	existingItem: ExistingItem,
): Promise<void> {
	const projectFiles = getConfigForTarget(inspect, existingItem.target) ?? []

	const items = []

	if (existingItem.index > 0) {
		items.push(new ShiftExistingItem(existingItem, true))
	}

	if (existingItem.index < projectFiles.length - 1) {
		items.push(new ShiftExistingItem(existingItem, false))
	}

	items.push(new RemoveExistingItem(existingItem))

	const item = await window.showQuickPick(items, {
		title: "Modify project file",
		placeHolder: "(type to search)",
	})

	if (item instanceof ShiftExistingItem) {
		const newIndex = item.isUpOrDown
			? existingItem.index - 1
			: existingItem.index + 1

		// Swap the items and save.
		;[projectFiles[existingItem.index], projectFiles[newIndex]] = [
			projectFiles[newIndex],
			projectFiles[existingItem.index],
		]
		await settings.setProjectFiles(projectFiles, existingItem.target)
	} else if (item instanceof RemoveExistingItem) {
		await removeProjectFile(inspect, existingItem)
	}
}

async function addProjectFile(
	inspect: InspectResult<ProjectFile[]>,
): Promise<void> {
	const projectPath = await pickPathToAdd()
	if (projectPath === undefined) {
		return
	}

	const projectGlob = await inputGlob()
	if (projectGlob === undefined) {
		return
	}

	const target = await pickConfigTarget()
	if (target === undefined) {
		return
	}

	const projectFiles = getConfigForTarget(inspect, target) ?? []
	projectFiles.push({ path: projectPath, glob: projectGlob })
	await settings.setProjectFiles(projectFiles, target)
}

async function pickPathToAdd(): Promise<string | undefined> {
	const files = await workspace.findFiles(PROJECT_GLOB)
	const items = [
		new CustomPathItem(),
		...files.map((u) => new SelectPathItem(u)),
	]
	const item = await window.showQuickPick(items, {
		title: "Add project file (1/3)",
		placeHolder: `Pick an existing path to add, or add a custom path (type to search)`,
	})

	if (item instanceof SelectPathItem) {
		return workspace.asRelativePath(item.uri)
	} else if (item instanceof CustomPathItem) {
		return await window.showInputBox({ prompt: "Enter a custom path" })
	}
	return undefined
}

async function inputGlob(): Promise<string | undefined> {
	return await window.showInputBox({
		title: "Add project file (2/3)",
		prompt:
			"Enter the glob to identify files for adding to/removal from the project.",
		value: "**/*",
	})
}

async function pickConfigTarget(): Promise<ConfigurationTarget | undefined> {
	const items = Object.values(ConfigurationTarget)
		.filter((t) => typeof t === "number")
		.map((t) => new ConfigTargetItem(t))
	const item = await window.showQuickPick(items, {
		title: "Add project file (3/3)",
		placeHolder: "Pick where to add the configuration to.",
	})

	return item?.target
}

async function removeProjectFile(
	inspect: InspectResult<ProjectFile[]>,
	removeItem: ExistingItem,
): Promise<void> {
	const items = [new DecisionItem(Decision.Yes), new DecisionItem(Decision.No)]
	const item = await window.showQuickPick(items, {
		title: "Remove project file",
		placeHolder: `Remove the project file ${removeItem.file.path} (${removeItem.file.glob}) from ${getTargetName(removeItem.target)} settings?`,
	})

	if (item?.decision === Decision.Yes) {
		const projectFiles = getConfigForTarget(inspect, removeItem.target) ?? []

		if (removeItem.index < projectFiles.length) {
			projectFiles.splice(removeItem.index, 1)
			await settings.setProjectFiles(projectFiles, removeItem.target)
		}
	}
}

function getConfigForTarget<T>(
	inspect: InspectResult<T>,
	target: ConfigurationTarget,
): T | undefined {
	switch (target) {
		case ConfigurationTarget.Global:
			return inspect.globalValue ?? undefined

		case ConfigurationTarget.Workspace:
			return inspect.workspaceValue ?? undefined

		case ConfigurationTarget.WorkspaceFolder:
			return inspect.workspaceFolderValue ?? undefined
	}
}

function getTargetName(target: ConfigurationTarget) {
	return spaceCase(ConfigurationTarget[target])
}
