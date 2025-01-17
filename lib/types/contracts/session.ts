/*
 * This file was automatically generated by 'npm run types'.
 *
 * DO NOT MODIFY IT BY HAND!
 */

// tslint:disable: array-type

import type { Contract, ContractDefinition } from '../';

export interface SessionData {
	actor: string;
	expiration?: string;
	scope?: {
		[k: string]: unknown;
	};
	token?: {
		authentication?: string;
		[k: string]: unknown;
	};
	[k: string]: unknown;
}

export interface SessionContractDefinition
	extends ContractDefinition<SessionData> {}

export interface SessionContract extends Contract<SessionData> {}
