import * as fs from "node:fs/promises"
import { TempFs } from "./tempfs"

import path = require("node:path")
import assert = require("node:assert")

describe("tempfs", () => {
	let tfs: TempFs | undefined

	afterEach(async () => {
		tfs?.remove()
	})

	it("should create a tempfs on disk", async () => {
		tfs = await TempFs.create()

		const text = "Hello World!"
		const textPath = path.join(tfs.root, "test.txt")
		await fs.writeFile(textPath, text)

		assert.strictEqual(await fs.readFile(textPath, "utf8"), text)
	})

	it("should mock files in the tempfs", async () => {
		tfs = await TempFs.create()

		const buf = Buffer.alloc(8)
		buf.writeBigInt64LE(BigInt(42))

		await tfs.mock({
			"str.txt": "str",
			"buf.bin": buf,
			deeply: {
				nested: {
					dir: {
						"README.md": "# Hello World!",
					},
				},
			},
		})

		assert.strictEqual(
			await fs.readFile(path.join(tfs.root, "str.txt"), "utf8"),
			"str",
		)

		const readBuf = await fs.readFile(path.join(tfs.root, "buf.bin"))
		assert.ok(readBuf.equals(buf))

		assert.strictEqual(
			await fs.readFile(
				path.join(tfs.root, "deeply", "nested", "dir", "README.md"),
				"utf8",
			),
			"# Hello World!",
		)
	})
})
