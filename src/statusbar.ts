import {
	type ExtensionContext,
	StatusBarAlignment,
	type StatusBarItem,
	window,
} from "vscode"

/**
 * A status bar.
 */
export class StatusBar {
	private _item: StatusBarItem
	private _visible: boolean

	constructor(context: ExtensionContext) {
		this._item = window.createStatusBarItem(StatusBarAlignment.Left)
		this._item.command = "extension.csproj.add"
		this._visible = false

		context.subscriptions.push(this._item)
	}

	/**
	 * Whether or not the status bar is visible.
	 */
	get visible(): boolean {
		return this._visible
	}

	/**
	 * Shows the status bar.
	 * @param name The name of the project file in use.
	 * @param isContained Whether or not the active text editor document is contained in the project.
	 */
	show(name: string, isContained: boolean = false) {
		this._item.text = this._item.tooltip = isContained
			? `Contained in ${name}`
			: `Add to ${name}`
		this._item.show()
		this._visible = true
	}

	/**
	 * Hides the status bar.
	 */
	hide() {
		this._item.text = ""
		this._item.hide()
		this._visible = false
	}
}
