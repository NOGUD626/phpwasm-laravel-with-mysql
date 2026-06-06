#!/usr/bin/env node
// docs/screenshots/ に README / 記事用の自動スクショを撮るスクリプト。
//
//   前提: Vite + ws-proxy + MySQL が起動済み (make up)
//
//   $ make shots
//   または
//   $ npm --prefix host run shots
//
// CHROME 環境変数で別ブラウザを指定可能 (Brave / Edge など)。
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.HOST_URL || 'http://localhost:5180';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');

const CHROME_CANDIDATES = [
	process.env.CHROME,
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((p) => {
	try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
});
if (!chrome) {
	console.error('Chrome 系ブラウザが見つかりません。CHROME=path で指定してください。');
	process.exit(1);
}
console.log(`[shots] chrome: ${chrome}`);
console.log(`[shots] url   : ${URL}`);
console.log(`[shots] out   : ${OUT}`);
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: chrome,
	headless: 'new',
	defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
	args: ['--no-sandbox'],
});

try {
	const page = await browser.newPage();
	page.on('pageerror', (e) => console.warn('[page error]', e.message));

	console.log('[shots] open');
	await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
	await sleep(500);

	console.log('[shots] 01 initial');
	await page.screenshot({ path: path.join(OUT, '01-initial.png'), fullPage: true });

	console.log('[shots] click boot');
	await page.click('#boot');
	console.log('[shots] wait for ready');
	await page.waitForFunction(
		() => /起動完了/.test(document.getElementById('status').textContent),
		{ timeout: 90000 },
	);
	await sleep(2000);

	console.log('[shots] 02 booted (welcome hub)');
	await page.screenshot({ path: path.join(OUT, '02-booted.png'), fullPage: true });

	console.log('[shots] iframe → /laravel/posts');
	await page.evaluate(() => { document.getElementById('preview').src = '/laravel/posts'; });
	await sleep(4500);
	console.log('[shots] 03 posts CRUD');
	await page.screenshot({ path: path.join(OUT, '03-posts.png'), fullPage: true });

	console.log('[shots] iframe → /laravel/phpinfo');
	await page.evaluate(() => { document.getElementById('preview').src = '/laravel/phpinfo'; });
	await sleep(4500);
	console.log('[shots] 04 phpinfo');
	await page.screenshot({ path: path.join(OUT, '04-phpinfo.png'), fullPage: true });

	console.log('[shots] tab → artisan, click route:list');
	await page.evaluate(() => document.querySelector('.tab[data-tab="artisan"]').click());
	await sleep(300);
	await page.click('button.artisan[data-art="route:list"]');
	await sleep(8000);
	console.log('[shots] 05 artisan route:list');
	await page.screenshot({ path: path.join(OUT, '05-artisan-route-list.png'), fullPage: true });

	console.log('[shots] click about (自前版)');
	await page.click('button.artisan[data-art="about"]');
	await sleep(10000);
	console.log('[shots] 06 artisan about (自前版)');
	await page.screenshot({ path: path.join(OUT, '06-artisan-about.png'), fullPage: true });

	console.log('[shots] tab → tinker, click DB::table');
	await page.evaluate(() => document.querySelector('.tab[data-tab="tinker"]').click());
	await sleep(300);
	await page.click('#tinker-posts');
	await sleep(10000);
	console.log('[shots] 07 tinker');
	await page.screenshot({ path: path.join(OUT, '07-tinker.png'), fullPage: true });

	console.log('[shots] done');
} finally {
	await browser.close();
}
