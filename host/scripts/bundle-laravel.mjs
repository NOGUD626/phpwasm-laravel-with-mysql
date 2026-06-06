#!/usr/bin/env node
// laravel-app/ を zip して host/public/laravel-app.zip に置く。
// vendor は含めるが、storage/* と node_modules/* と .git/* は除外する。
import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

// scripts/ → host/(..) → phpwasm-laravel/(../..)
const HOST = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(HOST, '..');
const SRC = path.join(ROOT, 'laravel-app');
const DST = path.join(HOST, 'public', 'laravel-app.zip');

const EXCLUDE = [
	/^\.git(\/|$)/,
	/^node_modules(\/|$)/,
	/^storage\/framework\/(cache|sessions|views|testing)\//,
	/^storage\/logs\//,
	/^tests\//,
	/\.env\.example$/,
	/^public\/build(\/|$)/,
	/^vendor\/bin\//,
	/(^|\/)\.DS_Store$/,
];

function walk(dir, base = '') {
	const out = [];
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const rel = base ? `${base}/${ent.name}` : ent.name;
		if (EXCLUDE.some((re) => re.test(rel))) continue;
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...walk(full, rel));
		else out.push({ rel, full });
	}
	return out;
}

console.log('reading', SRC);
const files = walk(SRC);
console.log('files:', files.length);

const entries = {};
for (const { rel, full } of files) entries[rel] = fs.readFileSync(full);

console.log('zipping…');
const out = zipSync(entries, { level: 6 });
fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, out);
console.log('wrote', DST, '(', out.byteLength, 'bytes)');
