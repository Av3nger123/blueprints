import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { BlueprintManifest, Issue } from './types.js';

let cachedSchema: object | undefined;
let cachedValidator: ValidateFunction | undefined;

/**
 * The blueprint.yaml JSON Schema. Published builds ship it next to this file; inside the monorepo it is
 * read from spec/, which stays the single source of truth.
 */
export function blueprintSchema(): object {
  if (cachedSchema) return cachedSchema;
  const candidates = ['./blueprint.schema.json', '../../../spec/blueprint.schema.json'];
  for (const rel of candidates) {
    try {
      cachedSchema = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as object;
      return cachedSchema;
    } catch {
      // try the next location
    }
  }
  throw new Error('blueprint.schema.json not found next to @blueprints core or in spec/');
}

function validator(): ValidateFunction {
  if (!cachedValidator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    cachedValidator = ajv.compile(blueprintSchema());
  }
  return cachedValidator;
}

export interface ParsedManifest {
  manifest?: BlueprintManifest;
  /** The raw parsed YAML, even when it fails the schema. */
  raw?: unknown;
  errors: Issue[];
}

/** Parse blueprint.yaml text and validate it against the schema. */
export function parseManifest(text: string, file = 'blueprint.yaml'): ParsedManifest {
  let raw: unknown;
  try {
    // YAML 1.2 core schema: unquoted dates stay strings, which is what the schema expects.
    raw = parseYaml(text, { prettyErrors: true });
  } catch (err) {
    const msg = err instanceof YAMLParseError ? err.message : String(err);
    return { errors: [{ file, message: `invalid YAML: ${msg}` }] };
  }
  const errors = validateManifestObject(raw).map((message) => ({ file, message }));
  return errors.length ? { raw, errors } : { raw, manifest: raw as BlueprintManifest, errors };
}

/** Schema errors for an already-parsed manifest, as human-readable strings. */
export function validateManifestObject(raw: unknown): string[] {
  const validate = validator();
  if (validate(raw)) return [];
  return (validate.errors ?? []).map(formatAjvError);
}

function formatAjvError(e: ErrorObject): string {
  const where = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : '(root)';
  switch (e.keyword) {
    case 'required':
      return `${where}: missing required field "${(e.params as { missingProperty: string }).missingProperty}"`;
    case 'additionalProperties':
      return `${where}: unknown field "${(e.params as { additionalProperty: string }).additionalProperty}"`;
    case 'enum':
      return `${where}: must be one of ${(e.params as { allowedValues: unknown[] }).allowedValues.map((v) => JSON.stringify(v)).join(', ')}`;
    case 'const':
      return `${where}: must be ${JSON.stringify((e.params as { allowedValue: unknown }).allowedValue)}`;
    default:
      return `${where}: ${e.message ?? e.keyword}`;
  }
}
