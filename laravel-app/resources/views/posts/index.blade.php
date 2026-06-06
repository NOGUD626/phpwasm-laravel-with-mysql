<!doctype html>
<html lang="ja">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>posts CRUD — HTMX + Alpine.js (Laravel + 外の MySQL)</title>
    {{-- /laravel スコープ下に居るので、相対 URL の解決基点をスコープ末尾に固定 --}}
    <base href="{{ url('/') }}/" />
    <meta name="csrf-token" content="{{ csrf_token() }}" />
    <script src="vendor/htmx.min.js" defer></script>
    <script src="vendor/alpine.min.js" defer></script>
    <style>
        :root { color-scheme: light dark; }
        body { font-family: system-ui, sans-serif; padding: 16px; max-width: 880px; margin: 0 auto; line-height: 1.5; }
        h1 { font-size: 18px; margin: 0 0 4px; }
        .sub { color: #888; font-size: 12px; margin: 0 0 12px; }
        form.create { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 16px; padding: 10px; border: 1px solid #4445; border-radius: 8px; background: #11111108; }
        form.create input { padding: 6px 10px; border: 1px solid #4445; border-radius: 6px; font-size: 13px; }
        form.create input[name="title"] { width: 200px; }
        form.create input[name="body"]  { flex: 1; min-width: 200px; }
        button { font-size: 12px; padding: 5px 10px; border-radius: 6px; border: 1px solid #4445; cursor: pointer; background: #fff1; }
        button.primary { background: #3b82f6; color: #fff; border: none; }
        button.danger  { background: #ef4444; color: #fff; border: none; }
        button.save    { background: #14b8a6; color: #fff; border: none; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { padding: 6px 8px; border-bottom: 1px solid #4443; vertical-align: top; }
        th { text-align: left; background: #11111108; }
        td.actions { white-space: nowrap; }
        .htmx-indicator { color: #888; font-size: 12px; margin-left: 8px; opacity: 0; transition: opacity .2s; }
        .htmx-request .htmx-indicator { opacity: 1; }
        .empty { color: #888; padding: 12px; text-align: center; }
    </style>
</head>
<body hx-headers='{"X-CSRF-TOKEN": "{{ csrf_token() }}"}'>

<h1>📒 posts CRUD — HTMX + Alpine.js</h1>
<p class="sub">
    iframe 内で動く Laravel 13 が、ブラウザの外の MySQL 8 を読み書きしています。
    フォーム送信・編集・削除はすべて HTMX で部分 HTML をやり取り(ページ全体は再ロードしない)。
</p>

<form class="create"
      hx-post="posts"
      hx-target="#posts-body"
      hx-swap="beforeend"
      hx-on::after-request="if (event.detail.successful) this.reset()">
    <input name="title" placeholder="title" required maxlength="255" />
    <input name="body" placeholder="body" maxlength="1000" />
    <button class="primary" type="submit">＋ 追加</button>
    <span class="htmx-indicator">送信中…</span>
</form>

<table>
    <thead>
        <tr>
            <th style="width:48px">id</th>
            <th style="width:200px">title</th>
            <th>body</th>
            <th style="width:110px">created_at</th>
            <th style="width:120px">actions</th>
        </tr>
    </thead>
    <tbody id="posts-body">
        @forelse ($posts as $post)
            @include('posts._row', ['post' => $post])
        @empty
            <tr><td colspan="5" class="empty">まだ無し</td></tr>
        @endforelse
    </tbody>
</table>

</body>
</html>
