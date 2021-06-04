/*
 * Copyright (C) Balena.io - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */

import * as _ from 'lodash';
import { getLogger } from '@balena/jellyfish-logger';
import * as utils from './utils';
import {
	Context,
	Contract,
	LinkContract,
} from '@balena/jellyfish-types/build/core';
import { BackendConnection, BackendTransaction } from './types';

const logger = getLogger('jellyfish-core');

const LINK_ORIGIN_PROPERTY = '$link';
const LINK_TABLE = 'links';

export const TABLE = LINK_TABLE;
export const setup = async (
	context: Context,
	connection: BackendConnection,
	database: string,
	options: {
		// The name of the "cards" table that should be referenced
		cards: string;
	},
) => {
	logger.debug(context, 'Creating links table', {
		table: LINK_TABLE,
		database,
	});
	const initTasks = [
		connection.any(
			`DO $$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'linkedge') THEN
				CREATE TYPE linkEdge AS (source UUID, idx INT, sink UUID);
				CREATE TYPE cardAndLinkEdges AS (cardId UUID, edges linkEdge[]);
			END IF;

			IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'polylinkedge') THEN
				CREATE TYPE polyLinkEdge AS (source UUID, sink UUID, idxs INT[]);
			END IF;
		END$$;`,
		),
	];
	await connection.any(`CREATE TABLE IF NOT EXISTS ${LINK_TABLE} (
			id UUID PRIMARY KEY NOT NULL,
			slug VARCHAR (255) NOT NULL,
			version_major INTEGER NOT NULL DEFAULT 1,
			version_minor INTEGER NOT NULL DEFAULT 0,
			version_patch INTEGER NOT NULL DEFAULT 0,
			version_prerelease TEXT NOT NULL DEFAULT '',
			version_build TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL,
			inverseName TEXT NOT NULL,
			fromId UUID REFERENCES ${options.cards} (id) NOT NULL,
			toId UUID REFERENCES ${options.cards} (id) NOT NULL,
			CONSTRAINT ${LINK_TABLE}_slug_version_key
				UNIQUE (slug, version_major, version_minor, version_patch, version_prerelease, version_build))`);
	const indexes = _.map(
		await connection.any(`
		SELECT * FROM pg_indexes WHERE tablename = '${LINK_TABLE}'`),
		'indexname',
	);
	for (const [name, column] of [
		['idx_links_fromid_name', 'fromid, name'],
		['idx_links_toid_inversename', 'toid, inversename'],
	]) {
		if (indexes.includes(name)) {
			return;
		}
		await utils.createIndex(
			context,
			connection,
			LINK_TABLE,
			name,
			`USING BTREE (${column})`,
		);
	}
	await Promise.all(initTasks);
};

export const upsert = async (
	_context: Context,
	connection: BackendConnection | BackendTransaction,
	link: LinkContract,
) => {
	if (link.active) {
		const sql = `
			INSERT INTO ${LINK_TABLE} (
				id,
				slug,
				version_major,
				version_minor,
				version_patch,
				version_prerelease,
				version_build,
				name,
				inverseName,
				fromId,
				toId
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (id) DO UPDATE SET
				slug = $2,
				version_major = $3,
				version_minor = $4,
				version_patch = $5,
				version_prerelease = $6,
				version_build = $7,
				name = $8,
				inverseName = $9,
				fromId = $10,
				toId = $11
		`;
		const { major, minor, patch, prerelease, build } = utils.parseVersion(
			link.version,
		);
		await connection.any({
			name: `links-upsert-insert-${LINK_TABLE}`,
			text: sql,
			values: [
				link.id,
				link.slug,
				major,
				minor,
				patch,
				prerelease,
				build,
				link.name,
				link.data.inverseName,
				link.data.from.id,
				link.data.to.id,
			],
		});
	} else {
		const sql = `
			DELETE FROM ${LINK_TABLE} WHERE id = $1`;
		await connection.any({
			name: `links-upsert-delete-${LINK_TABLE}`,
			text: sql,
			values: [link.id],
		});
	}
};
/**
 * @summary Parse a card link given a link card
 * @function
 * @private
 *
 * @param {Object} linkCard - link card
 * @param {Object} card - other card
 * @param {Object} joinedCard - the card that is linked via linkCard
 * @returns {(Null|Object)} results
 *
 * @example
 * const result = links.parseCard({
 *   name: 'is attached to',
 *   data: {
 *     inverseName: 'has attached element',
 *     from: 'xxxx',
 *     to: 'yyyy'
 *   }
 * }, {
 *   id: 'xxxx',
 *   ...
 * })
 *
 * if (result) {
 *   console.log(result.name)
 *   console.log(result.id)
 * }
 *
 * > 'is attached to'
 * > 'yyy'
 */
export const parseCard = (
	linkCard: LinkContract,
	card: Contract,
	joinedCard: Partial<Contract> = {},
) => {
	const fromId = linkCard.data.from.id || linkCard.data.from;
	const toId = linkCard.data.to.id || linkCard.data.to;
	if (fromId === card.id) {
		return {
			name: linkCard.name as string,
			id: toId,
			slug: joinedCard.slug,
			type: joinedCard.type,
			created_at: linkCard.created_at,
		};
	}
	if (toId === card.id) {
		return {
			name: linkCard.data.inverseName as string,
			id: fromId,
			slug: joinedCard.slug,
			type: joinedCard.type,
			created_at: linkCard.created_at,
		};
	}
	return null;
};
/**
 * @summary Add a link to the "links" materialized view
 * @function
 * @public
 *
 * @param {Object} linkCard - link card
 * @param {Object} card - card to modify
 * @param {Object} joinedCard - the card that is linked via linkCard
 * @returns {Object} card
 *
 * @example
 * const card = links.addLink({
 *   type: 'link',
 *   ...
 * }, {
 *   type: 'foo',
 *   ...
 * })
 *
 * console.log(card.links)
 */
export const addLink = (
	linkCard: LinkContract,
	card: Contract,
	joinedCard?: Contract,
) => {
	const result = parseCard(linkCard, card, joinedCard);
	if (!result) {
		return card;
	}
	if (!card.linked_at) {
		card.linked_at = {};
	}
	card.linked_at[result.name] = result.created_at;
	return card;
};
/**
 * @summary Remove a link from the "links" materialized view
 * @function
 * @public
 *
 * @param {Object} linkCard - link card
 * @param {Object} card - card to modify
 * @returns {Object} card
 *
 * @example
 * const card = links.removeLink({
 *   type: 'link',
 *   ...
 * }, {
 *   type: 'foo',
 *   ...
 * })
 *
 * console.log(card.links)
 */
export const removeLink = (linkCard: LinkContract, card: Contract) => {
	const result = parseCard(linkCard, card);
	if (!result || !card.links || !card.links[result.name]) {
		return card;
	}
	card.links[result.name] = _.reject(card.links[result.name], [
		LINK_ORIGIN_PROPERTY,
		linkCard.id,
	]);
	return card;
};