// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Vercel compiles these functions to Node ESM without bundling server/.
// Relative imports must use the emitted .js extension or the function crashes on load.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entries = [
  'api/passkeys.ts',
  'api/telegram-admin.ts',
  'api/telegram.ts',
  'api/telegram-worker.ts',
];

describe('Vercel function modules', () => {
  it('uses .js specifiers for every relative import Node will load', () => {
    const missing: string[] = [];
    for (const file of runtimeFiles()) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          const specifier = moduleSpecifier(node);
          if (specifier?.startsWith('.')) {
            if (!specifier.endsWith('.js')) missing.push(`${relative(root, file)} → ${specifier}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing).toEqual([]);
  });

  it('loads the compiled functions under Node ESM', () => {
    const outDir = join(root, 'node_modules/.tmp/vercel-node-resolution');
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    try {
      const configPath = join(root, 'tsconfig.server.json');
      const parsed = ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config,
        ts.sys,
        root,
        undefined,
        configPath,
      );
      const program = ts.createProgram({
        rootNames: entries.map((entry) => join(root, entry)),
        options: {
          ...parsed.options,
          noEmit: false,
          declaration: false,
          declarationMap: false,
          sourceMap: false,
          incremental: false,
          tsBuildInfoFile: undefined,
          outDir,
          rootDir: root,
        },
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
      const emitted = program.emit();
      expect(emitted.emitSkipped).toBe(false);

      const modules = entries.map((entry) => ({
        entry,
        href: pathToFileURL(join(outDir, entry.replace(/\.ts$/, '.js'))).href,
      }));
      const probe = `
        const modules = ${JSON.stringify(modules)};
        for (const item of modules) {
          const loaded = await import(item.href);
          if (typeof loaded.default?.fetch !== 'function') {
            throw new Error('missing fetch export from ' + item.entry);
          }
        }
      `;
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (
          key.startsWith('TELEGRAM_') ||
          key.startsWith('PASSKEY_') ||
          key.startsWith('SUPABASE_') ||
          key === 'CRON_SECRET'
        ) {
          delete env[key];
        }
      }
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

function runtimeFiles(): string[] {
  const seen = new Set<string>();
  const pending = entries.map((entry) => join(root, entry));
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && isRuntimeImport(node)) {
        const specifier = moduleSpecifier(node);
        if (specifier?.startsWith('.')) pending.push(resolveTypeScript(file, specifier));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...seen];
}

function isRuntimeImport(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) return !node.isTypeOnly;
  if (!node.importClause) return true;
  if (node.importClause.isTypeOnly) return false;
  const bindings = node.importClause.namedBindings;
  if (!bindings || ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

function moduleSpecifier(node: ts.ImportDeclaration | ts.ExportDeclaration): string | undefined {
  return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
}

function resolveTypeScript(fromFile: string, specifier: string): string {
  if (!specifier.endsWith('.js')) {
    throw new Error(`${relative(root, fromFile)} imports ${specifier} without a .js extension`);
  }
  const base = join(dirname(fromFile), specifier.slice(0, -3));
  const match = [`${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
  if (!match) throw new Error(`${relative(root, fromFile)} cannot resolve ${specifier}`);
  return match;
}
