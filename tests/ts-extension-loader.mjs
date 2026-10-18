import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'

export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context) }
  catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      // Extensionless specifiers may point at a .ts or a .tsx module.
      try { return await nextResolve(`${specifier}.ts`, context) }
      catch { return nextResolve(`${specifier}.tsx`, context) }
    }
    throw error
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && (url.endsWith('.ts') || url.endsWith('.tsx'))) {
    const tsx = url.endsWith('.tsx')
    const source = await readFile(new URL(url), 'utf8')
    // `jsx: automatic` matches the app's tsconfig (`jsx: react-jsx`): the
    // transform must emit `react/jsx-runtime` imports instead of assuming a
    // `React` binding in scope.
    const result = await transform(source, { loader: tsx ? 'tsx' : 'ts', jsx: 'automatic', format: 'esm', target: 'node18' })
    return { format: 'module', source: result.code, shortCircuit: true }
  }
  return nextLoad(url, context)
}
