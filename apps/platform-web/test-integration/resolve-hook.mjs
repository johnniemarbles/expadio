import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A Node module-resolution hook that lets the integration harness load the app's
 * TypeScript lib the same way the Next bundler does: relative imports written
 * without an extension (`./workflow-authority`) resolve to the `.ts` file.
 *
 * The app and packages use `moduleResolution: bundler`, so their local imports
 * are extensionless; plain `node --experimental-strip-types` cannot resolve
 * those. This hook appends `.ts` when the extensionless target exists, and
 * otherwise defers to Node's default resolution (which handles the
 * `@expadio/*` workspace packages via their package.json `exports`).
 */
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExt = /\.(c|m)?[jt]s$|\.json$/.test(specifier);
  if (isRelative && !hasExt && context.parentURL) {
    try {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(`${specifier}.ts`, context);
      }
    } catch {
      // fall through to default resolution
    }
  }
  return nextResolve(specifier, context);
}
