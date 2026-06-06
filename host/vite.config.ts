// ホスト Vite 設定。
// - COOP/COEP: PHP-wasm が SharedArrayBuffer/JSPI を要求する場合があるため有効化
// - `?url` ミドルウェア: グルーが要求する .wasm?import を URL文字列モジュールに化かす
// - optimizeDeps.exclude: @php-wasm/web のグルーは事前バンドルで壊れる
import type { Plugin, ViteDevServer } from 'vite';

const phpWasmUrlPlugin: Plugin = {
	name: 'php-wasm-url-middleware',
	configureServer(server: ViteDevServer) {
		server.middlewares.use((req, res, next) => {
			const url = req.url || '';
			if (/\.wasm(\?|$)/.test(url) && /[?&](import|url)(=|&|$)/.test(url)) {
				const cleanUrl = url.split('?')[0];
				const body = `export default ${JSON.stringify(cleanUrl)};\n`;
				res.setHeader('Content-Type', 'text/javascript');
				res.setHeader('Cache-Control', 'no-cache');
				res.end(body);
				return;
			}
			next();
		});
	},
};

export default {
	server: {
		port: 5180,
		strictPort: true,
		fs: { strict: false },
		// Asyncify ビルドは SharedArrayBuffer 不要なので COOP/COEP は外す。
		// (有効にすると静的アセット側に CORP ヘッダが必要になり、laravel-app.zip
		// の fetch がブラウザに拒否されて hang する)
	},
	plugins: [phpWasmUrlPlugin],
	optimizeDeps: {
		exclude: ['@php-wasm/web', '@php-wasm/web-8-3'],
	},
};
