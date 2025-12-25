import * as path from "node:path"
import { DOMParser } from "linkedom"
import type { Element } from "linkedom/types/interface/element"
import type { XMLDocument } from "linkedom/types/xml/document"
import { type Uri, workspace } from "vscode"

/**
 * An MSBuild project file parsed from XML.
 */
export class Csproj {
	/**
	 * The name of the file.
	 */
	readonly name: string
	/**
	 * The URI of the file.
	 */
	readonly uri: Uri
	/**
	 * The XML document.
	 */
	private readonly _xml: XMLDocument

	/**
	 * Opens a project file on disk and parses it.
	 * @param uri The URI of the project file.
	 * @returns The project.
	 */
	static async open(uri: Uri): Promise<Csproj> {
		const data = await workspace.fs.readFile(uri)
		const xml = new DOMParser().parseFromString(
			new TextDecoder().decode(data),
			"text/xml",
		)
		const csproj = new Csproj(uri, xml)

		return csproj
	}

	// NOTE: Constructor is necessary to satisfy readonly properties.
	private constructor(uri: Uri, xml: XMLDocument) {
		this.name = path.basename(uri.fsPath)
		this.uri = uri
		this._xml = xml
	}

	/**
	 * Adds an item into the project.
	 * @param itemType The item type.
	 * @param uri The URI to reference in the item.
	 */
	addItem(itemType: string, uri: Uri) {
		const groups: Element[] = this._xml.querySelectorAll(
			`ItemGroup:has(${itemType})`,
		)

		let group: Element
		if (groups.length > 0) {
			// Get the last ItemGroup element containing the item type.
			group = groups[groups.length - 1]
		} else {
			// Create a new ItemGroup for the item type.
			// NOTE: ItemGroups go under the top-level Project element.
			const project = this._xml.querySelector("Project")
			group = project.appendChild(
				this._xml.createElement("ItemGroup"),
			) as Element
		}

		const item = group.appendChild(this._xml.createElement(itemType)) as Element
		const rel = this.asRelativePath(uri)
		item.setAttribute("Include", rel)
	}

	/**
	 * Checks if the item exists in the project.
	 * @param uri The URI referenced by the item.
	 * @returns True if so, otherwise false.
	 */
	hasItem(uri: Uri): boolean {
		const rel = this.asRelativePath(uri)

		return this._xml.querySelector(`ItemGroup > *[Include="${rel}"]`) !== null
	}

	/**
	 * Removes items from the project.
	 * @param uri The URI referenced by the item(s), or a directory URI.
	 * @param isDirectory If true, all items prefixed by uri are removed.
	 * @returns True if one or more items were removed, otherwise false.
	 */
	removeItem(uri: Uri, isDirectory: boolean = false): boolean {
		const rel = this.asRelativePath(uri)

		const items: Element[] = isDirectory
			? // Find all items prefixed by the directory path.
				this._xml.querySelectorAll(`ItemGroup > *[Include*="${rel}"]`)
			: // Find all items with the file path.
				this._xml.querySelectorAll(`ItemGroup > *[Include="${rel}"]`)

		for (const item of items) {
			const group = item.parentElement as Element
			if (group.childNodes.length === 1) {
				// The ItemGroup will be empty, so remove it instead.
				group.remove()
			} else {
				// Only remove the item.
				item.remove()
			}
		}

		return items.length > 0
	}

	/**
	 * Serializes the project to XML.
	 * @returns The serialized XML.
	 */
	serialize(): string {
		// NOTE: linkedom doesn't have XMLSerializer; documents are serialized using toString().
		// See https://github.com/WebReflection/linkedom/issues/181
		return this._xml.toString()
	}

	/**
	 * Saves the project back to its original file.
	 * @param to The destination URI to save to instead.
	 */
	async save(to: Uri = this.uri): Promise<void> {
		const data = new TextEncoder().encode(this.serialize())
		await workspace.fs.writeFile(to, data)
	}

	/**
	 * Computes the path relative to the directory of the MSBuild file.
	 * @param uri The URI path.
	 * @returns The relative path.
	 */
	private asRelativePath(uri: Uri): string {
		const base = path.dirname(workspace.asRelativePath(this.uri))
		const rel = path.relative(base, uri.fsPath)

		// Always use windows-style seperators.
		return rel.replace(/\//g, "\\")
	}
}
