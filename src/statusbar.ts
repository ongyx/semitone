import {
	type ExtensionContext,
	MarkdownString,
	StatusBarAlignment,
	type StatusBarItem,
	ThemeColor,
	window,
} from "vscode"
import type { Csproj } from "./csproj"
import { EXT_NAME } from "./settings"

const COMMAND_ADD = `extension.${EXT_NAME}.add`
const COMMAND_REMOVE = `extension.${EXT_NAME}.remove`
// See https://code.visualstudio.com/api/references/vscode-api#StatusBarItem
const BG_ERROR = new ThemeColor("statusBarItem.errorBackground")
const BG_WARNING = new ThemeColor("statusBarItem.warningBackground")

/**
 * The possible file statuses.
 */
export enum Status {
	/**
	 * The file is contained in a project.
	 */
	InProject,
	/**
	 * The file is not contained in a project.
	 */
	NotInProject,
	/**
	 * No project matches the file.
	 */
	ProjectNotFound,
	/**
	 * The file is ignored by user/workspace settings.
	 */
	Ignored,
	/**
	 * No status is available.
	 */
	Unavailable,
}

/**
 * A status bar for the active file.
 */
export class StatusBar {
	private _item: StatusBarItem
	private _status: Status = Status.Unavailable

	constructor(context: ExtensionContext) {
		this._item = window.createStatusBarItem(StatusBarAlignment.Left)
		this.unavailable()

		context.subscriptions.push(this._item)
	}

	/**
	 * The status of the active file.
	 */
	get status(): Status {
		return this._status
	}

	/**
	 * Indicates that the active file is in a project.
	 * @param csproj The project.
	 */
	inProject(csproj: Csproj) {
		this._item.text = `$(folder-active) Contained in ${csproj.name}`
		this._item.command = COMMAND_REMOVE
		this._item.backgroundColor = undefined
		this._item.tooltip = new MarkdownString(
			`Click to remove this file from the project.`,
		)
		this._item.show()
		this._status = Status.InProject
	}

	/**
	 * Indicates that the active file is not in a project.
	 * @param csproj The project.
	 */
	notInProject(csproj: Csproj) {
		this._item.text = `$(folder) Add to ${csproj.name}`
		this._item.command = COMMAND_ADD
		this._item.backgroundColor = undefined
		this._item.tooltip = new MarkdownString(
			`Click to add this file to the project.`
		)
		this._item.show()
		this._status = Status.NotInProject
	}

	projectNotFound() {
		this._item.text = `$(question) Project not found`
		this._item.command = undefined
		this._item.backgroundColor = BG_ERROR
		this._item.tooltip = new MarkdownString(
			`File does not match to any project, please check your \`csproj.projectFiles\` user/workspace setting.`
		)
		this._item.show()
		this._status = Status.ProjectNotFound
	}

	/**
	 * Indicates that the active file is ignored by user/workspace settings.
	 */
	ignored() {
		this._item.text = `$(info) Ignored`
		this._item.command = undefined
		this._item.backgroundColor = BG_WARNING
		this._item.tooltip = new MarkdownString(
			`File is ignored by one of these user/workspace settings:
* \`csproj.include\`
* \`csproj.exclude\`
* \`csproj.ignoredPaths\` (run "csproj: Clear ignored paths")`
		)
		this._item.show()
		this._status = Status.Ignored
	}

	/**
	 * Indicates that the active file's status is unavailable.
	 */
	unavailable() {
		this._item.hide()
		this._status = Status.Unavailable
	}
}
