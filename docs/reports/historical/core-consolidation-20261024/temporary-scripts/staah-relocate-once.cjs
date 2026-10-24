const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();

const sourceDir = path.join(
  root, "src", "domain", "integration"
);

const destinationDir = path.join(
  root, "src", "integrations",
  "channel-manager", "staah"
);

// Only provider-specific files are eligible.
const names = fs.readdirSync(sourceDir).filter(
  (name) => /^staah-.*\.ts$/.test(name)
);

if (names.length !== 12) {
  throw new Error(
    `Expected 12 STAAH files; found ${names.length}. ` +
    "Review the file list before proceeding."
  );
}

const moves = new Map();

for (const name of names) {
  const from = path.join(sourceDir, name);
  const to = path.join(destinationDir, name);

  if (fs.existsSync(to)) {
    throw new Error(
      `Destination already exists: ${to}`
    );
  }

  moves.set(from, to);
}

// Collect TypeScript source files without modifying them.
function collect(directory) {
  if (!fs.existsSync(directory)) return [];

  const results = [];

  for (const entry of fs.readdirSync(
    directory, { withFileTypes: true }
  )) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...collect(full));
    } else if (
      entry.isFile() &&
      /\.tsx?$/.test(entry.name)
    ) {
      results.push(full);
    }
  }

  return results;
}

const sourceFiles = [
  ...collect(path.join(root, "src")),
  ...collect(path.join(root, "tests")),
];

const rewritten = new Map();

const importPattern =
  /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;

for (const originalFile of sourceFiles) {
  const destinationFile =
    moves.get(originalFile) ?? originalFile;

  const content = fs.readFileSync(
    originalFile, "utf8"
  );

  const updated = content.replace(
    importPattern,
    (match, prefix, quote, specifier) => {
      const originalTarget = path.resolve(
        path.dirname(originalFile),
        specifier
      );

      const destinationTarget =
        moves.get(originalTarget) ?? originalTarget;

      let relative = path.relative(
        path.dirname(destinationFile),
        destinationTarget
      ).replace(/\\/g, "/");

      if (!relative) {
        relative = ".";
      } else if (!relative.startsWith(".")) {
        relative = "./" + relative;
      }

      return prefix + quote + relative + quote;
    }
  );

  if (
    updated !== content ||
    moves.has(originalFile)
  ) {
    rewritten.set(destinationFile, updated);
  }
}

// All preflight checks completed.
// Move the existing files; do not reset Git state.
for (const [from, to] of moves) {
  fs.renameSync(from, to);
}

// Update imports after relocation.
for (const [filename, content] of rewritten) {
  fs.writeFileSync(filename, content, "utf8");
}

console.log(
  `Relocated ${moves.size} STAAH files.`
);
console.log(
  `Updated ${rewritten.size} source files.`
);
console.log(
  "No migrations or database operations performed."
);
