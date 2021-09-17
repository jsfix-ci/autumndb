/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

export const org = {
	slug: 'org',
	type: 'type@1.0.0',
	name: 'Organisation',
	data: {
		schema: {
			type: 'object',
			properties: {
				tags: {
					type: 'array',
					items: {
						type: 'string',
					},
					$$formula: "AGGREGATE($events, 'tags')",
				},
				markers: {
					type: 'array',
					items: {
						type: 'string',
						pattern: '^[a-zA-Z0-9-_/:+]+$',
					},
				},
				name: {
					type: 'string',
					fullTextSearch: true,
				},
				data: {
					type: 'object',
					properties: {
						profile: {
							type: 'object',
							properties: {
								description: {
									type: 'string',
									format: 'markdown',
								},
							},
						},
					},
				},
			},
			required: ['name'],
		},
	},
};