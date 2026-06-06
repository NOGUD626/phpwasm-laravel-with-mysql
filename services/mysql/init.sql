-- docker-entrypoint の mysql クライアントがデフォルト latin1 でこのファイルを
-- 取り込むと、UTF-8 で書いた日本語が二重エンコードされて入る。最初に文字セットを
-- utf8mb4 へ固定して防ぐ。
SET NAMES utf8mb4;

-- demo ユーザに対し mysql_native_password で明示的にパスワードを設定する。
-- (caching_sha2_password 環境で作られた既存ユーザを上書きするため)
ALTER USER 'demo'@'%' IDENTIFIED WITH mysql_native_password BY 'demopass';
FLUSH PRIVILEGES;

USE demodb;

CREATE TABLE IF NOT EXISTS posts (
    id        INT          NOT NULL AUTO_INCREMENT,
    title     VARCHAR(255) NOT NULL,
    body      TEXT         NULL,
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO posts (title, body) VALUES
    ('はじめての投稿',     'php-wasm から PDO 経由で読めるかのテスト'),
    ('2件目',              'WebSocket トンネル越し'),
    ('日本語マルチバイト', '🐘🐬');
