import { v4 } from "uuid";

/**
 * Short unique id with a readable prefix. uuid is used because crypto.randomUUID only
 * exists on https and localhost, and this app is usually opened at a LAN address over http.
 */
export const newId = (prefix: string): string => `${prefix}-${v4().slice(0, 8)}`;
