import uiSchemaDefs = require('./ui-schema-defs.json');

// This mixin defines all common fields in contracts that support
// UI Schemas (i.e. type contracts)
export const baseUiSchema = {
	data: {
		uiSchema: {
			fields: uiSchemaDefs.reset,
			edit: {
				$ref: '#/data/uiSchema/definitions/form',
			},
			create: {
				$ref: '#/data/uiSchema/edit',
			},
			definitions: {
				form: {
					'ui:order': ['name', 'loop', 'tags', 'data', '*'],
					loop: {
						'ui:widget': 'LoopSelect',
					},
				},
			},
			snippet: {
				'ui:explicit': true,
				data: {
					'ui:title': null,
					'ui:explicit': true,
				},
			},
		},
	},
};