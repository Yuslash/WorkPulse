import { ObjectId } from 'mongodb';
import { ApiError } from './errors.js';

/**
 * Every id crossing the API boundary is a hex string; every id inside the
 * database is an ObjectId. Converting in exactly two functions keeps the
 * "which representation am I holding?" question out of business logic.
 */

export function toObjectId(value: string, field = 'id'): ObjectId {
  if (!ObjectId.isValid(value)) {
    throw ApiError.badRequest(`Invalid ${field}: ${value}`);
  }
  return new ObjectId(value);
}

/** Returns null instead of throwing — for optional filters from query strings. */
export function toObjectIdOrNull(value: string | null | undefined): ObjectId | null {
  if (!value || !ObjectId.isValid(value)) return null;
  return new ObjectId(value);
}

export function idToString(value: ObjectId | null | undefined): string | null {
  return value ? value.toHexString() : null;
}
