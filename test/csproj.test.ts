import * as assert from "node:assert"
import * as fs from "node:fs/promises"
import { Csproj } from "../src/csproj"
import { TempFs } from "./tempfs"

const MOCK_FILES = {
	"Test1.cs": `Console.WriteLine("Hello World!");`,
	"Test2.ts": `console.log("Hello World!")`,
	"Test3.html":
		"<!DOCTYPE html><html><body><h1>Hello World!</h1></body></html>",
}

const CSP_ORIGINAL = `<?xml version="1.0" encoding="utf-8"?><Project />`
const CSP_MODIFIED = `<?xml version="1.0" encoding="utf-8"?><Project><ItemGroup><Compile Include="src\\Test1.cs" /></ItemGroup><ItemGroup><TypescriptCompile Include="src\\Test2.ts" /></ItemGroup><ItemGroup><Content Include="src\\Test3.html" /></ItemGroup></Project>`

describe("csproj", () => {
	let tfs: TempFs | undefined

	beforeEach(async () => {
		tfs = await TempFs.create()
	})

	afterEach(async () => {
		tfs?.remove()
	})

	it("should add multiple items to the project", async () => {
		assert.ok(tfs)
		await tfs.mock({
			"Test.csproj": CSP_ORIGINAL,
			...MOCK_FILES,
		})

		const csproj = await Csproj.open(tfs.absuri("Test.csproj"))

		csproj.addItem("Compile", tfs.absuri("src/Test1.cs"))
		csproj.addItem("TypescriptCompile", tfs.absuri("src/Test2.ts"))
		csproj.addItem("Content", tfs.absuri("src/Test3.html"))

		assert.strictEqual(csproj.serialize(), CSP_MODIFIED)
	})

	it("should remove multiple items from the project", async () => {
		assert.ok(tfs)
		await tfs.mock({
			"Test.csproj": CSP_MODIFIED,
			...MOCK_FILES,
		})

		const csproj = await Csproj.open(tfs.absuri("Test.csproj"))

		csproj.removeItem(tfs.absuri("src/Test1.cs"))
		csproj.removeItem(tfs.absuri("src/Test2.ts"))
		csproj.removeItem(tfs.absuri("src/Test3.html"))

		assert.strictEqual(csproj.serialize(), CSP_ORIGINAL)
	})

	it("should save the project to disk identically", async () => {
		assert.ok(tfs)
		await tfs.mock({
			"Test.csproj": CSP_ORIGINAL,
			...MOCK_FILES,
		})

		const identicalPath = tfs.absuri("TestIdentical.csproj")

		const csproj = await Csproj.open(tfs.absuri("Test.csproj"))
		await csproj.save(identicalPath)

		const data = await fs.readFile(identicalPath.fsPath, "utf8")
		assert.strictEqual(data, CSP_ORIGINAL)
	})
})
