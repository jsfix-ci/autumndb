/*
 * This file was automatically generated by 'npm run types'.
 *
 * DO NOT MODIFY IT BY HAND!
 */

// tslint:disable: array-type

import type { Contract, ContractDefinition } from '../';

export interface AuthenticationPasswordData {
	actorId: string;
	hash: string;
	[k: string]: unknown;
}

export interface AuthenticationPasswordContractDefinition
	extends ContractDefinition<AuthenticationPasswordData> {}

export interface AuthenticationPasswordContract
	extends Contract<AuthenticationPasswordData> {}