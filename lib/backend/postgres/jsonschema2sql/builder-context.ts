import * as _ from 'lodash';
import pgFormat = require('pg-format');
import type { SqlFilter } from './sql-filter';

/**
 * Context for `SqlFragmentBuilder` that is shared between users of a builder
 * instance.
 */
export class BuilderContext {
	tableStack: string[];
	linkTypeStack: Array<[string, number]>;
	// TS-TODO: improve this property typing
	links: {
		[key: string]: Array<
			Array<{
				nested?: { [key: string]: any };
				linkName: string;
				linksAlias: string;
				joinAlias: string;
				lateralAlias: string;
				sqlFilter: string;
			}>
		>;
	};
	linkCount: number;
	hoistedFilters: string[];

	/**
	 * Constructor.
	 *
	 * @param {String} table - Name or alias of the table we're currently
	 *        referencing.
	 */
	constructor(table: string) {
		this.tableStack = [table];
		this.linkTypeStack = [];
		this.links = {};
		this.linkCount = 0;
		this.hoistedFilters = [];
	}

	/**
	 * Push a new table to the top of the table stack.
	 *
	 * @param {String} table - Name or alias of the table to be pushed and used
	 *        as current.
	 */
	pushTable(table: string) {
		this.tableStack.push(table);
	}

	/**
	 * Get the table at the top of the stack.
	 *
	 * @returns {String} Name or alias of the table at the top of the stack.
	 */
	getTable(): string {
		return this.tableStack[this.tableStack.length - 1];
	}

	/**
	 * Pop a table from the top of the stack.
	 */
	popTable() {
		this.tableStack.pop();
	}

	/**
	 * Add a link to this context. This will cause `filter` to be recursively
	 * serialized into SQL and aggregated into a map (see {@link
	 * BuilderContext#getLinks}). `filter` is always serialized with a new
	 * `SqlFragmentBuilder` but the context (`this`) is always shared.
	 *
	 * @param {String} linkType - The link type.
	 * @param {SqlFilter} filter - Filter for the link.
	 * @returns {String} Name of the cards table joined by the link that was
	 *          just added.
	 */
	addLink(linkType: string, filter: SqlFilter): string {
		// The link type stack is usually very shallow, so following this path
		// from the root is not an issue
		let currentLinks = this.links;
		for (const [stackLinkType, stackIdx] of this.linkTypeStack) {
			let next = _.get(currentLinks, [stackLinkType, stackIdx, 'nested']);
			if (next) {
				currentLinks = next;
			} else {
				next = {};
				_.set(currentLinks, [stackLinkType, stackIdx, 'nested'], next);
				currentLinks = next;
			}
		}

		let variants: any[];
		if (linkType in currentLinks) {
			variants = currentLinks[linkType];
		} else {
			variants = [];
			currentLinks[linkType] = variants;
		}

		const idx = variants.length;
		this.linkTypeStack.push([
			linkType.replace('\\', '\\\\').replace('/', '\\/'),
			idx,
		]);

		const stackString = this.linkTypeStack
			.map(([stackLinkType, stackIdx]) => {
				return `${stackLinkType}.${stackIdx}`;
			})
			.join('/');

		const joinAlias = pgFormat.ident(`join@/${stackString}`);

		variants.push({
			linked: {
				linkType,
				linkName: pgFormat.literal(linkType),
				linksAlias: pgFormat.ident(`links@/${stackString}`),
				joinAlias,
				// This is a dummy value that is replaced when we have a value
				// for it
				sqlFilter: null,
			},
		});

		// The `require` is here to break load-time circular dependencies
		const { SqlFragmentBuilder } = require('./fragment-builder');
		const linkCountStart = (this as any).linkCount;
		this.pushTable(joinAlias);
		const sqlFilter = new SqlFragmentBuilder(this).extendFrom(filter).toSql();
		this.popTable();
		if (linkCountStart < this.linkCount) {
			this.hoistedFilters.push(sqlFilter);
			variants[idx].linked.sqlFilter = 'true';
		} else {
			variants[idx].linked.sqlFilter = sqlFilter;
		}
		this.linkTypeStack.pop();
		this.linkCount += 1;
		return joinAlias;
	}

	/**
	 * Get all links stored in this context. The returned map has the following
	 * (recursive) structure:
	 *
	 * ```
	 * <links map> = {
	 *   <link type>: [
	 *     [
	 *       {
	 *         nested: <links map>,
	 *         linked: {
	 *             linkName: ...,
	 *             linksAlias: ...,
	 *             joinAlias: ...,
	 *             lateralAlias: ...,
	 *             sqlFilter: ...
	 *         }
	 *       },
	 *       ...
	 *     ],
	 *     ...
	 *   },
	 *   ...
	 * }
	 * ```
	 *
	 * Where `nested` is optional.
	 *
	 * @returns {Object} A map of all links stored in this context.
	 */
	getLinks() {
		return this.links;
	}

	/**
	 * In some cases, filters can only appear in the `WHERE` clause and not on
	 * any specific join condition, or we risk emitting queries with circular
	 * dependencies.
	 *
	 * @returns {String} Stringified version of all hoisted filters.
	 */
	getHoistedFilters(): string {
		return this.hoistedFilters.join(' AND ');
	}
}
