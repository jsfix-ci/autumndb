/*
 * This file was automatically generated by 'npm run types'.
 *
 * DO NOT MODIFY IT BY HAND!
 */

// tslint:disable: array-type

import type { Contract, ContractDefinition } from '../';

export interface ViewData {
	actor?: string;
	namespace?: string;
	schema?: {
		[k: string]: unknown;
	};
	anyOf?: {
		name: string;
		schema: {
			type: 'object';
			[k: string]: unknown;
		};
	}[];
	allOf?: {
		name: string;
		schema: {
			type: 'object';
			[k: string]: unknown;
		};
	}[];
	/**
	 * A list of data types this view can return
	 */
	types?: string[];
	[k: string]: unknown;
}

export interface ViewContractDefinition extends ContractDefinition<ViewData> {}

export interface ViewContract extends Contract<ViewData> {}
