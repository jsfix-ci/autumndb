import type { JsonSchema } from '@balena/jellyfish-types';
import * as _ from 'lodash';
import type { Context } from '../../../context';
import type { SqlQueryOptions } from '../types';
import { SelectMap } from './select-map';
import { SqlQuery } from './sql-query';

export const compile = (
	context: Context,
	table: string,
	select: any,
	schema: JsonSchema,
	options: SqlQueryOptions = {},
) => {
	return SqlQuery.fromSchema(
		context,
		null,
		new SelectMap(select),
		schema,
		_.cloneDeep(options),
	).toSqlSelect(table);
};
