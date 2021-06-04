/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

export const type = {
	slug: 'type',
	type: 'type@1.0.0',
	name: 'Jellyfish Card Type',
	data: {
		schema: {
			type: 'object',
			properties: {
				slug: {
					type: 'string',
					pattern: '^[a-z0-9-]+$',
				},
				type: {
					type: 'string',
					enum: ['type', 'type@1.0.0'],
				},
				data: {
					type: 'object',
					properties: {
						schema: {
							type: 'object',
						},
						uiSchema: {
							type: 'object',
						},
						slices: {
							type: 'array',
							items: {
								type: 'string',
							},
						},
						indexed_fields: {
							description:
								'Fields, or groups of fields that should be indexed for improved performance',
							type: 'array',
							items: {
								type: 'array',
								items: {
									type: 'string',
								},
							},
						},
					},
					required: ['schema'],
				},
			},
			required: ['slug', 'type', 'data'],
		},
	},
};