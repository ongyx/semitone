import * as assert from "node:assert"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { type CheerioAPI, load } from "cheerio"
import { ElementType } from "domelementtype"
import { Element, Text } from "domhandler"
import {
	detectIndent,
	getNodes,
	isWhitespace,
	type NodeYield,
	trimAfter,
	trimBefore,
	trimEnd,
} from "../src/utils"

const loadXml = (src: string): CheerioAPI => load(src, { xml: true })

describe("utils", () => {
	describe("isWhitespace()", () => {
		it("should detect whitespace", () => {
			assert.ok(isWhitespace(new Text("\r\n  ")))
		})

		it("should not detect whitespace", () => {
			assert.ok(!isWhitespace(new Text("lol")))
			assert.ok(!isWhitespace(new Element("p", {})))
		})
	})

	describe("trimBefore()", () => {
		it("should trim preceding whitespace siblings", () => {
			const doc = loadXml(`<?xml version="1.0" encoding="utf-8"?>
<Project>

  <ItemGroup/>
</Project>`)
			const itemGroup = doc("ItemGroup")[0]
			trimBefore(doc, itemGroup)
			const prevNode = itemGroup.prev
			assert.ok(prevNode === null || !isWhitespace(prevNode))
		})

		it("should not trim non-whitespace siblings", () => {
			const doc = loadXml(`<?xml version="1.0" encoding="utf-8"?>
<Project>text<ItemGroup/></Project>`)
			const itemGroup = doc("ItemGroup")[0]
			const prevBefore = itemGroup.prev
			trimBefore(doc, itemGroup)
			assert.strictEqual(itemGroup.prev, prevBefore)
		})
	})

	describe("trimAfter()", () => {
		it("should trim following whitespace siblings", () => {
			const doc = loadXml(`<?xml version="1.0" encoding="utf-8"?>
<Project>
  <ItemGroup/>

</Project>`)
			const itemGroup = doc("ItemGroup")[0]
			trimAfter(doc, itemGroup)
			const nextNode = itemGroup.next
			assert.ok(nextNode === null || !isWhitespace(nextNode))
		})

		it("should not trim non-whitespace siblings", () => {
			const doc = loadXml(`<?xml version="1.0" encoding="utf-8"?>
<Project><ItemGroup/>text</Project>`)
			const itemGroup = doc("ItemGroup")[0]
			const nextBefore = itemGroup.next
			trimAfter(doc, itemGroup)
			assert.strictEqual(itemGroup.next, nextBefore)
		})
	})

	describe("trimEnd()", () => {
		it("should trim trailing whitespace children", () => {
			const doc = loadXml(`<?xml version="1.0" encoding="utf-8"?>
<Project>
  <ItemGroup>
	<Compile/>

  </ItemGroup>
</Project>`)
			const itemGroup = doc("ItemGroup")[0]
			trimEnd(doc, itemGroup)
			assert.ok(itemGroup.lastChild)
			assert.ok(!isWhitespace(itemGroup.lastChild))
		})

		it("should not trim non-whitespace children", () => {
			const doc = loadXml(`<?xml version="1.0" encoding="utf-8"?>
<Project>
  <ItemGroup>
	<Compile/>text
  </ItemGroup>
</Project>`)
			const itemGroup = doc("ItemGroup")[0]
			const lengthBefore = itemGroup.children.length
			trimEnd(doc, itemGroup)
			// NOTE: The content of the last text node is 'text(newline)    ', so it will not be trimmed.
			// This is intended behaviour.
			assert.strictEqual(itemGroup.children.length, lengthBefore)
		})

		it("should trim all trailing whitespace until non-whitespace", () => {
			const doc = loadXml(`<?xml version="1.0" encoding="utf-8"?>
<Project>
  <ItemGroup>
	<Compile/>


  </ItemGroup>
</Project>`)
			const itemGroup = doc("ItemGroup")[0]
			trimEnd(doc, itemGroup)
			assert.ok(itemGroup.lastChild)
			assert.strictEqual(itemGroup.lastChild.type, ElementType.Tag)
		})
	})

	describe("detectIndent()", () => {
		it("should detect no indent", () => {
			const doc = loadXml(`<?xml version="1.0" encoding="utf-8"?><Project/>`)
			assert.deepStrictEqual(detectIndent(doc), { newline: "", whitespace: "" })
		})

		it("should detect indent partially", () => {
			const doc1 = loadXml(`<?xml version="1.0" encoding="utf-8"?>
<Project/>`)
			assert.deepStrictEqual(detectIndent(doc1), {
				newline: "\n",
				whitespace: "  ",
			})

			// Make sure detection falls back if the 2nd Text node is just a newline.
			const doc2 = loadXml(`<?xml version="1.0" encoding="utf-8"?>
<Project/>
`)
			assert.deepStrictEqual(detectIndent(doc2), {
				newline: "\n",
				whitespace: "  ",
			})
		})

		it("should detect indent", async () => {
			const doc = loadXml(
				await fs.readFile(
					path.join(__dirname, "../../test/fixtures/Sample.csproj"),
					"utf8",
				),
			)
			assert.deepStrictEqual(detectIndent(doc), {
				newline: "\r\n",
				whitespace: "  ",
			})
		})
	})

	describe("getNodes()", () => {
		it("should get nodes in order", () => {
			const doc = loadXml(`<?xml version="1.0" encoding="utf-8"?>
<Project>
  <ItemGroup>
	<Compile Include="test.cs"/>
  </ItemGroup>
</Project>
`)
			const testCases: [ElementType, number][] = [
				[ElementType.Directive, 0],
				// The newline and whitespace count as a text node.
				[ElementType.Text, 0],
				[ElementType.Tag, 0],
				[ElementType.Text, 1],
				[ElementType.Tag, 1],
				[ElementType.Text, 2],
				[ElementType.Tag, 2],
				[ElementType.Text, 2],
				[ElementType.Text, 1],
				[ElementType.Text, 0],
			]
			const nodeYields = Array.from(getNodes(doc))
			const zipped: [[ElementType, number], NodeYield][] = testCases.map(
				(n, i) => [n, nodeYields[i]],
			)

			for (const [
				index,
				[[testType, testDepth], { node, depth }],
			] of zipped.entries()) {
				assert.strictEqual(
					node.type,
					testType,
					`Test case #${index}: expected node type ${testType}, got ${node.type}`,
				)
				assert.strictEqual(
					depth,
					testDepth,
					`Test case #${index}: expected depth ${testDepth}, got ${depth}`,
				)
			}
		})
	})
})