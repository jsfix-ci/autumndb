/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */
import * as _ from 'lodash';
import * as jsonpatch from 'fast-json-patch';
import * as fastEquals from 'fast-equals';
import * as assert from '@balena/jellyfish-assert';
import jsonSchema from './json-schema';
import * as errors from './errors';
import * as views from './views';
import { CARDS } from './cards';
import * as permissionFilter from './permission-filter';
import metrics = require('@balena/jellyfish-metrics');
import { getLogger } from '@balena/jellyfish-logger';
import { JSONSchema } from '@balena/jellyfish-types';
import { PostgresBackend } from './backend/postgres';
import {
	Context,
	Contract,
	ContractDefinition,
	TypeContract,
	ViewContract,
} from '@balena/jellyfish-types/build/core';
import { BackendQueryOptions } from './backend/postgres/types';

const logger = getLogger('jellyfish-core');

const flattenSelected = (selected: any) => {
	const flat = selected.properties;
	if ('links' in flat && !_.isEmpty(selected.links)) {
		flat.links = _.merge(flat.links, selected.links);
	}
	return flat;
};

const mergeSelectedMaps = (base: any, extras: any) => {
	return _.mergeWith(base, ...extras, (objA: any, objB: any) => {
		if (!_.isEmpty(objA)) {
			return objA;
		} else if (!_.isEmpty(objB)) {
			return objB;
		}

		return undefined;
	});
};

const getSelected = (schema: JSONSchema): { links: any; properties: any } => {
	if (_.isBoolean(schema)) {
		return {
			links: {},
			properties: {},
		};
	}

	const links: { [linkType: string]: JSONSchema } = {};

	if ('$$links' in schema) {
		for (const [linkType, linked] of Object.entries(schema.$$links!)) {
			links[linkType] = flattenSelected(getSelected(linked));
		}
	}

	const extraLinks = [];
	const properties: { [property: string]: { [key: string]: any } } = {};

	if ('required' in schema) {
		for (const required of schema.required!) {
			properties[required] = {};
		}
	}

	if ('properties' in schema) {
		for (const [name, subSchema] of Object.entries(schema.properties!)) {
			const subSelected = getSelected(subSchema);
			extraLinks.push(subSelected.links);
			properties[name] = subSelected.properties;
		}
	}

	const extraProperties = [];
	for (const combinator of ['allOf', 'anyOf']) {
		if (combinator in schema) {
			for (const branch of (schema as any)[combinator]) {
				const subSelected = getSelected(branch);
				extraLinks.push(subSelected.links);
				extraProperties.push(subSelected.properties);
			}
		}
	}

	if ('not' in schema) {
		const subSelected = getSelected(schema.not!);
		extraLinks.push(subSelected.links);
		extraProperties.push(subSelected.properties);
	}

	return {
		links: mergeSelectedMaps(links, extraLinks),
		properties: mergeSelectedMaps(properties, extraProperties),
	};
};

const rectifySelected = (
	selected: any,
	filteredSelected: { [x: string]: any },
) => {
	for (const [key, value] of Object.entries(selected)) {
		if (key in filteredSelected) {
			rectifySelected(value, filteredSelected[key]);
		} else {
			Reflect.deleteProperty(selected, key);
		}
	}
};

const getQueryFromSchema = async (
	context: Context,
	backend: PostgresBackend,
	session: string,
	schema: JSONSchema | ViewContract,
) => {
	// TS-TODO: Refactor this to avoid type coercion
	const finalSchema: JSONSchema = (
		schema.type === `${CARDS.view.slug}@${CARDS.view.version}`
			? views.getSchema(schema as ViewContract)
			: schema
	) as JSONSchema;

	// TODO: this is probably going to be given in the schema itself. See
	// also `stream()`
	const selected = flattenSelected(getSelected(finalSchema));

	const filteredQuery = await permissionFilter.getQuery(
		context,
		backend,
		session,
		finalSchema,
	);

	// If a property is completely blacklisted by the permissions, it will be
	// completely removed from `filteredQuery`. In that case we need to find
	// all selected properties again from `filteredQuery` and then rectify
	// `selected` by removing missing properties
	const filteredSelected = flattenSelected(getSelected(filteredQuery));

	rectifySelected(selected, filteredSelected);

	return {
		selected,
		filteredQuery,
	};
};

const patchCard = (
	card: Contract,
	patch: jsonpatch.Operation[],
	options: { mutate?: boolean } = {},
) => {
	return patch.reduce((accumulator, operation) => {
		if (!operation.path) {
			throw new errors.JellyfishInvalidPatch(
				`Patch operation has no path: ${JSON.stringify(operation, null, 2)}`,
			);
		}

		if (
			operation.path.startsWith('/id') ||
			operation.path.startsWith('/links') ||
			operation.path.startsWith('/linked_at') ||
			operation.path.startsWith('/created_at') ||
			operation.path.startsWith('/updated_at')
		) {
			return accumulator;
		}

		// Only addition can happen on non-existent properties
		if (operation.op !== 'add') {
			const path = operation.path.split('/').slice(1);
			if (!_.has(card, path)) {
				// This is a schema mismatch as this case tends
				// to happen when attempting to violate the
				// permissions filters.
				const error = new errors.JellyfishSchemaMismatch(
					`Path ${operation.path} does not exist in ${card.slug}`,
				);
				error.expected = true;
				throw error;
			}
		}

		try {
			return jsonpatch.applyOperation(
				accumulator,
				operation,
				false,
				options.mutate,
			).newDocument;
		} catch (error) {
			const newError = new errors.JellyfishInvalidPatch(
				`Patch does not apply to ${card.slug}: ${JSON.stringify(
					patch,
					null,
					2,
				)}`,
			);

			newError.expected = true;

			throw newError;
		}
	}, card);
};

const preUpsert = async (
	instance: Kernel,
	context: Context,
	session: string,
	card: Contract,
) => {
	assert.INTERNAL(
		context,
		card.type,
		instance.errors.JellyfishSchemaMismatch,
		'No type in card',
	);
	// Fetch necessary objects concurrently
	const [typeCard, filter] = await Promise.all([
		instance.getCardBySlug<TypeContract>(context, session, card.type),
		permissionFilter.getMask(context, instance.backend, session),
	]);
	const schema = typeCard && typeCard.data && typeCard.data.schema;
	assert.INTERNAL(
		context,
		schema,
		instance.errors.JellyfishUnknownCardType,
		`Unknown type: ${card.type}`,
	);
	// TODO: Remove this once we completely migrate links
	// to have versioned types in the "from" and the "to"
	// We put this check here, before we type-check the
	// upsert, so we don't cause violations to the type
	// if the from/to have no versions.
	// See: https://github.com/product-os/jellyfish/pull/3088
	if (
		card.type === 'link@1.0.0' &&
		card.data &&
		card.data.from &&
		card.data.to &&
		(card.data as any).from.type &&
		(card.data as any).to.type &&
		!_.includes((card.data as any).from.type, '@') &&
		!_.includes((card.data as any).to.type, '@')
	) {
		(card.data as any).from.type = `${(card.data as any).from.type}@1.0.0`;
		(card.data as any).from.to = `${(card.data as any).to.type}@1.0.0`;
	}
	try {
		jsonSchema.validate(schema as any, card);
	} catch (error) {
		if (error instanceof errors.JellyfishSchemaMismatch) {
			error.expected = true;
		}
		throw error;
	}
	try {
		jsonSchema.validate(filter as any, card);
	} catch (error) {
		// Failing to match the filter schema is a permissions error
		if (error instanceof errors.JellyfishSchemaMismatch) {
			const newError = new errors.JellyfishPermissionsError(error.message);
			newError.expected = true;
			throw newError;
		}
		throw error;
	}
	return filter;
};

export class Kernel {
	backend: PostgresBackend;
	errors: typeof errors;
	cards: typeof CARDS;
	sessions?: { admin: string };

	/**
	 * @summary The Jellyfish Kernel
	 * @class
	 * @public
	 *
	 * @param {Object} backend - the backend instance
	 *
	 * @example
	 * const cache = new Cache()
	 * const backend = new Backend(cache, {
	 *   database: 'my-jellyfish',
	 *   host: 'localhost',
	 *   port: 28015,
	 *   user: 'admin'
	 * })
	 *
	 * const kernel = new Kernel(backend)
	 */
	constructor(backend: PostgresBackend) {
		this.backend = backend;
		this.errors = errors;
		this.cards = CARDS;
	}

	/**
	 * @summary Disconnect
	 * @function
	 * @public
	 *
	 * @param {Object} context - execution context
	 *
	 * @example
	 * const kernel = new Kernel(backend, { ... })
	 * await kernel.initialize()
	 * await kernel.disconnect()
	 */
	async disconnect(context: Context) {
		await this.backend.disconnect(context);
	}

	/**
	 * @summary Initialize the kernel
	 * @function
	 * @public
	 *
	 * @param {Object} context - execution context
	 *
	 * @description
	 * This makes sure the kernel is connected to the backend
	 * and that the backend is populated with the things we need.
	 *
	 * @example
	 * const kernel = new Kernel(backend, { ... })
	 * await kernel.initialize()
	 */
	async initialize(context: Context) {
		await this.backend.connect(context);

		// TODO: all of this bootstrapping should be in the same transaction as the DB setup
		// happening in the connect() call above

		logger.debug(context, 'Upserting minimal required cards');

		const unsafeUpsert = (card: ContractDefinition) => {
			const element = this.defaults(card);
			return permissionFilter.unsafeUpsertCard(
				context,
				this.backend,
				element as Contract,
			);
		};

		await Promise.all([
			unsafeUpsert(CARDS.type),
			unsafeUpsert(CARDS.session),
			unsafeUpsert(CARDS.user),
			unsafeUpsert(CARDS['role-user-admin']),
		]);

		const adminUser = await unsafeUpsert(CARDS['user-admin']);
		const adminSession = await unsafeUpsert({
			slug: 'session-admin-kernel',
			type: `${CARDS.session.slug}@${CARDS.session.version}`,
			data: {
				actor: adminUser.id,
			},
		} as any as Contract);

		this.sessions = {
			admin: adminSession.id,
		};

		await Promise.all(
			[
				CARDS.card,
				CARDS.action,
				CARDS['action-request'],
				CARDS.org,
				CARDS.event,
				CARDS.view,
				CARDS.role,
				CARDS.link,
				CARDS['oauth-provider'],
				CARDS['oauth-client'],
			].map(async (card) => {
				logger.debug(context, 'Upserting core card', {
					slug: card.slug,
				});

				return this.replaceCard(context, this.sessions!.admin, card);
			}),
		);
	}

	/**
	 * @summary Get a card by its id
	 * @function
	 * @public
	 *
	 * @param {Object} context - execution context
	 * @param {String} session - session id
	 * @param {String} id - card id
	 * @returns {(Object|Null)} card
	 */
	async getCardById(context: Context, session: string, id: string) {
		logger.debug(context, 'Fetching card by id', {
			id,
		});

		assert.INTERNAL(context, id, errors.JellyfishInvalidId, 'Id is undefined');

		const schema: JSONSchema = {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					const: id,
				},
			},
			additionalProperties: true,
			required: ['id'],
		};

		const results = await this.query(context, session, schema, {
			limit: 1,
		});

		assert.INTERNAL(
			context,
			results.length <= 1,
			errors.JellyfishDatabaseError,
			`More than one card with id ${id}`,
		);

		return results[0] || null;
	}

	/**
	 * @summary Get a card by its slug
	 * @function
	 * @public
	 *
	 * @param {Object} context - execution context
	 * @param {String} session - session id
	 * @param {String} slug - card slug
	 * @param {Object} options - optional set of extra options
	 * @returns {(Object|Null)} card
	 */
	async getCardBySlug<T extends Contract = Contract>(
		context: Context,
		session: string,
		slug: string,
		options: Partial<BackendQueryOptions> = {},
	): Promise<T | null> {
		logger.debug(context, 'Fetching card by slug', {
			slug,
		});

		assert.INTERNAL(
			context,
			slug,
			errors.JellyfishInvalidSlug,
			'Slug is undefined',
		);

		const [base, version] = slug.split('@');

		assert.INTERNAL(
			context,
			version,
			errors.JellyfishInvalidVersion,
			`No version reference: ${slug}`,
		);

		const queryOptions: BackendQueryOptions = {
			limit: 1,
		};

		if (options.connection) {
			queryOptions.connection = options.connection;
		}

		const schema: JSONSchema = {
			type: 'object',
			additionalProperties: true,
			properties: {
				slug: {
					type: 'string',
					const: base,
				},
			},
		};

		if (version && version !== 'latest') {
			schema.properties!.version = {
				type: 'string',
				const: version,
			};
		} else if (version === 'latest') {
			queryOptions.sortBy = ['version'];
			queryOptions.sortDir = 'desc';
		}

		schema.required = Object.keys(schema.properties!);

		const results = await this.query<T>(context, session, schema, queryOptions);

		assert.INTERNAL(
			context,
			results.length <= 1,
			errors.JellyfishDatabaseError,
			`More than one card with id slug ${slug}`,
		);

		return results[0] || null;
	}

	/**
	 * @summary Insert a card to the kernel
	 * @function
	 * @public
	 *
	 * @param {Object} context - execution context
	 * @param {String} session - session id
	 * @param {Object} object - card object
	 * @returns {Object} the inserted card
	 *
	 * @example
	 * const kernel = new Kernel(backend, { ... })
	 * await kernel.initialize()
	 *
	 * const card = await kernel.insertCard(
	 *   '4a962ad9-20b5-4dd8-a707-bf819593cc84', { ... })
	 * console.log(card.id)
	 */
	async insertCard(
		context: Context,
		session: string,
		object: Partial<Contract> & Pick<Contract, 'slug' | 'type'>,
	) {
		const card = this.defaults(object);

		logger.debug(context, 'Inserting card', {
			slug: card.slug,
		});

		await preUpsert(this, context, session, card as Contract);

		return this.backend.insertElement(context, card as Contract);
	}

	/**
	 * @summary Replace a card in the kernel
	 * @function
	 * @public
	 *
	 * @param {Object} context - execution context
	 * @param {String} session - session id
	 * @param {Object} object - card object, the slug or ID must be supplied
	 * @returns {Object} the replaced card
	 *
	 * @example
	 * const kernel = new Kernel(backend, { ... })
	 * await kernel.initialize()
	 *
	 * const card = await kernel.replaceCard(
	 *   '4a962ad9-20b5-4dd8-a707-bf819593cc84', { ... })
	 * console.log(card.id)
	 */
	async replaceCard(
		context: Context,
		session: string,
		object: Partial<Contract> &
			Pick<Contract, 'type'> &
			(Pick<Contract, 'slug'> | Pick<Contract, 'id'>),
	) {
		const card = this.defaults(object);

		logger.debug(context, 'Replacing card', {
			slug: card.slug,
		});

		await preUpsert(this, context, session, card as Contract);

		return this.backend.upsertElement(context, card as Contract);
	}

	/**
	 * @summary Patch a card in the kernel
	 * @function
	 * @public
	 *
	 * @description
	 * See https://tools.ietf.org/html/rfc6902
	 *
	 * @param {Object} context - execution context
	 * @param {String} session - session id
	 * @param {String} slug - card slug
	 * @param {Object[]} patch - JSON Patch operations
	 * @returns {Object} the patched card
	 */
	async patchCardBySlug(
		context: Context,
		session: string,
		slug: string,
		patch: jsonpatch.Operation[],
	) {
		const filter = await permissionFilter.getMask(
			context,
			this.backend,
			session,
		);

		const result = await metrics.measureCardPatch(async () => {
			return this.backend.withTransaction(async (transaction) => {
				// Set options to ensure subsequent queries are a part of the transaction
				const options = {
					connection: transaction,
					skipCache: true,
				};

				// Fetch necessary data from database
				const fullCard = await this.backend.getElementBySlug(context, slug, {
					...options,
					lock: true,
				});

				assert.INTERNAL(
					context,
					fullCard,
					this.errors.JellyfishNoElement,
					`No such card: ${slug}`,
				);

				// TODO: Remove this log once we understand why we are having link card patch requests.
				if (fullCard.type === 'link@1.0.0') {
					logger.info(context, 'Received request to patch a link card', {
						card: fullCard,
						patch,
					});
				}

				const filteredCard = await this.getCardBySlug(
					context,
					session,
					`${fullCard.slug}@${fullCard.version}`,
					options,
				);

				if (patch.length === 0) {
					return filteredCard;
				}

				const typeCard = await this.getCardBySlug<TypeContract>(
					context,
					session,
					fullCard.type,
					options,
				);

				assert.INTERNAL(
					context,
					filteredCard,
					this.errors.JellyfishNoElement,
					`No such card: ${slug}`,
				);

				const schema = typeCard && typeCard.data && typeCard.data.schema;

				assert.INTERNAL(
					context,
					schema,
					this.errors.JellyfishUnknownCardType,
					`Unknown type: ${fullCard.type}`,
				);

				/*
				 * The idea of this algorithm is that we get the full card
				 * as stored in the database and the card as the current actor
				 * can see it. Then we apply the patch to both the full and
				 * the filtered card, aborting if it fails on any. If it succeeds
				 * then we upsert the full card to the database, but only
				 * if the resulting filtered card still matches the permissions
				 * filter.
				 */
				// TS-TODO: "filteredCard" might be null here, and we should account for this
				const patchedFilteredCard = patchCard(filteredCard!, patch, {
					mutate: true,
				});

				jsonSchema.validate(filter as any, patchedFilteredCard);

				const patchedFullCard = patchCard(fullCard, patch, {
					mutate: false,
				});

				try {
					jsonSchema.validate(schema as any, patchedFullCard);
				} catch (error) {
					if (error instanceof errors.JellyfishSchemaMismatch) {
						error.expected = true;

						// Because the "full" unrestricted card is being validated there is
						// potential for an error message to leak private data. To prevent this,
						// override the detailed error message with a generic one.
						error.message = 'The updated card is invalid';
					}

					throw error;
				}

				// Don't do a pointless update
				if (fastEquals.deepEqual(patchedFullCard, fullCard)) {
					return fullCard;
				}

				// TODO: Remove this log once we understand why we are having link card patch requests.
				if (fullCard.type === 'link@1.0.0') {
					logger.info(context, 'Upserting link card after patch', {
						card: patchedFullCard,
						patch,
					});
				}

				await this.backend.upsertElement(context, patchedFullCard, options);

				// Otherwise a person that patches a card gets
				// to see the full card
				return patchedFilteredCard;
			});
		});

		return result;
	}

	/**
	 * @summary Query the kernel
	 * @function
	 * @public
	 *
	 * @param {Object} context - execution context
	 * @param {String} session - session id
	 * @param {Object} schema - JSON Schema
	 * @param {Object} [options] - options
	 * @param {Number} [options.limit] - query limit
	 * @param {Number} [options.skip] - skip
	 * @param {String | String[]} [options.sortBy] - Key or key path as an array to
	 *   a value that the query should be sorted by
	 * @param {'asc' | 'desc'} [options.sortDir] - Set sort direction,
	 * @returns {Object[]} results
	 *
	 * @example
	 * const kernel = new Kernel(backend, { ... })
	 * await kernel.initialize()
	 *
	 * const results = await kernel.query('4a962ad9-20b5-4dd8-a707-bf819593cc84', {
	 *   type: 'object',
	 *   properties: {
	 *     slug: {
	 *       type: 'string',
	 *       const: 'foo'
	 *     }
	 *   },
	 *   required: [ 'slug' ]
	 * })
	 */
	async query<T = Contract>(
		context: Context,
		session: string,
		schema: JSONSchema | ViewContract,
		options: Partial<BackendQueryOptions> = {},
	): Promise<T[]> {
		const { selected, filteredQuery } = await getQueryFromSchema(
			context,
			this.backend,
			session,
			schema,
		);
		return this.backend
			.query(context, selected, filteredQuery, {
				limit: options.limit,
				skip: options.skip,
				sortBy: options.sortBy,
				sortDir: options.sortDir,
				profile: options.profile,
				links: options.links,
				connection: options.connection || null,
				// For debugging purposes
			})
			.catch((error) => {
				if (error instanceof errors.JellyfishDatabaseTimeoutError) {
					logger.warn(context, 'Query timeout', schema);
				}
				throw error;
			});
	}

	/**
	 * @summary Stream events from objects that match a schema
	 * @function
	 * @public
	 *
	 * @description
	 * The event emitter emits the following events:
	 *
	 * - data: when there is a change. The payload is an object with the
	 *   following keys:
	 *   - id: ID of the card that was changed
	 *   - type: change type. One of:
	 *     - insert: on insertion
	 *     - update: on update
	 *     - delete: on deletion
	 *     - unmatch: on an update to a previously seen card (either from `data`
	 *       or `dataset` events) that makes the card not match the schema
	 *       anymore
	 *   - after: the result of running a query for this stream's schema on the
	 *     relevant card after an insertion or update. `null` on delete or
	 *     unmatch
	 * - dataset: in response to the `query` event. The payload is an object with
	 *   the following keys:
	 *   - id: the query ID
	 *   - cards: the array of cards
	 * - error: when there is an error. The payload is the error
	 * - closed: when the connection is closed after calling `.close()`
	 *
	 * The event emitter also accepts the following events:
	 *
	 * - query: query with a schema. This is almost the same as calling `query()`
	 *   with the stream's context and session. The only difference is that the
	 *   resulting cards become eligible for the `unmatch` event type. The query
	 *   results are returned through the `dataset` event. The payload is an
	 *   object with the following keys:
	 *   - id: a free-form ID for this query. Optional
	 *   - schema: the schema to be queried
	 *   - options: an options object in the same format as `query()`
	 * - setSchema: set the stream's schema. The payload is the new schema
	 *
	 * @param {Object} context - execution context
	 * @param {String} session - session id
	 * @param {Object} schema - JSON Schema
	 * @param {Object} options - options object
	 * @returns {EventEmitter} emitter
	 *
	 * @example
	 * const kernel = new Kernel(backend, { ... })
	 * await kernel.initialize()
	 *
	 * const emitter = await kernel.stream('4a962ad9-20b5-4dd8-a707-bf819593cc84', {
	 *   type: 'object',
	 *   properties: {
	 *     type: {
	 *       type: 'string',
	 *       pattern: '^example$'
	 *     }
	 *   },
	 *   required: [ 'type' ]
	 * })
	 *
	 * emitter.on('error', (error) => {
	 *   throw error
	 * })
	 *
	 * emitter.on('closed', () => {
	 *   console.log('Closed!')
	 * })
	 *
	 * emitter.on('data', (change) => {
	 *   console.log(change.id)
	 *   console.log(change.type)
	 *   console.log(change.after)
	 * })
	 *
	 * // At some point...
	 * emitter.close()
	 */
	async stream(
		context: Context,
		session: string,
		schema: JSONSchema,
		options: Partial<BackendQueryOptions> = {},
	) {
		const { selected, filteredQuery } = await getQueryFromSchema(
			context,
			this.backend,
			session,
			schema,
		);

		logger.debug(context, 'Opening stream');

		const stream = await this.backend.stream(
			context,
			selected,
			filteredQuery,
			options,
		);

		// Attach event handlers. We got to do this here and not in any lower
		// levels because of the whole permissions handling
		stream.on('query', async (payload) => {
			const query = await getQueryFromSchema(
				context,
				this.backend,
				session,
				payload.schema,
			);
			const cards = await stream.query(
				query.selected,
				query.filteredQuery,
				payload.options,
			);
			stream.emit('dataset', {
				id: payload.id,
				cards,
			});
		});

		stream.on('setSchema', async (newSchema) => {
			const query = await getQueryFromSchema(
				context,
				this.backend,
				session,
				newSchema,
			);
			stream.setSchema(query.selected, query.filteredQuery);
		});

		return stream;
	}

	/**
	 * @summary Extends a card with default values
	 * @function
	 * @public
	 *
	 *
	 * @param {Object} card - card
	 * @returns {Object} card
	 *
	 * @example
	 * const kernel = new Kernel(backend, { ... })
	 * await kernel.initialize()
	 *
	 * const card = kernel.defaults({
	 *   slug: 'slug',
	 *   type: 'type'
	 * })
	 *
	 * console.log(card)
	 */
	defaults(card: Partial<Contract>) {
		// Object.assign is used as it is significantly faster than using lodash
		const defaultCard = Object.assign(
			{
				updated_at: null,
				linked_at: {},
				active: true,
				version: '1.0.0',
				tags: [],
				markers: [],
				links: {},
				requires: [],
				capabilities: [],
				data: {},
			},
			card,
		);

		// Only create a timestamp if it's necessary
		if (!defaultCard.created_at) {
			defaultCard.created_at = new Date().toISOString();
		}

		return defaultCard;
	}

	/**
	 * @summary Report status from the kernel
	 * @function
	 * @public
	 *
	 * const kernel = new Kernel(backend, { ... })
	 * await kernel.initialize()
	 *
	 * @returns {Object} status
	 *
	 * @example
	 * const kernel = new Kernel(backend, { ... })
	 * await kernel.initialize()
	 *
	 * const status = await kernel.getStatus()
	 * console.log(status)
	 */
	async getStatus() {
		return {
			backend: await this.backend.getStatus(),
		};
	}
}