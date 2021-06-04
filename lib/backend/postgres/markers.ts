/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */
import * as _ from 'lodash';
import debouncePromise = require('debounce-promise');
import { getLogger } from '@balena/jellyfish-logger';
import { defaultEnvironment as environment } from '@balena/jellyfish-environment';
import { Context, Contract } from '@balena/jellyfish-types/build/core';
import { BackendConnection, BackendTransaction } from './types';

const logger = getLogger('jellyfish-core');

const LINK_TYPE = 'has member';

export const getTable = (source: string) => {
	return `${source}_markers`;
};

export const setup = async (
	_context: Context,
	connection: BackendConnection,
	options: {
		// Name of table that contains main contract data
		source: string;
		// Name of table that contains link data
		links: string;
	},
) => {
	const table = getTable(options.source);
	/*
	 * List all materialized views
	 */
	const views = _.map(
		await connection.any(`
		SELECT oid::regclass::text FROM pg_class
		WHERE relkind = 'm'`),
		'oid',
	);
	if (!views.includes(table)) {
		await connection.any(`
			CREATE MATERIALIZED VIEW ${table} AS
			SELECT
				member.slug,
				array_agg(${options.source}.slug) AS "markers"
			FROM ${options.source}
			INNER JOIN ${options.links} AS link ON (
				(link.fromId = ${options.source}.id AND link.name = '${LINK_TYPE}') OR
				(link.toId = ${options.source}.id AND link.inverseName = '${LINK_TYPE}')
			)
			INNER JOIN ${options.source} AS member
			ON (
				link.toId = member.id OR link.fromId = member.id
			)
			WHERE
			(${options.source}.type = 'org@1.0.0' OR ${options.source}.type = 'org')
			AND
			(member.type = 'user@1.0.0' OR member.type = 'user')
			GROUP BY
			member.slug
			WITH DATA`);
	}
	/*
	 * This query will give us a list of all the indexes
	 * on a particular table.
	 */
	const indexes = _.map(
		await connection.any(`
		SELECT * FROM pg_indexes WHERE tablename = '${table}'`),
		'indexname',
	);
	const index = `idx_${table}_slug`;
	if (!indexes.includes(index)) {
		/*
		 * We need a unique index that is not part of the WHERE clause
		 * in order to be able to update the vire concurrently.
		 * See https://www.postgresql.org/docs/9.4/sql-refreshmaterializedview.html
		 */
		await connection.any(`
			CREATE UNIQUE INDEX ${index} ON ${table}
			USING BTREE (slug)`);
	}
};

const refreshView = environment.isProduction()
	? debouncePromise(
			(connection: BackendConnection | BackendTransaction, view: string) => {
				/*
				 * The "CONCURRENTLY" option allows the database to serve other
				 * queries on the materialized view while we update it.
				 */
				return connection.any(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
			},
			500,
			{
				leading: true,
			},
	  )
	: /*
	   * A synchronous refresh is faster if there are few actions
	   * happening at the same time, so it gives us a little boost
	   * when running the test suite.
	   */
	  async (
			connection: BackendConnection | BackendTransaction,
			view: string,
	  ) => {
			return connection.any(`REFRESH MATERIALIZED VIEW ${view}`);
	  };

export const refresh = async (
	context: Context,
	connection: BackendConnection | BackendTransaction,
	options: {
		// The table containing the main contract data
		source: string;
		// The contract that caused the refresh to occur
		trigger: Contract;
	},
) => {
	const table = getTable(options.source);
	const refreshStart = new Date();
	await refreshView(connection, table);
	const refreshEnd = new Date();
	logger.info(context, 'Refreshed markers', {
		type: options.trigger.type,
		trigger: options.trigger.slug,
		time: refreshEnd.getTime() - refreshStart.getTime(),
	});
};

export const getUserMarkers = async (
	_context: Context,
	connection: BackendConnection,
	user: {
		id?: string;
		slug: string;
	},
	options: {
		// The table containing the main contract data
		source: string;
	},
) => {
	const table = getTable(options.source);
	let query = null;
	let values = null;
	if ('id' in user) {
		query = `SELECT markers FROM ${table} WHERE id = $1 AND slug = $2 LIMIT 1`;
		values = [user.id, user.slug];
	} else {
		query = `SELECT markers FROM ${table} WHERE slug = $1 LIMIT 1`;
		values = [user.slug];
	}
	const result = await connection.any({
		name: `markers-getusermarkers-${table}`,
		text: query,
		values,
	});
	if (result.length === 0) {
		return [];
	}
	return result[0].markers.map((marker: string) => {
		return {
			slug: marker,
			type: 'org@1.0.0',
		};
	});
};