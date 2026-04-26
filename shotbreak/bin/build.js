#!/usr/bin/env node
// SHOTBREAK build step: copy the static publish tree into shotbreak/dist/.
//
// Netlify's UI build command is `npm run build` and its publish directory is
// `shotbreak/dist`. SHOTBREAK has no compiler or bundler — it's pure static
// HTML + Netlify Functions — so this script just mirrors the things the
// browser needs (HTML, JS, CSS, images, _headers, sitemap, agents/) into
// dist/ and skips files that shouldn't ship (package.json, test/, netlify
// config, Firebase rules, README).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const EXCLUDE = new Set([
	"dist",
	"node_modules",
	"bin",
	"test",
	"netlify",
	"netlify.toml",
	"package.json",
	"package-lock.json",
	"firestore.rules",
	"README.md",
	".env",
	".env.local",
	".gitignore",
	".DS_Store",
]);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const copied = [];
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
	if (EXCLUDE.has(entry.name)) continue;
	const src = path.join(ROOT, entry.name);
	const dst = path.join(DIST, entry.name);
	fs.cpSync(src, dst, { recursive: true });
	copied.push(entry.name);
}

console.log(
	`SHOTBREAK build → ${path.relative(process.cwd(), DIST)} (${copied.length} entries)`,
);
console.log(copied.map((n) => `  · ${n}`).join("\n"));
