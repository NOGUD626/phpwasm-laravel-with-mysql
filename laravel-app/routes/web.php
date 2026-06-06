<?php

use App\Models\Post;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// phpinfo() の出力を <base> 込みで返す。iframe 内のリンクが /laravel スコープから
// 外れないように <base href> も埋め込む(phpinfo は素の HTML を吐くだけなので素直に
// バッファリング)。
Route::get('/phpinfo', function () {
    ob_start();
    phpinfo();
    $html = ob_get_clean();
    // <head> の直後に <base href> を差し込んで、phpinfo 内のセクション内リンクや
    // PHP credits 等のリンクが iframe を抜け出さないようにする
    $baseTag = '<base href="' . url('/') . '/" />';
    $html = preg_replace('/<head>/i', '<head>' . $baseTag, $html, 1);
    return response($html)->header('content-type', 'text/html; charset=utf-8');
});

// MySQL の状況を JSON で返すヘルスチェック相当。
Route::get('/demo', function () {
    $payload = [
        'framework'  => 'Laravel ' . app()->version(),
        'php'        => PHP_VERSION,
        'sapi'       => php_sapi_name(),
        'db_default' => config('database.default'),
    ];

    try {
        $payload['mysql_version'] = DB::select('SELECT VERSION() AS v')[0]->v ?? null;
        $payload['tables'] = collect(DB::select('SHOW TABLES'))
            ->map(fn ($r) => array_values((array) $r)[0])
            ->all();
        $payload['posts'] = DB::select('SELECT id, title FROM posts ORDER BY id');
        $payload['posts_count'] = count($payload['posts']);
    } catch (\Throwable $e) {
        $payload['mysql_error'] = get_class($e) . ': ' . $e->getMessage();
    }

    return response()->json($payload, 200, [], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
});

// HTMX + Alpine.js の posts CRUD デモ。
// 個々の HTMX エンドポイントは部分 HTML(行 partial 等)を返す。
Route::get('/posts', function () {
    $posts = Post::orderBy('id')->get();
    return view('posts.index', ['posts' => $posts]);
});

Route::post('/posts', function (Request $r) {
    $data = $r->validate([
        'title' => 'required|string|max:255',
        'body'  => 'nullable|string|max:1000',
    ]);
    $post = Post::create($data);
    // 行 partial を返して HTMX で表に append する
    return view('posts._row', ['post' => $post]);
});

Route::delete('/posts/{id}', function (string $id) {
    Post::where('id', (int) $id)->delete();
    // 空 200 を返せば HTMX 側で hx-swap="outerHTML" した tr が消える
    return response('', 200);
});

Route::patch('/posts/{id}', function (Request $r, string $id) {
    $data = $r->validate([
        'title' => 'required|string|max:255',
        'body'  => 'nullable|string|max:1000',
    ]);
    $post = Post::where('id', (int) $id)->firstOrFail();
    $post->fill($data)->save();
    return view('posts._row', ['post' => $post]);
});
