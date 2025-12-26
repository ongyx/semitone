import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { Uri } from "vscode"

const PREFIX = "tempfs-"

/**
 * A directory to mock within a `TmpFs`.
 */
export interface MockDir {
	[name: string]: MockItem
}

/**
 * A file or sub-directory to mock within a `TmpFs`.
 */
export type MockItem = string | Buffer | MockDir

/**
 * A temporary filesystem that resides on disk.
 * Make sure to call `remove()` to clean up the filesystem after use.
 */
export class TempFs {
	/**
	 * The root of the tempfs.
	 */
	readonly root: string

	/**
	 * Creates a new temporary filesystem.
	 * @param mockDir The mock directory to write to the tempfs.
	 * @returns The new tempfs.
	 */
	static async create(mockDir?: MockDir): Promise<TempFs> {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
		const tempfs = new TempFs(root)

		if (mockDir !== undefined) {
			await tempfs.mock(mockDir)
		}

		return tempfs
	}

	private constructor(root: string) {
		this.root = root
	}

	/**
	 * Populates the tempfs with a mock directory.
	 * @param mockDir The mock directory.
	 */
	async mock(mockDir: MockDir): Promise<void> {
		const populateInner = async (prefix: string, mockDir: MockDir) => {
			// Ensure the prefix exists.
			await fs.mkdir(prefix, { recursive: true })

			for (const [name, item] of Object.entries(mockDir)) {
				const itemPath = path.join(prefix, name)

				if (typeof item === "string" || Buffer.isBuffer(item)) {
					// Write the data to the file.
					await fs.writeFile(itemPath, item)
				} else if (item instanceof Object) {
					// Recurse into the sub-directory.
					await populateInner(itemPath, item)
				}
			}
		}

		await populateInner(this.root, mockDir)
	}

	/**
	 * Returns the absolute path for a relative path in the tempfs.
	 * @param rel The relative path.
	 * @returns The absolute path.
	 */
	abspath(rel: string): string {
		return path.join(this.root, rel)
	}

	/**
	 * Returns an absolute URI for a relative path in the tempfs.
	 * @param rel The relative path.
	 * @returns The absolute URI.
	 */
	absuri(rel: string): Uri {
		return Uri.file(this.abspath(rel))
	}

	/**
	 * Removes the tempfs from disk.
	 */
	async remove(): Promise<void> {
		await fs.rm(this.root, { recursive: true, force: true })
	}
}
