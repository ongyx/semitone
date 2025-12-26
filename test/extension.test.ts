import * as assert from "node:assert"
import * as timers from "node:timers/promises"
import * as sinon from "sinon"
import { commands, Uri, window, workspace } from "vscode"

describe("extension", () => {
	it("prompts to add a file to csproj when opened", async () => {
		await commands.executeCommand("workbench.action.closeAllEditors")

		const spy = sinon.spy(window, "showInformationMessage")

		const folder = workspace.workspaceFolders?.[0]
		assert.ok(folder)
		const td = await workspace.openTextDocument(Uri.joinPath(folder.uri, "src/HelloWorld.cs"))
		await window.showTextDocument(td)

		// Wait a second, in case showInformationMessage isn't called quickly enough.
		await timers.setTimeout(1000)

		assert.ok(spy.calledOnce)
		assert.strictEqual(
			spy.args[0][0],
			"Would you like to add HelloWorld.cs to Sample.csproj?",
		)
	})
})
