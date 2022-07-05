/*
 * This file was automatically generated by 'npm run types'.
 *
 * DO NOT MODIFY IT BY HAND!
 */

// tslint:disable: array-type

import type { Contract, ContractDefinition } from '../';

/**
 * Command to send a message
 */
export type SendCommand = 'shift+enter' | 'ctrl+enter' | 'enter';
/**
 * Do not play a sound when displaying notifications
 */
export type DisableNotificationSound = boolean;

export interface UserSettingsData {
	actorId: string;
	type?: string;
	/**
	 * The default view that is loaded after you login
	 */
	homeView?: string;
	/**
	 * The loop that the user is currently working on
	 */
	activeLoop?: string | null;
	sendCommand?: SendCommand;
	disableNotificationSound?: DisableNotificationSound;
	/**
	 * List of view slugs that are starred
	 */
	starredViews?: string[];
	/**
	 * A map of settings for view contracts, keyed by the view id
	 */
	viewSettings?: {
		/**
		 * This interface was referenced by `undefined`'s JSON-Schema definition
		 * via the `patternProperty` "^.*$".
		 */
		[k: string]: {
			[k: string]: unknown;
		};
	};
	[k: string]: unknown;
}

export interface UserSettingsContractDefinition
	extends ContractDefinition<UserSettingsData> {}

export interface UserSettingsContract extends Contract<UserSettingsData> {}
