/*
 * This file was automatically generated by 'npm run types'.
 *
 * DO NOT MODIFY IT BY HAND!
 */

// tslint:disable: array-type

import type { Contract, ContractDefinition } from '../';

export interface OrgData {
	profile?: {
		description?: string;
		[k: string]: unknown;
	};
	[k: string]: unknown;
}

export interface OrgContractDefinition extends ContractDefinition<OrgData> {}

export interface OrgContract extends Contract<OrgData> {}
