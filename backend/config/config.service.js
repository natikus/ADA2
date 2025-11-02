import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const CONFIG_PATH = path.resolve(__dirname, './config.json');
const SCHEMA_PATH = path.resolve(__dirname, './config.schema.json');

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let schema;
let current = {};
let updatedAt = null;

function loadJSON(p) {
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw);
}

function validateConfig(data) {
  if (!schema) schema = loadJSON(SCHEMA_PATH);
  const validate = ajv.compile(schema);
  const ok = validate(data);
  if (!ok) {
    const err = new Error('config inválida: ' + ajv.errorsText(validate.errors, { separator: '\n' }));
    err.validationErrors = validate.errors;
    throw err;
  }
}

function reload() {
  const data = loadJSON(CONFIG_PATH);
  validateConfig(data);
  current = data;
  updatedAt = new Date().toISOString();
  console.log('[CONFIG] recargada', updatedAt);
}

reload();

let timer = null;
fs.watch(CONFIG_PATH, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { reload(); } catch (e) { console.warn('[CONFIG] error recargando:', e.message); }
  }, 200);
});

function get(pathStr, def) {
  if (!pathStr) return current;
  const parts = pathStr.split('.');
  let ref = current;
  for (const k of parts) {
    if (ref && Object.prototype.hasOwnProperty.call(ref, k)) ref = ref[k];
    else return def;
  }
  return ref;
}

export default {
  get,
  all: () => current,
  updatedAt: () => updatedAt
};


