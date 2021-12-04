import { TypedError } from 'typed-error';
import { JellyfishError } from '@balena/jellyfish-types';

export class BaseTypedError extends TypedError implements JellyfishError {
	expected: boolean = false;
}

export class JellyfishDatabaseError extends BaseTypedError {}
export class JellyfishDatabaseTimeoutError extends BaseTypedError {}
export class JellyfishCacheError extends BaseTypedError {}
export class JellyfishInvalidSlug extends BaseTypedError {}
export class JellyfishInvalidId extends BaseTypedError {}
export class JellyfishInvalidVersion extends BaseTypedError {}
export class JellyfishInvalidSchema extends BaseTypedError {}
export class JellyfishInvalidPatch extends BaseTypedError {}
export class JellyfishInvalidLimit extends BaseTypedError {}
export class JellyfishInvalidRegularExpression extends BaseTypedError {}
export class JellyfishInvalidSession extends BaseTypedError {}
export class JellyfishElementAlreadyExists extends BaseTypedError {}
export class JellyfishNoIdentifier extends BaseTypedError {}
export class JellyfishAuthenticationError extends BaseTypedError {}
export class JellyfishInvalidEnvironmentVariable extends BaseTypedError {}
export class JellyfishInvalidExpression extends BaseTypedError {}
export class JellyfishNoAction extends BaseTypedError {}
export class JellyfishNoElement extends BaseTypedError {}
export class JellyfishNoLinkTarget extends BaseTypedError {}
export class JellyfishNoView extends BaseTypedError {}
export class JellyfishPermissionsError extends BaseTypedError {}
export class JellyfishSchemaMismatch extends BaseTypedError {}
export class JellyfishSessionExpired extends BaseTypedError {}
export class JellyfishUnknownCardType extends BaseTypedError {}