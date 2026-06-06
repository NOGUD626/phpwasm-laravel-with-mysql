import { bootLaravel, URL_SCOPE, type LaravelHost, type CliResult } from './php-host';
import { registerServiceWorker, startPhpBridge } from './sw-bridge';

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const statusEl = $('#status');
const logEl = $('#log') as HTMLPreElement;
const resultEl = $('#result') as HTMLPreElement;
const artisanOut = $('#artisan-out') as HTMLPreElement;
const tinkerOut = $('#tinker-out') as HTMLPreElement;
const tinkerExpr = $('#tinker-expr') as HTMLTextAreaElement;
const previewEl = $('#preview') as HTMLIFrameElement;
const bootBtn = $('#boot') as HTMLButtonElement;
const apiButtons = Array.from(document.querySelectorAll('button.api')) as HTMLButtonElement[];
const artisanButtons = Array.from(document.querySelectorAll('button.artisan')) as HTMLButtonElement[];
const tinkerButtons = Array.from(document.querySelectorAll('button.tinker')) as HTMLButtonElement[];

let host: LaravelHost | null = null;

function setStatus(text: string) {
	statusEl.innerHTML = '状態: <b>' + text + '</b>';
}
function log(line: string) {
	logEl.textContent += '\n' + line;
	logEl.scrollTop = logEl.scrollHeight;
}

async function boot() {
	bootBtn.disabled = true;
	logEl.textContent = '';
	const t0 = performance.now();
	setStatus('php-wasm を起動し Laravel を展開中…');

	try {
		setStatus('Service Worker を登録中…');
		await registerServiceWorker(log);
		host = await bootLaravel({ onLog: log });
		startPhpBridge(host.handler, log);

		setStatus('iframe を Laravel に接続中…');
		previewEl.src = `${URL_SCOPE}/`;
		previewEl.classList.remove('hidden');
		const ph = document.getElementById('preview-placeholder');
		if (ph) ph.style.display = 'none';

		[...apiButtons, ...artisanButtons, ...tinkerButtons].forEach((b) => (b.disabled = false));
		const ms = Math.round(performance.now() - t0);
		setStatus('起動完了 ✅(' + ms + 'ms / Laravel 稼働中・iframe 内で遷移可)');
		log(`\n[host] iframe.src = ${URL_SCOPE}/`);
	} catch (e: unknown) {
		const msg = (e as Error)?.message || String(e);
		log('\n[host] ERROR: ' + msg);
		setStatus('エラー ❌(ログ参照)');
		bootBtn.disabled = false;
	}
}

async function callRoute(path: string) {
	if (!host) return;
	resultEl.textContent = 'GET ' + path + ' …';
	try {
		const r = await host.request('GET', path);
		let body = r.text;
		try {
			body = JSON.stringify(JSON.parse(r.text), null, 2);
		} catch { /* HTML 等はそのまま */ }
		resultEl.textContent = 'GET ' + path + '  →  HTTP ' + r.status + '\n\n' + body.slice(0, 6000);
	} catch (e: unknown) {
		const msg = (e as Error)?.message || String(e);
		resultEl.textContent = 'GET ' + path + '  →  失敗: ' + msg;
	}
}

function formatCli(label: string, res: CliResult): string {
	const head = `$ ${label}\n(exit ${res.exitCode})\n`;
	const out = res.stdout ? `\n--- stdout ---\n${res.stdout}` : '';
	const err = res.stderr ? `\n--- stderr ---\n${res.stderr}` : '';
	return head + out + err;
}

async function runArtisan(args: string[], label: string) {
	if (!host) return;
	artisanOut.textContent = `$ ${label} …`;
	try {
		const res = await host.runArtisan(args);
		artisanOut.textContent = formatCli(label, res);
		artisanOut.scrollTop = artisanOut.scrollHeight;
	} catch (e: unknown) {
		artisanOut.textContent = `$ ${label}\nERROR: ` + ((e as Error)?.message || String(e));
	}
}

async function runTinker(expr: string) {
	if (!host) return;
	tinkerOut.textContent = 'eval: ' + expr + ' …';
	try {
		const res = await host.tinker(expr);
		tinkerOut.textContent = formatCli(`tinker --execute='dump(${expr});'`, res);
	} catch (e: unknown) {
		tinkerOut.textContent = 'ERROR: ' + ((e as Error)?.message || String(e));
	}
}

// タブ切替: クリックされたタブをアクティブにし、対応する panel を表示する
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
const panels = Array.from(document.querySelectorAll<HTMLDivElement>('.tab-panel'));
tabs.forEach((tab) => {
	tab.addEventListener('click', () => {
		const name = tab.dataset.tab;
		tabs.forEach((t) => t.classList.toggle('active', t === tab));
		panels.forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
	});
});

bootBtn.addEventListener('click', () => void boot());
apiButtons.forEach((b) =>
	b.addEventListener('click', () => callRoute(b.dataset.path!)),
);
async function runAbout() {
	if (!host) return;
	artisanOut.textContent = '$ about (自前版、proc_open 回避)…';
	try {
		const res = await host.about();
		artisanOut.textContent = formatCli('about (自前版、proc_open 回避)', res);
	} catch (e: unknown) {
		artisanOut.textContent = 'ERROR: ' + ((e as Error)?.message || String(e));
	}
}

artisanButtons.forEach((b) => {
	b.addEventListener('click', () => {
		const cmd = b.dataset.art!;
		// about は proc_open を踏むので自前ランナーに差し替え
		if (cmd === 'about') {
			void runAbout();
			return;
		}
		// "migrate --force" のようにスペース区切りで複数引数を許可
		const argv = cmd.split(/\s+/);
		runArtisan(argv, `php artisan ${cmd}`);
	});
});
($('#tinker-run') as HTMLButtonElement).addEventListener('click', () => runTinker(tinkerExpr.value.trim()));
($('#tinker-users') as HTMLButtonElement).addEventListener('click', () => {
	tinkerExpr.value = 'User::all()';
	runTinker('User::all()');
});
($('#tinker-posts') as HTMLButtonElement).addEventListener('click', () => {
	tinkerExpr.value = "DB::table('posts')->count()";
	runTinker("DB::table('posts')->count()");
});
