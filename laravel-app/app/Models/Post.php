<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * MySQL の posts テーブル(init.sql で作成済み)に対応する Eloquent モデル。
 * デモ用なので mass-assignment は title/body だけに絞る。
 */
class Post extends Model
{
    protected $fillable = ['title', 'body'];

    // init.sql が updated_at を持たないので timestamps を created_at だけ扱う設定
    public const UPDATED_AT = null;
}
