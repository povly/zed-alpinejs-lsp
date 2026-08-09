# Правила Rust-обёртки (src/lib.rs)

> Area-специфичные конвенции для Rust-обёртки Zed Extension API. Загружаются после rules/base.md.

## Правила

- Rust-сторона НЕ содержит парсинга или LSP-логики — только поставка JS-файлов, npm-установка зависимостей и запуск процесса `node --stdio`
- Константа `SERVER_FILES` должна содержать ровно те файлы, что фактически есть в `server/dist/` — рассинхрон = неработающее расширение после пересборки
- Версии в `zed::npm_install_package(name, version)` должны совпадать с `server/package.json` `dependencies` — рассинхрон = runtime-ошибка при установке у пользователя
- Установка идемпотентна: перед `install_server` проверять `self.did_install && self.server_exists()` — повторные вызовы `language_server_command` не должны переустанавливать
- Создание родительских директорий перед записью файла: `fs::create_dir_all(parent)` для каждого пути в `SERVER_FILES`
- Ошибки — строковые с контекстом: `.map_err(|e| format!("Failed to write {path}: {e}"))?` — пользователь видит осмысленное сообщение в Zed
- `language_server_command` возвращает `zed::Command` с `node_binary_path()?` и аргументами `[server_path, "--stdio"]` — без env-переменных (`Default::default()`)
- Регистрация расширения через `zed::register_extension!(AlpineExtension)` — единственная точка входа
