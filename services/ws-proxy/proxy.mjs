// WebSocket ↔ TCP プロキシ
// ブラウザの @php-wasm/web から張られた WebSocket を、ホスト上の TCP(MySQL)へ中継する。
//
// 接続先は WebSocket URL のパスから読む。
//   ws://localhost:8090/mysql:3306        → 127.0.0.1:3306 へ
//   ws://localhost:8090/192.168.0.10:3306 → 指定ホストへ
// パスが無い場合は DEFAULT_TARGET にフォールバックする。
//
// 重要な性質:
//   - バイナリ専用(binary WebSocket)。MySQL は生バイトを流すため text フレームは扱わない。
//   - "open" 前の TCP→WS 送信は queue で吸収。WS 切断で TCP も閉じる(双方向クローズ)。
//   - 多重接続(複数 PDO/mysqli)に対応 — connection ごとに独立 TCP を張る。
//
// セキュリティ: このプロキシは MySQL を WebSocket でネットに晒すのと同義。
// 本番運用するなら ORIGIN チェック・接続トークン・宛先ホワイトリストを必ず追加すること。

import http from 'node:http';
import net from 'node:net';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8090);
const DEFAULT_TARGET = process.env.DEFAULT_TARGET ?? '127.0.0.1:3306';
const ALLOW_HOSTS = (process.env.ALLOW_HOSTS ?? '127.0.0.1,localhost,mysql')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

const server = http.createServer((req, res) => {
	res.writeHead(200, { 'content-type': 'text/plain' });
	res.end('ws-proxy ready\n');
});

const wss = new WebSocketServer({ server });

function parseTarget(reqUrl) {
	// URL パス先頭の "/host:port" を読む。"/" の場合は DEFAULT_TARGET。
	const path = (reqUrl ?? '/').replace(/^\/+/, '');
	const raw = path === '' ? DEFAULT_TARGET : path;
	const m = /^([A-Za-z0-9_.-]+):(\d{1,5})$/.exec(raw);
	if (!m) return null;
	const host = m[1];
	const port = Number(m[2]);
	if (!ALLOW_HOSTS.includes(host)) return null;
	if (port < 1 || port > 65535) return null;
	return { host, port };
}

wss.on('connection', (ws, req) => {
	const target = parseTarget(req.url);
	if (!target) {
		ws.close(1008, 'invalid target');
		return;
	}

	const id = `${req.socket.remoteAddress}:${req.socket.remotePort} → ${target.host}:${target.port}`;
	const t0 = Date.now();
	let bWS2TCP = 0;
	let bTCP2WS = 0;
	const ms = () => `+${Date.now() - t0}ms`;
	console.log(`[open ${ms()}] ${id} subprotocol=${ws.protocol || '(none)'}`);

	const tcp = net.connect(target.port, target.host);
	const tcpQueue = []; // WS から先に届いた分を TCP open まで貯める
	let tcpOpen = false;

	tcp.on('connect', () => {
		tcpOpen = true;
		console.log(`[tcp connected ${ms()}] ${id} (queued=${tcpQueue.length})`);
		for (const chunk of tcpQueue) tcp.write(chunk);
		tcpQueue.length = 0;
	});

	tcp.on('data', (chunk) => {
		bTCP2WS += chunk.length;
		console.log(`[tcp→ws ${ms()}] ${id} +${chunk.length}B (total=${bTCP2WS}, first16=${chunk.slice(0, 16).toString('hex')})`);
		if (ws.readyState === ws.OPEN) ws.send(chunk);
	});

	tcp.on('error', (err) => {
		console.warn(`[tcp err] ${id}: ${err.message}`);
		try { ws.close(1011, 'tcp error'); } catch {}
	});

	tcp.on('close', (hadError) => {
		console.log(`[close tcp ${ms()}] ${id} hadError=${hadError} ws→tcp=${bWS2TCP}B tcp→ws=${bTCP2WS}B`);
		try { ws.close(1000, 'tcp closed'); } catch {}
	});

	ws.on('message', (data, isBinary) => {
		const buf = Buffer.isBuffer(data)
			? data
			: Array.isArray(data)
				? Buffer.concat(data)
				: Buffer.from(data);
		bWS2TCP += buf.length;
		console.log(`[ws→tcp ${ms()}] ${id} +${buf.length}B (total=${bWS2TCP}, binary=${isBinary}, first16=${buf.slice(0, 16).toString('hex')})`);
		if (tcpOpen) tcp.write(buf);
		else tcpQueue.push(buf);
	});

	ws.on('close', () => {
		console.log(`[close ws] ${id}`);
		try { tcp.end(); } catch {}
	});

	ws.on('error', (err) => {
		console.warn(`[ws err] ${id}: ${err.message}`);
		try { tcp.destroy(); } catch {}
	});
});

server.listen(PORT, () => {
	console.log(`ws-proxy listening on :${PORT}`);
	console.log(`  default target: ${DEFAULT_TARGET}`);
	console.log(`  allowed hosts : ${ALLOW_HOSTS.join(', ')}`);
});
