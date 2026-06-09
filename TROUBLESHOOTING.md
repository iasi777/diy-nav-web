# 故障恢复手册

部署步骤和完整配置以 [README.md](README.md) 为准。以下内容只处理运行故障。

## API 无法启动

先查看状态和最近日志：

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs api --tail 100
```

常见原因：

- `.env` 中 new-api 地址和 Key 只配置了其中一项。
- `diy-nav-data` volume 权限异常。
- SQLite 文件损坏或磁盘空间耗尽。

## SQLite 完整性异常

诊断：

```bash
docker exec diy-nav-api node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/diy-nav.sqlite', { readonly: true });
console.log(db.pragma('integrity_check'));
"
```

如果结果不是 `ok`，从最近快照恢复：

```bash
docker exec diy-nav-api ls -1 /backups/'diy-nav-'*.sqlite
sh deploy/restore.sh /backups/diy-nav-<timestamp>.sqlite
```

恢复脚本会在替换前后执行完整性检查并输出书签、分类和标签数量。

## 服务器备份丢失

先检查 Docker volume：

```bash
docker exec diy-nav-api ls -lh /backups
```

再检查本地同步副本，默认位置为 `~/backups/diy-nav`。找到快照后复制回容器：

```bash
docker cp ~/backups/diy-nav/diy-nav-<timestamp>.sqlite diy-nav-api:/backups/
sh deploy/restore.sh /backups/diy-nav-<timestamp>.sqlite
```

## AI 分类失败或部分失败

查看批次错误和结构化日志：

```bash
docker compose -f deploy/docker-compose.yml logs api --tail 200 | grep -i ai_
curl http://100.87.23.114:8090/api/metrics
```

系统会自动重试网络错误、`408`、`429` 和 `5xx`。一个分块失败不会阻止后续分块；失败条目会保留为 `error`，可在界面更换模型后再次分类。

如果任务因 API 重启停在 `queued` 或 `classifying`，启动时会自动恢复。超过数分钟仍无变化时，检查 new-api 连通性和容器日志，不要直接修改 SQLite 状态。

## Web 可访问但 API 返回 502

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml exec web wget -qO- http://api:8787/readyz
```

API 必须通过 `/readyz` 后 Web 才能正常代理 `/api/*`。宿主机不应监听 `8787`。

## 公网意外可访问

```bash
ss -lnt | grep -E '(:8090|:8787)'
docker compose -f deploy/docker-compose.yml config
```

正常情况只有 Tailscale IP `100.87.23.114:8090`，没有 `0.0.0.0:8090` 或宿主机 `8787`。同时检查云安全组和防火墙，不能仅依赖应用配置。
