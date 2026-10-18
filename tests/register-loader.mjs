/* Registers the TypeScript extension loader for the test runner. Node's
 * `--experimental-loader` flag is deprecated, so `node --test` is started with
 * `--import ./tests/register-loader.mjs` instead and the loader registers
 * itself here. */
import { register } from 'node:module'

register('./ts-extension-loader.mjs', import.meta.url)
