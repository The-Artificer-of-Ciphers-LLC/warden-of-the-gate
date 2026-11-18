import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';

const dir = new URL('../../schemas/', import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
export const wardenSchema = read('warden.v1.schema.json');
export const ordersSchema = read('orders.v1.schema.json');

export const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
export const validateWardenSchema: ValidateFunction = ajv.compile(wardenSchema);
export const validateOrdersSchema: ValidateFunction = ajv.compile(ordersSchema);

export function ajvMessages(v: ValidateFunction): string[] {
  return (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}${e.params && 'additionalProperty' in e.params ? ` (${String(e.params.additionalProperty)})` : ''}`);
}
