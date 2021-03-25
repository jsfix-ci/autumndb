/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

module.exports = {
	slug: 'oauth-provider',
	type: 'type@1.0.0',
	name: 'Oauth Provider',
	data: {
		schema: {
			type: 'object',
			properties: {
				slug: {
					type: 'string',
					pattern: '^oauth-provider-[a-z0-9-]+$'
				},
				name: {
					type: 'string'
				},
				data: {
					type: 'object',
					properties: {
						authorizeUrl: {
							type: 'string'
						},
						tokenUrl: {
							type: 'string'
						}
					},
					required: [
						'authorizeUrl',
						'tokenUrl'
					],
					oneOf: [
						{
							type: 'object',
							properties: {
								whoamiUrl: {
									type: 'string'
								},
								whoamiFieldMap: {
									type: 'object',
									properties: {
										username: {
											type: 'string'
										},
										email: {
											type: 'string'
										},
										firstname: {
											type: 'string'
										},
										lastname: {
											type: 'string'
										}
									},
									required: [
										'username'
									]
								}
							},
							required: [
								'whoamiUrl',
								'whoamiFieldMap'
							]
						},
						true
					]
				}
			}
		}
	}
}