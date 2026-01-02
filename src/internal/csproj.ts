import * as path from "node:path"
import { type Cheerio, type CheerioAPI, loadBuffer } from "cheerio"
import { ElementType } from "domelementtype"
import { type AnyNode, Text } from "domhandler"
import { type Uri, workspace } from "vscode"
import {
	detectIndent,
	getNodes,
	type Indent,
	trimAfter,
	trimBefore,
	trimEnd,
} from "./utils"

const RE_SELF_CLOSING_TAG = /\/>$/gm

/**
 * An MSBuild project.
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
	private readonly xml: CheerioAPI
	/**
	 * The indentation in use.
	 */
	private readonly indent: Indent

	/**
	 * Parses a project on disk.
	 * @param uri The URI of the project.
	 * @returns The project.
	 */
	static async open(uri: Uri): Promise<Csproj> {
		const data = await workspace.fs.readFile(uri)
		// According to NodeJS docs, this avoids an allocation.
		// https://nodejs.org/api/buffer.html#static-method-bufferfromarraybuffer-byteoffset-length
		const buf = Buffer.from(data.buffer)
		const xml = loadBuffer(buf, { xml: true })
		const csproj = new Csproj(uri, xml)

		return csproj
	}

	// NOTE: Constructor is necessary to satisfy readonly properties.
	private constructor(uri: Uri, xml: CheerioAPI) {
		this.name = path.basename(uri.fsPath)
		this.uri = uri
		this.xml = xml
		this.indent = detectIndent(xml)
	}

	/**
	 * Adds an item into the project.
	 * @param itemType The item type.
	 * @param uri The URI to reference in the item.
	 */
	addItem(itemType: string, uri: Uri) {
		const groups = this.xml(`ItemGroup:has(${itemType})`)

		let group: Cheerio<AnyNode>
		if (groups.length > 0) {
			// Get the last ItemGroup element containing the item type.
			group = groups.last()
		} else {
			// Create a new ItemGroup for the item type.
			// NOTE: ItemGroups go under the top-level Project element.
			group = this.xml("<ItemGroup/>").appendTo(this.xml("Project"))
		}

		this.xml(`<${itemType}/>`)
			.attr("Include", this.asRelativePath(uri))
			.appendTo(group)
	}

	/**
	 * Checks if the item exists in the project.
	 * @param uri The URI referenced by the item.
	 * @returns True if so, otherwise false.
	 */
	hasItem(uri: Uri): boolean {
		const rel = this.asRelativePath(uri, true)

		return this.xml(`ItemGroup > *[Include="${rel}"]`).length > 0
	}

	/**
	 * Removes items from the project.
	 * @param uri The URI referenced by the item(s), or a directory URI.
	 * @returns True if one or more items were removed, otherwise false.
	 */
	removeItem(uri: Uri): boolean {
		const rel = this.asRelativePath(uri, true)

		// Find all items with the file path.
		const items = this.xml(`ItemGroup > *[Include="${rel}"]`)
		items.remove()

		// Remove any empty ItemGroups.
		this.xml(`ItemGroup:not(:has(*))`).remove()

		return items.length > 0
	}

	/**
	 * Prettifies the project document by adding indentation where necessary.
	 */
	prettify(): void {
		const newline = this.indent.newline
		const whitespace = this.indent.whitespace

		for (const { node, depth } of getNodes(this.xml)) {
			if (node.type === ElementType.Tag) {
				// Delete opening and closing indent, if any.
				trimBefore(this.xml, node)
				trimEnd(this.xml, node)

				if (whitespace !== "") {
					// Add whitespace to the tag according to depth.
					const indentation = `${newline}${whitespace.repeat(depth)}`

					this.xml(new Text(indentation)).insertBefore(this.xml(node))

					// Only add the closing indent if the node contains tags.
					if (node.children.some((n) => n.type === ElementType.Tag)) {
						this.xml(new Text(indentation)).appendTo(this.xml(node))
					}
				}
			}
		}

		// If the Project element is empty, clear all nodes.
		const project = this.xml("Project")
		if (project.children().length === 0) {
			project.empty()
		}

		// Delete trailing whitespace, then add a single newline after the Project element.
		trimAfter(this.xml, project[0])
		this.xml(new Text(this.indent.newline)).insertAfter(project)
	}

	/**
	 * Serializes the project to XML. {@link prettify} is automatically called.
	 * @returns The serialized XML.
	 */
	serialize(): string {
		this.prettify()
		// Add a space to all self-closing tags (e.g., <Compile Include="..."/> becomes <Compile Include="..." />)
		return this.xml.xml().replace(RE_SELF_CLOSING_TAG, " />")
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
	 * Computes the path relative to the project directory.
	 * @param uri The URI path.
	 * @param isSelectorQuery Whether or not to use double backslashes instead of one, for use with `querySelector()`.
	 * @returns The relative path.
	 */
	private asRelativePath(uri: Uri, isSelectorQuery: boolean = false): string {
		const rel = path.relative(path.dirname(this.uri.fsPath), uri.fsPath)
		// Always use windows-style seperators.
		return rel.replaceAll(path.sep, isSelectorQuery ? "\\\\" : "\\")
	}
}
