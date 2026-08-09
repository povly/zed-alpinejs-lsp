# План: Наблюдаемость ошибок

**Ветка:** main (без веток — `git.create_branches: false`)
**Создан:** 2026-08-09
**Milestone:** Наблюдаемость ошибок (ROADMAP.md, Стабилизация — последний)

## Original Request

roadmap

## Roadmap Linkage

**Milestone:** "Наблюдаемость ошибок"
**Rationale:** Последний milestone фазы стабилизации. Заменить молчаливые `catch { /* skip */ }` на context-aware warn логи, добавить метрики производительности индексации. Текущее состояние: 2 SILENT catch блока в workspace.ts (lines 149, 168), 3 LOGGED catch блока в server.ts без контекста (URI/path), zero timing infrastructure.

## Settings

- **Testing:** yes — регрессионные тесты для warn logging и metrics
- **Logging:** verbose
- **Docs:** no — warn-only (внутреннее изменение observability, docs/features.md не требует обновления)

## Анализ

### Audit (из explore agent)

**SILENT catch blocks (2) — workspace.ts:**
| Line | Context | Problem |
|------|---------|---------|
| 149 | `catch { return; }` in scanWorkspace readdirSync | Молча пропускает всю директорию при EACCES/ENOENT |
| 168 | `catch { /* skip */ }` in scanWorkspace readFileSync | Молча пропускает файл при ошибке чтения |

**LOGGED catch blocks (3) — server.ts (без контекста):**
| Line | Current | Missing |
|------|---------|---------|
| 55 | `Index error: ${e}` | URI не логируется |
| 59 | `Parse error: ${e}` | URI не логируется |
| 81 | `Workspace scan failed: ${e}` | rootPath не логируется |

**Timing infrastructure:** ZERO. Нет `performance.now()`, нет `Date.now()`, нет duration logging. `onInitialize` логирует counts но не timing.

### Architecture constraint
`WorkspaceIndex` — pure data class, не имеет reference на `connection`. Для warn логирования нужен callback-инъекция, а не прямой доступ к LSP connection.

## Задачи

### Task 1: Context-aware warn logging в workspace.ts silent catches
- [x] **Файл:** `server/src/workspace.ts`
- [x] **Изменения:**
  - Добавить optional logger callback parameter к `scanWorkspace`:
    ```ts
    type LoggerFn = (level: 'warn' | 'info', msg: string) => void;
    scanWorkspace(rootPath: string, logger?: LoggerFn): { durationMs: number; fileCount: number; skippedCount: number } {
      const t0 = performance.now();
      let fileCount = 0;
      let skippedCount = 0;
      // ...
    }
    ```
  - В readdirSync catch (line ~149):
    ```ts
    } catch (e) {
      logger?.('warn', `scanWorkspace: cannot read directory "${dir}": ${e}`);
      skippedCount++;
      return;
    }
    ```
  - В readFileSync catch (line ~168):
    ```ts
    } catch (e) {
      logger?.('warn', `scanWorkspace: cannot read file "${filePath}": ${e}`);
      skippedCount++;
    }
    ```
  - Считать `fileCount` для каждого успешно прочитанного файла
  - Возвращать metrics object: `{ durationMs: performance.now() - t0, fileCount, skippedCount }`
  - **НЕ** добавлять logger к `indexDocument` — там нет catch блоков (парсинг обрабатывается в server.ts)
- [x] **Тесты** (`test/test.js`, suite `'workspace: scanWorkspace logging'`):
  - Создать mock logger (массив записей). Передать в scanWorkspace. Проверить что logger НЕ вызывается на корректных файлах
  - Создать директорию без прав чтения (или несуществующий путь) → logger вызывается с `level: 'warn'` и именем директории
  - Создать unreadable файл (chmod 000 или бинарный .js) → logger вызывается с 'warn' и именем файла
  - scanWorkspace возвращает metrics: `{ durationMs > 0, fileCount > 0, skippedCount >= 0 }`

### Task 2: Добавить URI/path контекст к logged catches в server.ts
- [x] **Файл:** `server/src/server.ts`
- [x] **Изменения:**
  - Line 55 (Index error в debounced callback): добавить URI:
    ```ts
    this.connection.console.error(`Index error for "${uri}": ${e}`);
    ```
  - Line 59 (Parse error в onDidChangeContent): добавить URI:
    ```ts
    this.connection.console.error(`Parse error for "${uri}": ${e}`);
    ```
  - Line 81 (Workspace scan failed в onInitialize): добавить rootPath:
    ```ts
    this.connection.console.error(`Workspace scan failed for "${rootPath}": ${e}`);
    ```
  - В onInitialize: передать logger callback в scanWorkspace:
    ```ts
    const logger = (level: 'warn' | 'info', msg: string) => {
      this.connection.console[level](msg);
    };
    const metrics = this.workspace.scanWorkspace(rootPath, logger);
    this.connection.console.info(
      `Workspace scan: ${metrics.fileCount} files, ${metrics.skippedCount} skipped, ${metrics.durationMs.toFixed(0)}ms`
    );
    ```
  - Обновить existing log `"Workspace indexed: N symbols ..."` — оставить его (symbols count), добавить рядом timing log
- [x] **Тесты** (suite `'server: error logging context'`):
  - mock connection с перехватом console.error → вызвать parse error → verify error message содержит URI
  - То же для index error (debounced)
  - scanWorkspace warn → verify передаётся через logger callback в connection.console.warn

### Task 3: Метрики производительности
- [x] **Файл:** `server/src/server.ts`
- [x] **Изменения:**
  - `onInitialize`: добавить timing вокруг scanWorkspace (через metrics из Task 1):
    ```ts
    const metrics = this.workspace.scanWorkspace(rootPath, logger);
    // metrics уже содержит durationMs из Task 1
    ```
  - Log: `"Workspace scan: N files, M skipped, Xms"` (уже в Task 2)
  - В debounced indexDocument callback: добавить per-document timing:
    ```ts
    this.indexDebounceTimer = setTimeout(() => {
      const t0 = performance.now();
      try {
        this.workspace.indexDocument(uri, text, cachedAttrs ?? undefined);
        const elapsed = performance.now() - t0;
        if (elapsed > 50) {
          this.connection.console.info(
            `onDidChangeContent: indexed "${uri}" in ${elapsed.toFixed(0)}ms`
          );
        }
      } catch (e) {
        this.connection.console.error(`Index error for "${uri}": ${e}`);
      }
    }, 300);
    ```
  - Только логировать при elapsed > 50ms — не спамить лог при быстрых обновлениях
- [x] **Тесты** (suite `'server: performance metrics'`):
  - onInitialize логирует timing (durationMs > 0)
  - Debounced indexDocument при долгом парсинге (>50ms, мок) логирует timing
  - Быстрое парсинг (<50ms) НЕ логирует timing (не спамит)

## Commit Plan

3 задачи (< 5) — единый коммит:
```
feat(observability): context-aware error logging and performance metrics

- Replace silent catch blocks in scanWorkspace with warn logger callback
  (logs unreadable dirs/files with paths)
- Add URI/path context to all error catches in server.ts
- Add performance.now() timing around scanWorkspace and debounced
  indexDocument (logs only if >50ms)
- scanWorkspace returns metrics: { durationMs, fileCount, skippedCount }
- Regression tests for warn logging, context enrichment, metrics
```

## Проверка выполнения

- [x] `cd server && npm run build` — без ошибок TypeScript
- [x] `node test/test.js` — 168 тестов (156 существующих + 12 новых), 0 failed
- [x] Существующие тесты не сломаны (regression)
- [x] ROADMAP.md milestone отмечен `[x]`, добавлен в Completed таблицу
