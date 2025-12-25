import * as assert from "node:assert"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Uri } from "vscode"
import { Csproj } from "../src/csproj"

const CSP_ORIGINAL = `<?xml version="1.0" encoding="utf-8"?><Project />`
const CSP_MODIFIED = `<?xml version="1.0" encoding="utf-8"?><Project><ItemGroup><Compile Include="Test1.cs" /></ItemGroup><ItemGroup><TypescriptCompile Include="Test2.ts" /></ItemGroup><ItemGroup><Content Include="Test3.html" /></ItemGroup></Project>`

suite("csproj", () => {
	let tempDir = ""

	suiteSetup(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "test-"))
	})

	test("addItem", async () => {
		const csprojPath = join(tempDir, "test.csproj")
		await writeFile(csprojPath, CSP_ORIGINAL)

		const csproj = await Csproj.open(Uri.file(csprojPath))

		csproj.addItem("Compile", Uri.file(join(tempDir, "Test1.cs")))
		csproj.addItem("TypescriptCompile", Uri.file(join(tempDir, "Test2.ts")))
		csproj.addItem("Content", Uri.file(join(tempDir, "Test3.html")))

		assert.strictEqual(csproj.serialize(), CSP_MODIFIED)
	})

	test("removeItem", async () => {
		const csprojPath = join(tempDir, "test.csproj")
		await writeFile(csprojPath, CSP_MODIFIED)

		const csproj = await Csproj.open(Uri.file(csprojPath))

		csproj.removeItem(Uri.file(join(tempDir, "Test1.cs")))
		csproj.removeItem(Uri.file(join(tempDir, "Test2.ts")))
		csproj.removeItem(Uri.file(join(tempDir, "Test3.html")))

		assert.strictEqual(csproj.serialize(), CSP_ORIGINAL)
	})

	test("save", async () => {
		const csprojPath = join(tempDir, "test.csproj")
		const newCsprojPath = join(tempDir, "test_identical.csproj")
		await writeFile(csprojPath, CSP_ORIGINAL)

		const csproj = await Csproj.open(Uri.file(csprojPath))
		await csproj.save(Uri.file(newCsprojPath))

		const data = await readFile(newCsprojPath, { encoding: "utf-8" })
		assert.strictEqual(data, CSP_ORIGINAL)
	})

	suiteTeardown(async () => {
		await rm(tempDir, { recursive: true })
	})
})
