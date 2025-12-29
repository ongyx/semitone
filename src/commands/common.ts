/**
 * Decision constants for prompts.
 */
export enum Decision {
	Yes = "Yes",
	No = "No",
	Never = "Never",
}

/**
 * Common command options.
 */
export interface CommandOptions {
	/**
	 * Whether or not messages should be shown.
	 */
	verbose: boolean

	/**
	 * Whether or not the command was called from an event listener.
	 */
	isEvent: boolean
}
