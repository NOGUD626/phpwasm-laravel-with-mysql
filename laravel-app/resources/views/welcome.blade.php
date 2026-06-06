<!doctype html>
<html lang="ja">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>php-wasm Laravel demo</title>
    <base href="{{ url('/') }}/" />
    <style>
        :root { color-scheme: light dark; }
        body { font-family: system-ui, sans-serif; max-width: 760px; margin: 0 auto; padding: 18px; line-height: 1.5; }
        h1 { font-size: 20px; margin: 0 0 6px; }
        .sub { color: #888; font-size: 13px; margin: 0 0 18px; }
        .env { background: #11111108; border: 1px solid #4445; border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-bottom: 16px; }
        .env b { color: #14b8a6; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        a.card { display: block; padding: 14px; border: 1px solid #4445; border-radius: 8px; text-decoration: none; color: inherit; background: #fff1; transition: transform .08s, border-color .08s; }
        a.card:hover { transform: translateY(-1px); border-color: #3b82f6; }
        a.card .ttl { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
        a.card .desc { font-size: 12px; color: #888; }
        a.card .tag { display: inline-block; font-size: 10.5px; padding: 1px 6px; border-radius: 4px; background: #11111111; margin-left: 6px; vertical-align: middle; }
        a.card.htmx .ttl::before { content: '📒 '; }
        a.card.json .ttl::before { content: '🩺 '; }
        a.card.health .ttl::before { content: '❤️‍🩹 '; }
        a.card.repo .ttl::before { content: '📁 '; }
        a.card.info .ttl::before { content: '🐘 '; }
    </style>
</head>
<body>
    <h1>🐘 ようこそ — php-wasm Laravel demo</h1>
    <p class="sub">このページは iframe 内で動いている Laravel 13 の <code>/</code> ルートが返しています。下のカードからの遷移もすべて wasm 内 Laravel + ブラウザ外 MySQL で完結します。</p>

    <div class="env">
        <b>Laravel</b> {{ app()->version() }} &nbsp;/&nbsp;
        <b>PHP</b> {{ PHP_VERSION }} &nbsp;/&nbsp;
        <b>SAPI</b> {{ php_sapi_name() }} &nbsp;/&nbsp;
        <b>DB</b> {{ config('database.default') }}
        @if (config('database.default') === 'mysql')
            &nbsp;@ {{ config('database.connections.mysql.host') }}:{{ config('database.connections.mysql.port') }}/{{ config('database.connections.mysql.database') }}
        @endif
    </div>

    <div class="grid">
        <a class="card htmx" href="posts">
            <div class="ttl">posts CRUD <span class="tag">HTMX + Alpine.js</span></div>
            <div class="desc">MySQL の posts テーブルに対する一覧 / 追加 / インライン編集 / 削除。すべて部分 HTML のやり取りで、ページ再ロードなし。</div>
        </a>
        <a class="card json" href="demo">
            <div class="ttl">/demo JSON <span class="tag">DB::select</span></div>
            <div class="desc">Laravel / PHP / SAPI / MySQL バージョン、SHOW TABLES、posts 一覧を JSON で返すヘルスチェック相当。</div>
        </a>
        <a class="card info" href="phpinfo">
            <div class="ttl">phpinfo() <span class="tag">PHP 内蔵</span></div>
            <div class="desc">PHP/Zend バージョン、コンパイル時オプション、ロード済み拡張(mysqli / pdo_mysql 等)、ini 設定の素のダンプ。proc_open のような未対応関数や WS 用 Asyncify ビルドの中身が見える。</div>
        </a>
        <a class="card health" href="up">
            <div class="ttl">/up <span class="tag">Laravel 11+ built-in</span></div>
            <div class="desc">Laravel 標準のヘルスチェックエンドポイント。アプリの bootstrap が通っていれば 200。</div>
        </a>
        <a class="card repo" href="https://github.com/NOGUD626/php-wasm-laravel-demo" target="_top">
            <div class="ttl">参考: 元記事リポ <span class="tag">GitHub</span></div>
            <div class="desc">SQLite 版の元実装。本デモは「外の MySQL」対応 + artisan/tinker/HTMX を追加した派生。</div>
        </a>
    </div>
</body>
</html>
