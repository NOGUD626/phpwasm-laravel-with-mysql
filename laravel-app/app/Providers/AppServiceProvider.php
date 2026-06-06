<?php

namespace App\Providers;

use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Service Worker が /laravel 配下のリクエストを横取りして PHP に渡すので、
        // 生成 URL(リダイレクト・asset URL 等)に /laravel 接頭辞を強制する。
        $appUrl = config('app.url');
        if ($appUrl) {
            URL::forceRootUrl($appUrl);
        }
    }
}
