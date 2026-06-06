# ====================================================================
# phpwasm-laravel-with-mysql — Mac 向け簡易起動レシピ
# ====================================================================
# Mac で Docker Desktop / Node 20+ / Composer が入っている前提。
#
#   make up      …… MySQL + ws-proxy + Vite を一発起動して http://localhost:5180
#   make down    …… 全部止める
#   make reset   …… Docker volume も消して完全初期化
#   make bundle  …… laravel-app/ → host/public/laravel-app.zip
#   make doctor  …… 前提条件を確認
#   make help    …… コマンド一覧
# ====================================================================

HOST_DIR      := host
LARAVEL_DIR   := laravel-app
COMPOSE_FILE  := services/mysql/docker-compose.yml
WS_PROXY_DIR  := services/ws-proxy
VITE_PORT     := 5180
WS_PROXY_PORT := 8090
MYSQL_PORT    := 3306

# pid 保存先(make down で kill する)
RUN_DIR       := .make-run
WS_PROXY_PID  := $(RUN_DIR)/ws-proxy.pid
VITE_PID      := $(RUN_DIR)/vite.pid

.DEFAULT_GOAL := help

.PHONY: help
help: ## このヘルプを表示
	@awk 'BEGIN{FS=":.*## "} /^[a-zA-Z0-9_.-]+:.*## /{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --------------------------------------------------------------------
# セットアップ
# --------------------------------------------------------------------

.PHONY: install
install: install-host install-laravel install-proxy ## 全コンポーネントの npm install / composer install

install-host: ## ホストアプリの依存 + カスタム wasm 差し替え
	cd $(HOST_DIR) && npm install --no-audit --no-fund
	@$(MAKE) -s patch-wasm

install-laravel: ## composer install
	cd $(LARAVEL_DIR) && composer install --no-interaction --no-progress

install-proxy: ## ws-proxy の依存
	cd $(WS_PROXY_DIR) && npm install --no-audit --no-fund

# --------------------------------------------------------------------
# カスタム wasm 差し替え
# --------------------------------------------------------------------
# @php-wasm/web の配布版は WITH_MYSQL=no でビルドされており pdo_mysql / mysqli が
# 入っていない。host/node_modules/@php-wasm/web-8-3/asyncify/ を build:wasm の
# 出力に差し替えて、グルー JS の wasm import を `?url` に書き換える。

CUSTOM_WASM_DIR := vendor-php-wasm/web-8-3-asyncify
WASM_TARGET_DIR := $(HOST_DIR)/node_modules/@php-wasm/web-8-3/asyncify

.PHONY: patch-wasm
patch-wasm: ## カスタム wasm を node_modules に差し替え + `?url` 注入
	@if [ ! -f "$(CUSTOM_WASM_DIR)/php_8_3.js" ]; then \
		echo "  ✗ $(CUSTOM_WASM_DIR) が無い。先に 'make build-wasm' を実行してください"; \
		exit 1; \
	fi
	@rm -rf $(WASM_TARGET_DIR)/8_3_30 $(WASM_TARGET_DIR)/8_3_31
	@mkdir -p $(WASM_TARGET_DIR)/8_3_31
	@cp $(CUSTOM_WASM_DIR)/php_8_3.js          $(WASM_TARGET_DIR)/php_8_3.js
	@cp $(CUSTOM_WASM_DIR)/8_3_31/php_8_3.wasm $(WASM_TARGET_DIR)/8_3_31/php_8_3.wasm
	@sed -i.bak "s#'./8_3_31/php_8_3.wasm'#'./8_3_31/php_8_3.wasm?url'#g" $(WASM_TARGET_DIR)/php_8_3.js
	@rm -f $(WASM_TARGET_DIR)/php_8_3.js.bak
	@echo "  ✓ patched $(WASM_TARGET_DIR)"

.PHONY: build-wasm
build-wasm: ## カスタム wasm をビルド(初回 10-30 分、要 wordpress-playground clone)
	@if [ ! -d "wordpress-playground" ]; then \
		echo "  → cloning WordPress/wordpress-playground (shallow)…"; \
		git clone --depth 1 --single-branch https://github.com/WordPress/wordpress-playground.git wordpress-playground; \
	fi
	@if [ ! -d "wordpress-playground/packages/php-wasm/compile/node_modules/yargs" ]; then \
		npm install --prefix wordpress-playground/packages/php-wasm/compile --no-save --no-audit --no-fund yargs; \
	fi
	cd wordpress-playground && node packages/php-wasm/compile/build.js \
		--PLATFORM=web --PHP_VERSION=8.3 \
		--WITH_MYSQL=yes --WITH_WS_NETWORKING_PROXY=yes
	@mkdir -p $(CUSTOM_WASM_DIR)/8_3_31
	@cp wordpress-playground/packages/php-wasm/web-builds/8-3/asyncify/php_8_3.js \
	    $(CUSTOM_WASM_DIR)/php_8_3.js
	@cp wordpress-playground/packages/php-wasm/web-builds/8-3/asyncify/8_3_31/php_8_3.wasm \
	    $(CUSTOM_WASM_DIR)/8_3_31/php_8_3.wasm
	@echo "  ✓ built into $(CUSTOM_WASM_DIR)/"

# --------------------------------------------------------------------
# 起動
# --------------------------------------------------------------------

$(RUN_DIR):
	@mkdir -p $(RUN_DIR)

.PHONY: up
up: $(RUN_DIR) db-up proxy-up bundle dev ## MySQL + ws-proxy + Vite を立ち上げて開く
	@echo ""
	@echo "  ✓ all up — open http://localhost:$(VITE_PORT)"

.PHONY: db-up
db-up: ## MySQL Docker を起動(healthy 待ち)
	docker compose -f $(COMPOSE_FILE) up -d
	@printf "  → MySQL healthy 待ち"
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12; do \
		s=$$(docker inspect -f '{{.State.Health.Status}}' phpwasm-mysql 2>/dev/null); \
		printf "."; \
		[ "$$s" = "healthy" ] && { echo " ok"; exit 0; }; \
		sleep 5; \
	done; \
	echo " timeout(状況: $$s)"; exit 1

.PHONY: proxy-up
proxy-up: $(RUN_DIR) ## ws-proxy を起動(バックグラウンド)
	@if [ -f $(WS_PROXY_PID) ] && kill -0 `cat $(WS_PROXY_PID)` 2>/dev/null; then \
		echo "  · ws-proxy は既に起動済み (pid `cat $(WS_PROXY_PID)`)"; \
	else \
		( cd $(WS_PROXY_DIR) && node proxy.mjs > ../../$(RUN_DIR)/ws-proxy.log 2>&1 & echo $$! > ../../$(WS_PROXY_PID) ); \
		sleep 1; \
		echo "  ✓ ws-proxy 起動 (pid `cat $(WS_PROXY_PID)`) → ws://localhost:$(WS_PROXY_PORT)/"; \
	fi

.PHONY: dev
dev: $(RUN_DIR) ## Vite dev server(フォアグラウンド)
	cd $(HOST_DIR) && npm run dev

.PHONY: bundle
bundle: ## laravel-app/ → host/public/laravel-app.zip
	cd $(HOST_DIR) && npm run bundle:laravel

# --------------------------------------------------------------------
# 停止 / リセット
# --------------------------------------------------------------------

.PHONY: down
down: proxy-down db-down ## 全部止める(volume は残す)
	@echo "  ✓ all down"

.PHONY: proxy-down
proxy-down: ## ws-proxy を止める
	@if [ -f $(WS_PROXY_PID) ]; then \
		kill `cat $(WS_PROXY_PID)` 2>/dev/null || true; \
		rm -f $(WS_PROXY_PID); \
		echo "  ✓ ws-proxy 停止"; \
	fi
	@# 万一 pid ファイル無しで残ってたら lsof で拾って kill
	@p=$$(lsof -nP -iTCP:$(WS_PROXY_PORT) -sTCP:LISTEN -t 2>/dev/null); \
	if [ -n "$$p" ]; then kill $$p 2>/dev/null || true; echo "  ✓ stray ws-proxy 停止 (pid $$p)"; fi

.PHONY: db-down
db-down: ## MySQL コンテナ停止(データ保持)
	docker compose -f $(COMPOSE_FILE) down

.PHONY: reset
reset: down ## volume も消して MySQL を完全初期化
	docker compose -f $(COMPOSE_FILE) down -v
	@echo "  ✓ reset(次回 db-up で init.sql が再実行される)"

.PHONY: clean
clean: ## node_modules / vendor / bundle ZIP を全削除
	rm -rf $(HOST_DIR)/node_modules $(HOST_DIR)/.vite
	rm -rf $(WS_PROXY_DIR)/node_modules
	rm -rf $(LARAVEL_DIR)/vendor
	rm -f  $(HOST_DIR)/public/laravel-app.zip
	@echo "  ✓ cleaned"

# --------------------------------------------------------------------
# 前提条件チェック
# --------------------------------------------------------------------

.PHONY: doctor
doctor: ## 必要なツールが揃っているか確認
	@echo "  ── doctor ──"
	@command -v node      >/dev/null && node -v       | sed 's/^/  ✓ node    /' || echo "  ✗ node 未インストール (要 20+)"
	@command -v npm       >/dev/null && npm  -v       | sed 's/^/  ✓ npm     /' || echo "  ✗ npm 未インストール"
	@command -v php       >/dev/null && php  -v | head -1 | sed 's/^/  ✓ php     /' || echo "  ✗ php 未インストール (要 8.2+、Laravel app 生成・composer 用)"
	@command -v composer  >/dev/null && composer --version | head -1 | sed 's/^/  ✓ composer/' || echo "  ✗ composer 未インストール"
	@command -v docker    >/dev/null && docker --version  | sed 's/^/  ✓ docker  /' || echo "  ✗ docker 未インストール"
	@docker info >/dev/null 2>&1 && echo "  ✓ docker daemon 動作中" || echo "  ✗ docker daemon 停止中(Docker Desktop を起動)"
	@command -v gh        >/dev/null && gh --version | head -1 | sed 's/^/  ✓ gh      /' || echo "  · gh 未インストール (任意)"
