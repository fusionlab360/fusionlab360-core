
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const testsRoot = path.join(root, 'tests');
const apply = process.argv.includes('--apply');

const testPattern = /\.(test|spec)\.[cm]?[jt]sx?$/i;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

function slash(p) {
  return p.split(path.sep).join('/');
}

function key(p) {
  return path.normalize(p).toLowerCase();
}

function relativeImport(fromFile, target) {
  let value = slash(path.relative(path.dirname(fromFile), target));
  if (!value.startsWith('.')) value = './' + value;
  return value;
}

const sources = walk(srcRoot).filter(p => testPattern.test(path.basename(p)));
const existing = walk(testsRoot).filter(p => testPattern.test(path.basename(p)));

console.log('Remaining tests under src/:', sources.length);
console.log('Tests already under tests/:', existing.length);
console.log('Total tests after migration:', sources.length + existing.length);

if (!sources.length) {
  console.log('Nothing to relocate.');
  process.exit(0);
}

const moves = new Map(
  sources.map(from => [
    from,
    path.join(testsRoot, path.relative(srcRoot, from))
  ])
);

const movedByKey = new Map(
  [...moves].map(([from, to]) => [key(from), to])
);

const errors = [];
const warnings = [];
const changes = new Map();

for (const [from, to] of moves) {
  if (fs.existsSync(to)) {
    errors.push('Destination already exists: ' + to);
  }
}

const packagePath = path.join(root, 'package.json');
const tsconfigPath = path.join(root, 'tsconfig.json');

if (!fs.existsSync(packagePath)) errors.push('Missing package.json');
if (!fs.existsSync(tsconfigPath)) errors.push('Missing tsconfig.json');

function rewriteImports(oldFile, newFile, content) {
  const ast = ts.createSourceFile(
    oldFile,
    content,
    ts.ScriptTarget.Latest,
    true,
    oldFile.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const edits = [];

  function updateLiteral(node) {
    if (!node || !ts.isStringLiteralLike(node)) return;

    const value = node.text;
    if (!value.startsWith('.')) return;

    const oldTarget = path.resolve(path.dirname(oldFile), value);
    const extension = path.extname(oldTarget);

    let resolved = oldTarget;
    let suffix = '';

    if (!extension) {
      const candidates = [
        '.ts', '.tsx', '.mts', '.cts',
        '/index.ts', '/index.tsx'
      ];

      for (const candidate of candidates) {
        const candidatePath = oldTarget + candidate;

        if (fs.existsSync(candidatePath)) {
          resolved = candidatePath;
          suffix = candidate;
          break;
        }
      }
    }

    const moved = movedByKey.get(key(resolved));

    let target;

    if (moved) {
      target = suffix ? moved.slice(0, -suffix.length) : moved;
    } else {
      target = oldTarget;
    }

    const replacement = relativeImport(newFile, target);

    if (replacement === value) return;

    const start = node.getStart(ast);
    const end = node.getEnd();
    const quote = content[start];

    edits.push({
      start,
      end,
      value: quote + replacement + quote
    });
  }

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      updateLiteral(node.moduleSpecifier);
    }

    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'
        )
      )
    ) {
      updateLiteral(node.arguments[0]);
    }

    ts.forEachChild(node, visit);
  }

  visit(ast);

  edits.sort((a, b) => b.start - a.start);

  let updated = content;

  for (const edit of edits) {
    updated =
      updated.slice(0, edit.start) +
      edit.value +
      updated.slice(edit.end);
  }

  return updated;
}

const codeFiles = [
  ...walk(srcRoot),
  ...walk(testsRoot)
].filter(p => /\.[cm]?[jt]sx?$/.test(p));

for (const oldFile of codeFiles) {
  const newFile = moves.get(oldFile) || oldFile;
  const original = fs.readFileSync(oldFile, 'utf8');

  const updated = rewriteImports(oldFile, newFile, original);

  if (updated !== original || newFile !== oldFile) {
    changes.set(oldFile, {
      newFile,
      content: updated
    });
  }

  if (newFile !== oldFile) {
    const locationDependent =
      /\b__dirname\b|import\.meta\.url/;

    if (locationDependent.test(original)) {
      warnings.push(
        'Review location-dependent paths: ' +
        slash(path.relative(root, oldFile))
      );
    }
  }
} // Closes the for (const oldFile of codeFiles) loop

// Update test paths in package.json without reformatting it.
if (fs.existsSync(packagePath)) {
  const original = fs.readFileSync(packagePath, 'utf8');

  const updated = original.replace(
    /src\/[\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?/g,
    match => {
      const absolute = path.resolve(root, match);
      const moved = movedByKey.get(key(absolute));

      return moved
        ? slash(path.relative(root, moved))
        : match;
    }
  );

  if (updated !== original) {
    changes.set(packagePath, {
      newFile: packagePath,
      content: updated
    });
  }
}

// Add tests to tsconfig include without changing other settings.
if (fs.existsSync(tsconfigPath)) {
  const original = fs.readFileSync(tsconfigPath, 'utf8');
  const parsed = ts.parseConfigFileTextToJson(tsconfigPath, original);

  if (parsed.error) {
    errors.push('Unable to parse tsconfig.json');
  } else {
    const include = parsed.config.include;

    if (!Array.isArray(include)) {
      errors.push('tsconfig.json include is not an array');
    } else if (!include.includes('tests')) {
      const match = /"include"\s*:\s*\[([\s\S]*?)\]/.exec(original);

      if (!match) {
        errors.push('Unable to locate tsconfig include array');
      } else {
        const body = match[1];
        const hasEntries = /"[^"]+"/.test(body);
        const lastEntry = /"[^"]+"\s*,?\s*$/.exec(body);

        if (!hasEntries || !lastEntry) {
          errors.push('Cannot safely edit tsconfig include array');
        } else {
          const position = match.index + match[0].length - 1;
          const before = original.slice(0, position);
          const after = original.slice(position);

          const needsComma = !/,\s*$/.test(body);
          const newline = original.includes('\r\n') ? '\r\n' : '\n';

          const updated =
            before.replace(/\s*$/, '') +
            (needsComma ? ',' : '') +
            newline +
            '    "tests"' +
            newline +
            after;

          changes.set(tsconfigPath, {
            newFile: tsconfigPath,
            content: updated
          });
        }
      }
    }
  }
}

console.log('\nPlanned test moves:');

for (const [from, to] of moves) {
  console.log(
    slash(path.relative(root, from)) +
    ' -> ' +
    slash(path.relative(root, to))
  );
}

console.log('\nFiles requiring changes:', changes.size);

if (warnings.length) {
  console.log('\nWarnings requiring manual review:');
  warnings.forEach(w => console.log(' - ' + w));
}

if (errors.length) {
  console.error('\nMigration blocked:');
  errors.forEach(e => console.error(' - ' + e));
  process.exit(1);
}

if (!apply) {
  console.log('\nDRY RUN ONLY. No files changed.');
  process.exit(0);
}

if (warnings.length) {
  console.error(
    '\nApply blocked because location-dependent paths require review.'
  );
  process.exit(1);
}

// Prepare all output before removing any original test files.
for (const [oldFile, change] of changes) {
  fs.mkdirSync(path.dirname(change.newFile), { recursive: true });
  fs.writeFileSync(change.newFile, change.content, 'utf8');
}

// Remove only tests that were successfully relocated.
for (const [from, to] of moves) {
  if (!fs.existsSync(to)) {
    throw new Error('Missing relocated test: ' + to);
  }

  fs.unlinkSync(from);
}

console.log('\nRelocation complete.');
console.log('Moved tests:', moves.size);
console.log('Run: npx.cmd tsc --noEmit');