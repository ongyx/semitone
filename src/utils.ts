import type { Cheerio, CheerioAPI } from "cheerio"
import { ElementType } from "domelementtype"
import type { AnyNode, ParentNode, Text } from "domhandler"

/**
 * The result of {@link detectIndent}.
 */
export interface Indent {
	/**
	 * The newline used in the document, usually '\r\n' for project files.
	 */
	newline: string
	/**
	 * The whitespace for one level of indentation.
	 */
	whitespace: string
}

/**
 * The yield result of {@link getNodes}.
 */
export interface NodeYield {
	/**
	 * The node.
	 */
	node: AnyNode
	/**
	 * The depth at which the node is located, where 0 indicates that the node is top-level.
	 */
	depth: number
}

/**
 * Checks if a node is a {@link Text} node with only whitespace.
 * @param node The node.
 * @returns True if so, otherwise false.
 */
export function isWhitespace(node: AnyNode): boolean {
	return node.type === ElementType.Text && node.data.trim() === ""
}

/**
 * Trims all preceding sibling {@link Text} nodes consisting of whitespace.
 * @param doc The document.
 * @param node The node.
 */
export function trimBefore(doc: CheerioAPI, node: AnyNode) {
	if (node.prev !== null && isWhitespace(node.prev)) {
		doc(node.prev).remove()
	}
}

/**
 * Trims all following {@link Text} nodes consisting of whitespace.
 * @param doc The document.
 * @param node The node.
 */
export function trimAfter(doc: CheerioAPI, node: AnyNode) {
	if (node.next !== null && isWhitespace(node.next)) {
		doc(node.next).remove()
	}
}

/**
 * Trims all trailing child {@link Text} nodes consisting of whitespace.
 * @param doc The document.
 * @param node The parent node.
 */
export function trimEnd(doc: CheerioAPI, node: ParentNode) {
	for (let i = node.children.length - 1; i >= 0; i--) {
		const child = node.children[i]
		if (isWhitespace(child)) {
			doc(child).remove()
		} else {
			break
		}
	}
}

/**
 * Detects the indentation used in a document.
 * @param doc The document.
 * @returns The indentation used.
 */
export function detectIndent(doc: CheerioAPI): Indent {
	function* getTextNodes(): Generator<Text, undefined, undefined> {
		for (const { node } of getNodes(doc)) {
			if (node.type === ElementType.Text) {
				yield node
			}
		}
	}

	const textNodes = getTextNodes()
	const first = textNodes.next().value?.data
	const second = textNodes.next().value?.data

	if (first === undefined || first.trim() !== "") {
		// Document has no whitespace.
		return { newline: "", whitespace: "" }
	}

	if (second === undefined || second === first || second.trim() !== "") {
		// Document has no whitespace after the Project element, or the second whitespace only consists of a newline.
		return { newline: first, whitespace: "  " }
	}

	return {
		newline: first,
		whitespace: second.replace(first, ""),
	}
}

/**
 * Returns an iterable over all nodes in a document.
 * @param doc The document.
 * @param root The root element to start iterating from.
 * @returns The iterable.
 */
export function getNodes(
	doc: CheerioAPI,
	root?: Cheerio<AnyNode>,
): Generator<NodeYield, undefined, undefined> {
	root ??= doc.root()

	function* inner(
		node: AnyNode | Cheerio<AnyNode>,
		depth: number,
	): Generator<NodeYield, undefined, undefined> {
		for (const child of doc(node).contents()) {
			yield { node: child, depth }
			yield* inner(child, depth + 1)
		}
	}

	return inner(root, 0)
}
