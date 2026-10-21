/**
 * A small validator for the Swagger 2.0 subset used by the apaleo models:
 * object, array, string, number, integer, boolean, required, enum, minLength,
 * `$ref`, `x-nullable`, date formats and `additionalProperties`.
 */
export interface SwaggerSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, SwaggerSchema>;
  additionalProperties?: boolean | SwaggerSchema;
  items?: SwaggerSchema;
  enum?: unknown[];
  minLength?: number;
  format?: string;
  $ref?: string;
  'x-nullable'?: boolean;
}

const FORMATS: Record<string, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
};

/** Returns one message per problem, each starting with the JSON path; empty when the value conforms. */
export function validateSwagger(
  definitions: Record<string, SwaggerSchema>,
  model: string,
  value: unknown,
): string[] {
  const errors: string[] = [];
  const check = (schema: SwaggerSchema, current: unknown, path: string): void => {
    if (schema.$ref) {
      const name = schema.$ref.replace('#/definitions/', '');
      const target = definitions[name];
      if (!target) return void errors.push(`${path}: unknown model ${name}`);
      return check(target, current, path);
    }
    if (current === null) {
      if (!schema['x-nullable']) errors.push(`${path}: must not be null`);
      return;
    }
    const type = schema.type ?? (schema.properties ? 'object' : undefined);
    if (type === 'object') return checkObject(schema, current, path);
    if (type === 'array') {
      if (!Array.isArray(current)) return void errors.push(`${path}: must be an array`);
      return current.forEach((item, i) => check(schema.items ?? {}, item, `${path}[${i}]`));
    }
    if (type === 'string') return checkString(schema, current, path);
    if (type === 'number' && (typeof current !== 'number' || !Number.isFinite(current))) errors.push(`${path}: must be a number`);
    if (type === 'integer' && !Number.isInteger(current)) errors.push(`${path}: must be an integer`);
    if (type === 'boolean' && typeof current !== 'boolean') errors.push(`${path}: must be a boolean`);
  };

  const checkObject = (schema: SwaggerSchema, current: unknown, path: string) => {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return void errors.push(`${path}: must be an object`);
    }
    const record = current as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) errors.push(`${path}.${key}: is required`);
    }
    for (const [key, item] of Object.entries(record)) {
      const property = schema.properties?.[key];
      if (property) check(property, item, `${path}.${key}`);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: is not in the model`);
      else if (typeof schema.additionalProperties === 'object') check(schema.additionalProperties, item, `${path}.${key}`);
    }
  };

  const checkString = (schema: SwaggerSchema, current: unknown, path: string) => {
    if (typeof current !== 'string') return void errors.push(`${path}: must be a string`);
    if (schema.enum && !schema.enum.includes(current)) errors.push(`${path}: "${current}" is not one of ${schema.enum.join(', ')}`);
    if (schema.minLength !== undefined && current.length < schema.minLength) errors.push(`${path}: is too short`);
    const format = schema.format ? FORMATS[schema.format] : undefined;
    if (format && !format.test(current)) errors.push(`${path}: is not a valid ${schema.format}`);
  };

  check({ $ref: `#/definitions/${model}` }, value, '$');
  return errors;
}
