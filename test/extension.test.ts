import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect } from "chai"
import * as mockFs from "mock-fs"
import * as sinon from "sinon"
import { Uri, window, workspace } from "vscode"

const up = "../.."

const sampleCsproj = readFileSync(
	join(__dirname, up, "test/fixtures/Sample.csproj"),
)

function toUri(path: string) {
	return Uri.file(join(process.cwd(), path))
}

suite("csproj integration tests", () => {
	suiteSetup(() => {
		// really want a way to set `workspace.rootPath` here.
		process.chdir("../../../..")
		mockFs({
			dir1: {
				"file1.ext1": "f1",
				"file2.ext2": "f2",
			},
			"Project1.csproj": sampleCsproj,
		})
	})

	test("prompts to add a file to csproj when opened", (done) => {
		const askSpy = sinon.spy(window, "showInformationMessage")
		// console.info(process.cwd())
		expect(readFileSync("dir1/file1.ext1").toString()).to.equal("f1")
		// console.info(toUri('dir1').fsPath)
		workspace.openTextDocument(toUri("dir1/file1.ext1")).then(
			(_td) => {
				expect(askSpy.calledOnce)
				expect(askSpy.args[0][0]).to.equal(
					`file1.ext1 is not in Project1.csproj, would you like to add it?`,
					"prompt",
				)
				done()
			},
			(err) => {
				expect(err).not.to.exist
				done()
			},
		)
	})

	suiteTeardown(() => {
		mockFs.restore()
	})
})
