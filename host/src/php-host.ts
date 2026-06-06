// ブラウザ内で Laravel を動かす中核。
//   1. WS shim を注入(@php-wasm/web のバグ workaround、MySQL 接続に必須)
//   2. JSPI を無効化(カスタム asyncify ビルドを使うため)
//   3. @php-wasm/web で PHP ランタイム(WASM)を起動 + WS プロキシ設定
//   4. fetch した laravel-app.zip を fflate で展開し、VFS(/var/www)へ書き込む
//   5. Laravel の storage/bootstrap 用ディレクトリを mkdir
//   6. .env の APP_URL を実オリジン + /laravel に書き換え
//   7. PHPRequestHandler を Web サーバーのように使い request() で応答を得る
import { loadWebRuntime } from '@php-wasm/web';
import { PHP, PHPRequestHandler, PHPExecutionFailureError } from '@php-wasm/universal';
import type { AllPHPVersion, HTTPMethod, PHPResponse } from '@php-wasm/universal';
import { unzipSync } from 'fflate';

// iframe ナビゲーションを Service Worker で中継するための URL スコープ。
export const URL_SCOPE = '/laravel';

export type BootOptions = {
	phpVersion?: string;
	zipUrl?: string;
	wsProxyUrl?: string;
	onLog: (line: string) => void;
};

export type CliResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

export type LaravelHost = {
	handler: PHPRequestHandler;
	request: (method: string, path: string) => Promise<{
		status: number;
		headers: Record<string, string[]>;
		text: string;
	}>;
	/**
	 * artisan コマンドを実行する。
	 * 例: runArtisan(['route:list'])  → "php /var/www/artisan route:list" 相当。
	 */
	runArtisan: (args: string[]) => Promise<CliResult>;
	/**
	 * 任意 PHP コードを Laravel bootstrap 済みコンテキストで実行する(tinker 相当)。
	 * 例: tinker("User::count()") → stdout に "0" などが出る。
	 */
	tinker: (phpExpression: string) => Promise<CliResult>;
	/**
	 * `artisan about` 相当の環境情報を proc_open を踏まずに集めて表示する。
	 * 本家 about は composer -V を proc_open で取りに行くため wasm では失敗する。
	 */
	about: () => Promise<CliResult>;
};

const DOC_ROOT = '/var/www';

// ──────────────────────────────────────────────────────────────────
// WebSocket EventEmitter シム
// @php-wasm/web の PHPWASM.awaitEvent は ws.once / ws.removeListener という
// Node.js EventEmitter のメソッドを呼ぶが、ブラウザの WebSocket には存在しない。
// 結果 awaitData の Promise が rejects → poll の wakeup が timeout(24h)任せに
// なり PDO 接続が事実上 hang する。addEventListener へ橋渡しして解決する。
// ──────────────────────────────────────────────────────────────────
type WSExt = WebSocket & {
	once?: (event: string, listener: (e: Event) => void) => void;
	removeListener?: (event: string, listener: (e: Event) => void) => void;
	on?: (event: string, listener: (e: Event) => void) => void;
};
type ListenerWithShim = ((e: Event) => void) & { __wsShim?: (e: Event) => void };
function installWsShim() {
	const proto = WebSocket.prototype as unknown as WSExt;
	if (!proto.once) {
		proto.once = function (event, listener) {
			const wrapper = (e: Event) => {
				(this as WebSocket).removeEventListener(event, wrapper);
				listener.call(this, e);
			};
			(listener as ListenerWithShim).__wsShim = wrapper;
			(this as WebSocket).addEventListener(event, wrapper);
		};
	}
	if (!proto.removeListener) {
		proto.removeListener = function (event, listener) {
			const w = (listener as ListenerWithShim).__wsShim || listener;
			(this as WebSocket).removeEventListener(event, w);
		};
	}
	if (!proto.on) {
		proto.on = function (event, listener) {
			(this as WebSocket).addEventListener(event, listener);
		};
	}
}

// asyncify ビルドを強制使用(JSPI 検出を無効化)。
function disableJSPI() {
	const w = WebAssembly as unknown as { Suspending?: unknown };
	if ('Suspending' in WebAssembly) {
		try { delete w.Suspending; } catch { /* noop */ }
	}
}

export async function bootLaravel(opts: BootOptions): Promise<LaravelHost> {
	const { onLog } = opts;
	const phpVersion = opts.phpVersion ?? '8.3';
	const zipUrl = opts.zipUrl ?? '/laravel-app.zip';
	const wsProxyUrl = opts.wsProxyUrl ?? 'ws://localhost:8090/127.0.0.1:3306';

	installWsShim();
	disableJSPI();
	onLog('[host] WS shim installed, JSPI disabled');

	onLog(`[host] loadWebRuntime(PHP ${phpVersion}) with WS proxy=${wsProxyUrl}`);
	const t0 = performance.now();
	const php = new PHP(
		await loadWebRuntime(phpVersion as AllPHPVersion, {
			emscriptenOptions: {
				processId: 1,
				websocket: { url: wsProxyUrl, subprotocol: 'binary' },
			},
		}),
	);
	onLog(`[host] runtime booted in ${Math.round(performance.now() - t0)}ms`);

	// Laravel アプリの取得・展開
	onLog(`[host] fetching ${zipUrl} ...`);
	const buf = new Uint8Array(await (await fetch(zipUrl)).arrayBuffer());
	onLog(`[host] downloaded ${(buf.length / 1024 / 1024).toFixed(1)}MB. unzipping...`);

	const tUnzip = performance.now();
	const entries = unzipSync(buf);
	const names = Object.keys(entries);
	php.mkdir(DOC_ROOT);
	let yieldT = performance.now();
	for (let i = 0; i < names.length; i++) {
		const name = names[i];
		const data = entries[name];
		const full = `${DOC_ROOT}/${name}`;
		const dir = full.slice(0, full.lastIndexOf('/'));
		php.mkdir(dir);
		if (!name.endsWith('/')) php.writeFile(full, data);
		// 数百ms 毎にイベントループに譲る(UI が固まらないように)
		if (performance.now() - yieldT > 500) {
			onLog(`[host] writing… ${i}/${names.length}`);
			yieldT = performance.now();
			await new Promise((res) => setTimeout(res, 0));
		}
	}
	onLog(
		`[host] unpacked ${names.length} files into ${DOC_ROOT} in ` +
			`${Math.round(performance.now() - tUnzip)}ms`,
	);

	// Laravel が要求する空ディレクトリ(bundle で除外している)
	for (const dir of [
		'storage/framework/cache/data',
		'storage/framework/sessions',
		'storage/framework/views',
		'storage/framework/testing',
		'storage/logs',
		'bootstrap/cache',
	]) {
		php.mkdir(`${DOC_ROOT}/${dir}`);
	}

	// .env の APP_URL を「実オリジン + /laravel」に書き換える。
	// AppServiceProvider が URL::forceRootUrl に渡すので、生成リンクに /laravel が付き
	// Service Worker のスコープ内に収まる。
	const scopedUrl = `${location.origin}${URL_SCOPE}`;
	try {
		const envPath = `${DOC_ROOT}/.env`;
		let env = php.readFileAsText(envPath);
		env = /^APP_URL=.*$/m.test(env)
			? env.replace(/^APP_URL=.*$/m, `APP_URL=${scopedUrl}`)
			: env + `\nAPP_URL=${scopedUrl}\n`;
		php.writeFile(envPath, env);
		onLog(`[host] APP_URL = ${scopedUrl}`);
	} catch (e: unknown) {
		const msg = (e as Error)?.message || String(e);
		onLog(`[host] WARN: .env 書き換え失敗: ${msg}`);
	}

	const handler = new PHPRequestHandler({
		php,
		documentRoot: `${DOC_ROOT}/public`,
		// パスのスコープ(/laravel)は Service Worker ブリッジ側で剥がして渡すので、
		// ここは素のオリジン。REQUEST_URI が /demo... になり Laravel のルートが一致する。
		absoluteUrl: location.origin,
		// 実ファイルが無い URL は Laravel のフロントコントローラへ(try_files 相当)
		getFileNotFoundAction: () => ({ type: 'internal-redirect', uri: '/index.php' }),
	});

	onLog('[host] Laravel ready ✅');

	// php.cli() は内部で exit() するため Laravel(常駐 PHP インスタンス)を壊してしまう。
	// 代わりに php.run({code}) で artisan を require して同じ PHP インスタンスを再利用する。
	async function runCli(argv: string[]): Promise<CliResult> {
		const scriptPath = argv[1];
		const code = `<?php
// CLI 実行を模す: $argv/$argc + $_SERVER に注入し、stdout を buffer に集める。
$_SERVER['argv'] = ${JSON.stringify(argv.slice(1))};
$_SERVER['argc'] = ${argv.length - 1};
$_SERVER['SCRIPT_NAME'] = ${JSON.stringify(scriptPath)};
$_SERVER['SCRIPT_FILENAME'] = ${JSON.stringify(scriptPath)};
$_SERVER['PHP_SELF'] = ${JSON.stringify(scriptPath)};
// artisan が exit() を呼んでも HTTP リクエスト全体は終わらないようにフックを試みる。
// ANSI カラーを抑止する環境変数。
putenv('NO_COLOR=1');
putenv('TERM=dumb');
putenv('COMPOSER_NO_INTERACTION=1');
chdir(${JSON.stringify(DOC_ROOT)});
try {
    require ${JSON.stringify(scriptPath)};
} catch (\\Throwable $e) {
    fwrite(STDERR, get_class($e) . ': ' . $e->getMessage() . "\\n" . $e->getTraceAsString());
}
`;
		// 非ゼロ終了で PHPExecutionFailureError が throw されるが .response から救える
		let resp: PHPResponse;
		try {
			resp = await php.run({ code });
		} catch (e: unknown) {
			if (e instanceof PHPExecutionFailureError) {
				resp = e.response;
			} else {
				throw e;
			}
		}
		return {
			stdout: resp.text ?? '',
			stderr: resp.errors ?? '',
			exitCode: resp.exitCode ?? 0,
		};
	}

	return {
		handler,
		async request(method: string, path: string) {
			const res = await handler.request({ method: method as HTTPMethod, url: path });
			return {
				status: res.httpStatusCode,
				headers: res.headers,
				text: res.text,
			};
		},
		async runArtisan(args: string[]) {
			return runCli(['php', `${DOC_ROOT}/artisan`, ...args]);
		},
		async about() {
			// 本家 artisan about の代替。Laravel/PHP/SAPI/Driver 設定 + MySQL バージョン
			// + ロード済み拡張一覧 を、proc_open を呼ばずに集めて整形して返す。
			const code = `<?php
chdir(${JSON.stringify(DOC_ROOT)});
require ${JSON.stringify(DOC_ROOT + '/vendor/autoload.php')};
$app = require ${JSON.stringify(DOC_ROOT + '/bootstrap/app.php')};
$kernel = $app->make(Illuminate\\Contracts\\Console\\Kernel::class);
$kernel->bootstrap();

use Illuminate\\Support\\Facades\\DB;

$sections = [];

$sections['Environment'] = [
    'Application Name'    => config('app.name'),
    'Laravel Version'     => $app->version(),
    'PHP Version'         => PHP_VERSION,
    'PHP SAPI'            => php_sapi_name(),
    'Composer Version'    => '(skipped — proc_open unavailable in wasm)',
    'Environment'         => $app->environment(),
    'Debug Mode'          => config('app.debug') ? 'ENABLED' : 'OFF',
    'URL'                 => config('app.url'),
    'Maintenance Mode'    => $app->isDownForMaintenance() ? 'ENABLED' : 'OFF',
    'Timezone'            => config('app.timezone'),
    'Locale'              => $app->getLocale(),
];

$sections['Drivers'] = [
    'Broadcasting' => config('broadcasting.default'),
    'Cache'        => config('cache.default'),
    'Database'     => config('database.default'),
    'Logs'         => config('logging.default'),
    'Mail'         => config('mail.default'),
    'Queue'        => config('queue.default'),
    'Session'      => config('session.driver'),
];

if (config('database.default') === 'mysql') {
    $c = config('database.connections.mysql');
    $row = [
        'Driver'   => $c['driver'],
        'Host'     => $c['host'] . ':' . $c['port'],
        'Database' => $c['database'],
        'Username' => $c['username'],
        'Charset'  => $c['charset'],
    ];
    try {
        $row['Server Version'] = DB::select('SELECT VERSION() AS v')[0]->v ?? '?';
        $row['Table Count']    = count(DB::select('SHOW TABLES'));
    } catch (\\Throwable $e) {
        $row['Connection']     = 'ERROR: ' . $e->getMessage();
    }
    $sections['Database — MySQL connection'] = $row;
}

$exts = get_loaded_extensions();
sort($exts);
$sections['Loaded PHP Extensions (' . count($exts) . ')'] =
    [implode(', ', $exts)];

// 整形
foreach ($sections as $title => $kv) {
    echo "\\n  " . $title . "\\n";
    $maxKey = 0;
    $hasKey = false;
    foreach (array_keys($kv) as $k) {
        if (!is_int($k)) {
            $hasKey = true;
            $maxKey = max($maxKey, strlen((string)$k));
        }
    }
    foreach ($kv as $k => $v) {
        if (!$hasKey) {
            echo "    " . wordwrap((string)$v, 110, "\\n    ", true) . "\\n";
        } else {
            echo "    " . str_pad((string)$k, $maxKey) . " : " . $v . "\\n";
        }
    }
}
echo "\\n";
`;
			let resp;
			try {
				resp = await php.run({ code });
			} catch (e: unknown) {
				if (e instanceof PHPExecutionFailureError) resp = e.response;
				else throw e;
			}
			return {
				stdout: resp.text ?? '',
				stderr: resp.errors ?? '',
				exitCode: resp.exitCode ?? 0,
			};
		},
		async tinker(expr: string) {
			// artisan tinker は psysh をロードするが、psysh は wasm 環境で
			// parse error を起こす。Laravel カーネルを直接 bootstrap して
			// 任意の式を eval する自前ランナーで代替する。
			const code = `<?php
chdir(${JSON.stringify(DOC_ROOT)});
require '${DOC_ROOT}/vendor/autoload.php';
$app = require '${DOC_ROOT}/bootstrap/app.php';
$kernel = $app->make(Illuminate\\Contracts\\Console\\Kernel::class);
$kernel->bootstrap();
// よく使う facade を namespace 短縮で持ち込む
use Illuminate\\Support\\Facades\\DB;
use Illuminate\\Support\\Facades\\Schema;
use App\\Models\\User;
use App\\Models\\Post;
try {
    $__result = eval('return (' . ${JSON.stringify(expr)} . ');');
    if (is_string($__result) || is_int($__result) || is_float($__result) || is_bool($__result) || is_null($__result)) {
        var_export($__result);
        echo "\\n";
    } else {
        print_r($__result);
    }
} catch (\\Throwable $e) {
    fwrite(STDERR, '【eval error】 ' . get_class($e) . ': ' . $e->getMessage() . "\\n");
}
`;
			let resp;
			try {
				resp = await php.run({ code });
			} catch (e: unknown) {
				if (e instanceof PHPExecutionFailureError) resp = e.response;
				else throw e;
			}
			return {
				stdout: resp.text ?? '',
				stderr: resp.errors ?? '',
				exitCode: resp.exitCode ?? 0,
			};
		},
	};
}
