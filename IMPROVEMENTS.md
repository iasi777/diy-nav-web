# diy-nav-web 改进建议

> 生成时间：2026-06-06  
> 基于评审版本：commit `84e6d448` + 未提交工作树  
> 优先级：🔴 高优先级 | 🟡 中优先级 | 🟢 低优先级

---

## 📋 目录

1. [部署前必须完成](#部署前必须完成)
2. [测试覆盖扩展](#测试覆盖扩展)
3. [AI 分类健壮性](#ai-分类健壮性)
4. [监控和可观测性](#监控和可观测性)
5. [用户体验改进](#用户体验改进)
6. [文档完善](#文档完善)
7. [安全加固](#安全加固)
8. [性能优化](#性能优化)

---

## 部署前必须完成

### 🔴 1. ARM64 原生构建验证

**问题**：

- 当前 Docker 无 Buildx，未执行 ARM64 交叉构建
- `better-sqlite3` 原生模块必须在目标架构上加载验证

**行动**：

```bash
# 在 ARM VPS 上执行
cd ~/projects/diy-nav-web
sh deploy/deploy.sh

# 验证架构
docker exec diy-nav-api node -e "console.log('Arch:', process.arch)"
# 预期输出：Arch: arm64

# 验证 SQLite 加载
docker exec diy-nav-api node -e "const db = require('better-sqlite3')('/data/diy-nav.sqlite'); console.log('SQLite OK')"
```

**验收标准**：

- 两个镜像成功构建
- API 容器显示 `arm64` 架构
- `better-sqlite3` 正常加载无报错

---

### 🔴 2. 真实 new-api 环境验证

**问题**：

- 当前未配置真实 AI 服务
- 模型列表、分类任务、失败重试未经过真实环境测试

**行动**：

```bash
# 1. 配置 .env
AI_NEW_API_BASE_URL=http://<tailscale-ip>:<port>/v1
AI_NEW_API_KEY=<your-key>
AI_DEFAULT_MODEL=gpt-4o-mini

# 2. 重启服务
docker compose -f deploy/docker-compose.yml restart api

# 3. 测试模型列表
curl http://100.87.23.114:8090/api/ai/models

# 4. 导入测试文件并启动 AI 分类
# 在浏览器中操作，观察任务进度和结果
```

**验收标准**：

- 模型列表返回非空数组
- 导入 10+ 书签后 AI 分类成功
- 检查 Docker 日志无 AI 相关错误

---

### 🔴 3. 防火墙和网络隔离验证

**问题**：
- Web 端口 `8090` 不应从公网访问
- 需要验证只有 Tailscale 网络可达

**行动**：
```bash
# 1. 在 VPS 上检查监听端口
ss -lnt | grep -E '(:8090|:8787)'
# 预期：只有 100.87.23.114:8090，没有 0.0.0.0:8090 或 0.0.0.0:8787

# 2. 配置防火墙（根据你的 VPS 类型选择）
# UFW 示例：
sudo ufw deny 8090/tcp
sudo ufw status

# 云安全组示例：
# 在云控制台中，拒绝入站规则 0.0.0.0/0 -> 8090

# 3. 从公网 IP 测试（应该超时或拒绝）
curl --connect-timeout 5 http://<vps-public-ip>:8090
# 预期：连接失败

# 4. 从 Tailscale 网络测试（应该成功）
curl http://100.87.23.114:8090/api/bookmarks
# 预期：返回 JSON 数组
```

**验收标准**：
- 公网无法访问 `8090`
- Tailscale 网络可正常访问
- `8787` 完全不暴露到宿主机

---

### 🔴 4. 数据持久化和重启测试

**问题**：
- 需要验证 Docker volume 持久化
- 需要验证 VPS 重启后服务自动恢复

**行动**：
```bash
# 1. 添加测试书签
curl -X POST http://100.87.23.114:8090/api/bookmarks \
  -H "Content-Type: application/json" \
  -d '{"title":"测试书签","url":"https://test.example.com","categoryId":"<id>"}'

# 2. 停止容器
docker compose -f deploy/docker-compose.yml down

# 3. 再次启动
docker compose -f deploy/docker-compose.yml up -d

# 4. 验证数据仍然存在
curl http://100.87.23.114:8090/api/bookmarks | grep "测试书签"

# 5. 重启 VPS
sudo reboot

# 6. VPS 启动后检查服务
docker compose -f deploy/docker-compose.yml ps
curl http://100.87.23.114:8090/api/bookmarks
```

**验收标准**：
- 容器重启后数据保留
- VPS 重启后服务自动启动（`restart: unless-stopped`）
- SQLite 数据完整，无损坏

---

### 🔴 5. Git 仓库整理

**问题**：
- 143 个修改文件 + 19 个未跟踪文件未提交
- 尚未创建个人 fork

**行动**：
```bash
cd ~/projects/diy-nav-web

# 1. 在 GitHub 上 fork slightlee/diy-nav-web

# 2. 添加个人 fork 为远程仓库
git remote add fork https://github.com/<your-username>/diy-nav-web.git

# 3. 创建功能分支
git checkout -b feature/sqlite-center-library

# 4. 提交所有改动
git add .
git commit -m "feat: 转换为 SQLite 中心库单用户架构

- 移除 localStorage、D1/R2、OAuth 认证
- 添加 SQLite WAL 模式中心库
- 添加版本冲突检测（409 响应）
- 添加 HTML/JSON 导入和 AI 分类工作流
- 添加备份/恢复脚本和 systemd timer
- API 切换到 Debian slim 支持原生 SQLite
- Web 仅绑定 Tailscale IP，API 端口内部化
- 基于上游 commit 84e6d448"

# 5. 推送到个人仓库
git push fork feature/sqlite-center-library

# 6. 打标签
git tag -a v1.0.0-private -m "私有书签中心首个可部署版本"
git push fork v1.0.0-private
```

**验收标准**：
- 个人 fork 创建成功
- 所有改动已提交并推送
- 打上版本标签便于回滚

---

## 测试覆盖扩展

### 🟡 6. 并发版本冲突测试

**问题**：
- 当前测试仅覆盖单客户端版本冲突
- 多设备同时写入场景未测试

**建议新增测试**：
```typescript
// apps/api/src/routes/library.integration.spec.ts

it('handles concurrent updates with version conflicts', async () => {
  // 1. 创建书签
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/bookmarks',
    payload: { title: 'Test', url: 'https://test.com', categoryId: '<id>' }
  })
  const bookmark = JSON.parse(createRes.body)

  // 2. 设备 A 和设备 B 同时读取
  const deviceA = { ...bookmark, title: 'Updated by A' }
  const deviceB = { ...bookmark, title: 'Updated by B' }

  // 3. 设备 A 先提交（成功）
  const resA = await app.inject({
    method: 'PATCH',
    url: `/api/bookmarks/${bookmark.id}`,
    payload: deviceA
  })
  expect(resA.statusCode).toBe(200)

  // 4. 设备 B 后提交（版本冲突）
  const resB = await app.inject({
    method: 'PATCH',
    url: `/api/bookmarks/${bookmark.id}`,
    payload: deviceB
  })
  expect(resB.statusCode).toBe(409)
  expect(JSON.parse(resB.body).code).toBe('VERSION_CONFLICT')
})
```

---

### 🟡 7. AI 分类任务恢复测试

**问题**：
- 任务持久化和重启恢复逻辑未测试

**建议新增测试**：
```typescript
// apps/api/src/routes/imports.integration.spec.ts

it('resumes classification after server restart', async () => {
  // 1. 上传文件并启动分类
  const uploadRes = await app.inject({
    method: 'POST',
    url: '/api/imports',
    payload: { filename: 'test.html', content: '<html>...</html>' }
  })
  const importId = JSON.parse(uploadRes.body).id

  await app.inject({
    method: 'POST',
    url: `/api/imports/${importId}/classify`,
    payload: { model: 'mock-model' }
  })

  // 2. 模拟重启（关闭并重建 app）
  await app.close()
  const { buildApp } = await import('../../server.js')
  app = await buildApp()

  // 3. 检查任务状态（应该恢复或标记为失败）
  const statusRes = await app.inject({
    method: 'GET',
    url: `/api/imports/${importId}`
  })
  const status = JSON.parse(statusRes.body)
  expect(['classifying', 'classified', 'failed']).toContain(status.state)
})
```

---

### 🟡 8. 备份脚本错误处理测试

**问题**：
- 备份脚本缺少错误处理测试
- SQLite 损坏、磁盘满等场景未覆盖

**建议新增测试**：
```typescript
// apps/api/src/scripts/backup.spec.ts

it('aborts backup when SQLite integrity check fails', async () => {
  // 模拟损坏的数据库
  const corruptDb = new Database(':memory:')
  // 手动破坏数据库文件
  
  await expect(backupDatabase(corruptDb)).rejects.toThrow('integrity check failed')
})

it('handles insufficient disk space', async () => {
  // 模拟磁盘空间不足
  // 预期：清理旧备份后重试，或明确报错
})

it('preserves exactly 12 backup sets', async () => {
  // 创建 15 组备份
  // 验证只保留最近 12 组
})
```

---

## AI 分类健壮性

### 🟡 9. 指数退避重试机制

**问题**：
- 当前 new-api 失败时任务会停滞
- 网络抖动或模型临时不可用会导致任务失败

**改进方案**：
```typescript
// apps/api/src/lib/ai-gateway.ts

async function gatewayFetchWithRetry(
  path: string,
  init: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await gatewayFetch(path, init)
      if (response.ok || response.status === 400) {
        return response // 成功或明确的客户端错误（不重试）
      }
      
      if (response.status >= 500 && attempt < maxRetries) {
        // 服务端错误，指数退避
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000)
        await new Promise(resolve => setTimeout(resolve, delayMs))
        continue
      }
      
      return response
    } catch (error) {
      lastError = error as Error
      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }
  
  throw lastError!
}
```

**配置建议**：
- 最大重试 3 次
- 延迟：1s → 2s → 4s
- 记录重试日志便于排查

---

### 🟡 10. 超时和失败处理

**问题**：
- AI 分类任务可能长时间运行
- 用户无法手动取消或重试失败任务

**改进方案**：
```typescript
// 1. 添加任务超时（例如 5 分钟）
async function runClassification(batchId: string): Promise<void> {
  const timeoutMs = 5 * 60 * 1000
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Classification timeout')), timeoutMs)
  })
  
  try {
    await Promise.race([classifyWithRetry(batchId), timeoutPromise])
  } catch (error) {
    // 标记为失败，保留错误信息
    db.prepare('UPDATE import_batches SET state = ?, error = ? WHERE id = ?')
      .run('failed', error.message, batchId)
  }
}

// 2. 添加重试端点
app.post('/api/imports/:id/retry', async (request, reply) => {
  const { id } = request.params
  const batch = readBatch(id)
  
  if (!batch || batch.state !== 'failed') {
    return reply.code(400).send({ error: 'Cannot retry non-failed batch' })
  }
  
  // 重置状态并重新入队
  db.prepare('UPDATE import_batches SET state = ?, error = NULL WHERE id = ?')
    .run('pending', id)
  queueClassification(id)
  
  return { success: true }
})
```

---

### 🟡 11. 部分成功处理

**问题**：
- 当前 100 条书签中 1 条失败会导致整个任务失败
- 已分类的条目无法部分提交

**改进方案**：
```typescript
// 逐条分类并记录失败
async function classifyWithPartialSuccess(batchId: string) {
  const items = readItems(batchId)
  let successCount = 0
  let failCount = 0
  
  for (const item of items) {
    try {
      const result = await classifyBookmarks([item], ...)
      // 更新单条记录
      db.prepare('UPDATE import_items SET ai_category = ?, ai_tags = ?, ai_description = ? WHERE id = ?')
        .run(result.category, JSON.stringify(result.tags), result.description, item.id)
      successCount++
    } catch (error) {
      // 标记单条失败，继续处理其他条目
      db.prepare('UPDATE import_items SET ai_error = ? WHERE id = ?')
        .run(error.message, item.id)
      failCount++
    }
  }
  
  // 更新批次状态
  const finalState = failCount === 0 ? 'classified' : 'partially_classified'
  db.prepare('UPDATE import_batches SET state = ?, ai_success = ?, ai_failed = ? WHERE id = ?')
    .run(finalState, successCount, failCount, batchId)
}
```

---

## 监控和可观测性

### 🟢 12. 添加 Metrics 端点

**问题**：
- 缺少运行时指标，难以发现性能问题
- 无法监控书签增长、导入频率、AI 使用情况

**改进方案**：
```typescript
// apps/api/src/routes/metrics.ts

export default async function metricsRoutes(app: FastifyInstance) {
  app.get('/api/metrics', async (request, reply) => {
    const db = getDatabase()
    
    const stats = {
      timestamp: new Date().toISOString(),
      bookmarks: {
        total: db.prepare('SELECT COUNT(*) as count FROM bookmarks').get().count,
        byCategory: db.prepare('SELECT c.name, COUNT(b.id) as count FROM categories c LEFT JOIN bookmarks b ON b.category_id = c.id GROUP BY c.id').all()
      },
      imports: {
        total: db.prepare('SELECT COUNT(*) as count FROM import_batches').get().count,
        pending: db.prepare('SELECT COUNT(*) as count FROM import_batches WHERE state = ?').get('pending').count,
        classifying: db.prepare('SELECT COUNT(*) as count FROM import_batches WHERE state = ?').get('classifying').count,
        failed: db.prepare('SELECT COUNT(*) as count FROM import_batches WHERE state = ?').get('failed').count
      },
      database: {
        sizeBytes: db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get().size,
        walMode: db.pragma('journal_mode', { simple: true }),
        foreignKeys: db.pragma('foreign_keys', { simple: true })
      },
      uptime: process.uptime()
    }
    
    return stats
  })
}
```

**使用场景**：
- 定期抓取 metrics 发送到监控系统
- 手动检查系统健康状态
- 排查性能问题时的快照数据

---

### 🟢 13. 结构化日志

**问题**：
- 当前日志缺少结构化字段
- 难以过滤、聚合、告警

**改进方案**：
```typescript
// apps/api/src/lib/logger.ts (假设使用 pino)

import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: pino.stdTimeFunctions.isoTime
})

// 使用示例
logger.info({ 
  action: 'bookmark_created',
  bookmarkId: id,
  userId: 'single-user',
  categoryId: categoryId
}, 'Bookmark created')

logger.error({
  action: 'ai_classification_failed',
  batchId: batchId,
  error: error.message,
  retryAttempt: attempt
}, 'AI classification failed')
```

**配置 Docker 日志驱动**：
```yaml
# deploy/docker-compose.yml

services:
  api:
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: '3'
        labels: "service=diy-nav-api"
        tag: "{{.Name}}/{{.ID}}"
```

---

## 文档完善

### 🟢 18. 添加架构图

**建议在 README.md 中添加架构图**：

```
## 架构

### 网络拓扑
┌─────────────────────────────────────────────────┐
│            Tailscale 网络 (可信边界)              │
│                                                 │
│  ┌──────────┐         ┌──────────────────────┐ │
│  │  浏览器   │────────>│  ARM VPS             │ │
│  │  (设备1)  │         │  100.87.23.114:8090  │ │
│  └──────────┘         │                      │ │
│                       │  ┌────────────────┐  │ │
│  ┌──────────┐         │  │  diy-nav-web   │  │ │
│  │  (设备2)  │────────>│  │   (nginx:80)   │  │ │
│  └──────────┘         │  └────────┬───────┘  │ │
│                       │           │ /api/*   │ │
│                       │           v          │ │
│                       │  ┌────────────────┐  │ │
│                       │  │  diy-nav-api   │  │ │
│                       │  │  (node:8787)   │  │ │
│                       │  └────────┬───────┘  │ │
│                       │           v          │ │
│                       │  ┌────────────────┐  │ │
│                       │  │ SQLite + WAL   │  │ │
│                       │  └────────────────┘  │ │
│                       └──────────────────────┘ │
└─────────────────────────────────────────────────┘
          X  公网隔离（防火墙拒绝）
```

---

### 🟢 19. 添加故障恢复手册

**建议创建 TROUBLESHOOTING.md**：

```markdown
# 故障恢复手册

## SQLite 数据库损坏

### 症状
- API 启动失败，日志显示 "database disk image is malformed"
- 查询返回 500 错误

### 诊断
docker exec diy-nav-api node -e "
  const db = require('better-sqlite3')('/data/diy-nav.sqlite');
  console.log(db.pragma('integrity_check'));
"

### 修复
# 1. 停止服务
docker compose -f deploy/docker-compose.yml stop api

# 2. 从最近备份恢复
sh deploy/restore.sh /backups/diy-nav-YYYYMMDD-HHMMSS.sqlite

# 3. 如果所有备份都损坏，导出可读取的数据
docker exec diy-nav-api sqlite3 /data/diy-nav.sqlite ".recover" > recovered.sql

## 备份文件丢失

### 症状
- /backups 目录为空
- 恢复脚本找不到备份文件

### 诊断
docker exec diy-nav-api ls -lh /backups/

### 修复
# 1. 检查本地同步副本
ls ~/diy-nav-backups/

# 2. 如果本地有备份，上传到容器
docker cp ~/diy-nav-backups/diy-nav-YYYYMMDD-HHMMSS.sqlite \
  diy-nav-api:/backups/

# 3. 恢复
sh deploy/restore.sh /backups/diy-nav-YYYYMMDD-HHMMSS.sqlite

## 容器无法启动

### 症状
- docker compose up 失败
- 容器状态为 Restarting

### 诊断
docker compose -f deploy/docker-compose.yml logs api --tail 50

### 常见原因
1. 端口冲突：ss -lnt | grep 8090
2. Volume 权限：docker volume inspect diy-nav-data
3. 环境变量缺失：docker compose config

## AI 分类卡住

### 症状
- 导入任务状态一直是 classifying
- 等待 10 分钟仍无进度

### 诊断
# 检查 API 日志
docker compose -f deploy/docker-compose.yml logs api | grep -i "classif"

# 检查 new-api 连通性
docker exec diy-nav-api curl -v $AI_NEW_API_BASE_URL/models

### 修复
# 1. 重启 API 触发任务恢复
docker compose -f deploy/docker-compose.yml restart api

# 2. 如果仍卡住，手动重置任务状态（慎用）
docker exec diy-nav-api node -e "
  const db = require('better-sqlite3')('/data/diy-nav.sqlite');
  db.prepare('UPDATE import_batches SET state = ? WHERE state = ?')
    .run('failed', 'classifying');
"
```

---

### 🟢 20. 添加性能调优指南

**建议在 README.md 添加性能优化章节**：

```markdown
## 性能优化

### SQLite 调优
# 当书签数量超过 10,000 条时，考虑调整 cache_size
docker exec diy-nav-api node -e "
  const db = require('better-sqlite3')('/data/diy-nav.sqlite');
  db.pragma('cache_size = -64000'); // 64MB 缓存
"

# 定期执行 VACUUM 回收空间（需要停机）
docker compose -f deploy/docker-compose.yml stop api
docker exec diy-nav-api node -e "
  const db = require('better-sqlite3')('/data/diy-nav.sqlite');
  db.exec('VACUUM');
"
docker compose -f deploy/docker-compose.yml start api

### Nginx 静态资源缓存
# 修改 apps/web/nginx.conf，添加缓存头
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}

### 导入大文件优化
# 对于超过 1000 条书签的导入，分批处理
# 前端限制单次上传 <= 500 条
# 或者后端自动分割为多个批次
```

---

## 安全加固

### 🟡 21. 添加请求速率限制

**问题**：
- 当前 API 无速率限制
- 恶意客户端可能导致资源耗尽

**改进方案**：
```typescript
// apps/api/server.ts

import rateLimit from '@fastify/rate-limit'

app.register(rateLimit, {
  max: 100, // 每分钟最多 100 请求
  timeWindow: '1 minute',
  cache: 10000,
  allowList: ['127.0.0.1'], // 本地健康检查不限速
  redis: undefined, // 单实例使用内存，多实例考虑 Redis
  skipOnError: true, // 限速器故障时不阻塞请求
  keyGenerator: (request) => {
    // 使用 Tailscale IP 作为限速 key
    return request.headers['x-forwarded-for'] || request.ip
  }
})

// 针对 AI 端点更严格限制
app.register(rateLimit, {
  max: 10,
  timeWindow: '1 minute'
}, (instance) => {
  instance.post('/api/imports/:id/classify', classifyHandler)
})
```

---

### 🟡 22. 输入验证加强

**问题**：
- URL 验证可能不完整
- 分类/标签名称未限制特殊字符

**改进方案**：
```typescript
// apps/api/src/lib/dto.ts

import { z } from 'zod'

const urlSchema = z.string()
  .url()
  .refine((url) => {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  }, 'Only HTTP/HTTPS allowed')
  .refine((url) => {
    return url.length <= 2048
  }, 'URL too long')

const nameSchema = z.string()
  .min(1)
  .max(50)
  .regex(/^[\w\s\-\u4e00-\u9fa5]+$/, 'Invalid characters in name')

export const createBookmarkSchema = z.object({
  title: z.string().min(1).max(200),
  url: urlSchema,
  categoryId: z.string().uuid(),
  description: z.string().max(500).optional(),
  tagIds: z.array(z.string().uuid()).max(10).optional()
})

export const createCategorySchema = z.object({
  name: nameSchema,
  description: z.string().max(200).optional()
})
```

---

### 🟢 23. 环境变量校验

**问题**：
- 缺少 AI 配置时静默失败
- 无效的 DATABASE_PATH 可能导致启动异常

**改进方案**：
```typescript
// apps/api/src/lib/config-validator.ts

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.string().regex(/^\d+$/).transform(Number),
  DATABASE_PATH: z.string().min(1),
  BACKUP_DIR: z.string().min(1),
  AI_NEW_API_BASE_URL: z.string().url().optional(),
  AI_NEW_API_KEY: z.string().min(1).optional(),
  AI_DEFAULT_MODEL: z.string().optional()
})

export function validateEnv(): void {
  const result = envSchema.safeParse(process.env)
  
  if (!result.success) {
    console.error('Environment validation failed:')
    console.error(result.error.format())
    process.exit(1)
  }
  
  // 警告：AI 未配置
  if (!result.data.AI_NEW_API_BASE_URL) {
    console.warn('⚠️  AI_NEW_API_BASE_URL not configured. AI features disabled.')
  }
}

// 在 server.ts 中调用
validateEnv()
```

---

## 性能优化

### 🟢 24. 添加数据库索引

**问题**：
- 大量书签时查询可能变慢
- 缺少常用查询的索引

**改进方案**：
```typescript
// apps/api/src/lib/sqlite.ts - 在 migrate() 中添加

export function migrate(db: SqliteDatabase): void {
  // ... 现有迁移 ...
  
  // 添加索引以优化常见查询
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookmarks_category 
      ON bookmarks(category_id);
    
    CREATE INDEX IF NOT EXISTS idx_bookmarks_updated 
      ON bookmarks(updated_at DESC);
    
    CREATE INDEX IF NOT EXISTS idx_bookmarks_deleted 
      ON bookmarks(deleted_at) 
      WHERE deleted_at IS NOT NULL;
    
    CREATE INDEX IF NOT EXISTS idx_bookmark_tags_bookmark 
      ON bookmark_tags(bookmark_id);
    
    CREATE INDEX IF NOT EXISTS idx_bookmark_tags_tag 
      ON bookmark_tags(tag_id);
    
    CREATE INDEX IF NOT EXISTS idx_import_items_batch 
      ON import_items(batch_id);
    
    CREATE INDEX IF NOT EXISTS idx_import_items_state 
      ON import_items(batch_id, state);
  `)
}
```

---

### 🟢 25. 分页查询

**问题**：
- 当前 `/api/bookmarks` 一次返回所有书签
- 大量书签时前端渲染慢，网络传输大

**改进方案**：
```typescript
// apps/api/src/routes/library.ts

app.get('/api/bookmarks', {
  schema: {
    querystring: z.object({
      page: z.string().regex(/^\d+$/).transform(Number).optional(),
      pageSize: z.string().regex(/^\d+$/).transform(Number).optional(),
      categoryId: z.string().uuid().optional(),
      tagId: z.string().uuid().optional(),
      search: z.string().max(100).optional()
    })
  }
}, async (request, reply) => {
  const { page = 1, pageSize = 50, categoryId, tagId, search } = request.query
  
  const offset = (page - 1) * pageSize
  const limit = Math.min(pageSize, 100) // 最大 100 条
  
  let sql = 'SELECT * FROM bookmarks WHERE deleted_at IS NULL'
  const params: any[] = []
  
  if (categoryId) {
    sql += ' AND category_id = ?'
    params.push(categoryId)
  }
  
  if (search) {
    sql += ' AND (title LIKE ? OR url LIKE ?)'
    params.push(`%${search}%`, `%${search}%`)
  }
  
  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)
  
  const bookmarks = db.prepare(sql).all(...params)
  const total = db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE deleted_at IS NULL').get().count
  
  return {
    data: bookmarks.map(mapBookmarkRow),
    pagination: {
      page,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  }
})
```

---

### 🟢 26. 前端虚拟滚动

**问题**：
- 渲染 1000+ 书签卡片导致页面卡顿
- DOM 节点过多影响性能

**改进方案**：
```vue
<!-- apps/web/src/components/BookmarkList.vue -->

<template>
  <RecycleScroller
    class="bookmark-scroller"
    :items="bookmarks"
    :item-size="120"
    key-field="id"
    v-slot="{ item }"
  >
    <BookmarkCard :bookmark="item" />
  </RecycleScroller>
</template>

<script setup lang="ts">
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'

// 安装依赖
// pnpm add vue-virtual-scroller
</script>
```

**或者使用分页加载**：
```typescript
// 前端分页，配合后端分页 API
const currentPage = ref(1)
const bookmarks = ref<Bookmark[]>([])

async function loadMore() {
  currentPage.value++
  const response = await fetch(`/api/bookmarks?page=${currentPage.value}`)
  const data = await response.json()
  bookmarks.value.push(...data.data)
}
```

---

## 优先级总结

### 🔴 部署前必须完成（1-5）
1. ARM64 原生构建验证
2. 真实 new-api 环境验证
3. 防火墙和网络隔离验证
4. 数据持久化和重启测试
5. Git 仓库整理

**预计时间**：2-3 小时  
**阻塞风险**：高（未完成则无法安全部署）

---

### 🟡 近期改进建议（6-11）
6. 并发版本冲突测试
7. AI 分类任务恢复测试
8. 备份脚本错误处理测试
9. 指数退避重试机制
10. 超时和失败处理
11. 部分成功处理

**预计时间**：4-6 小时  
**收益**：提升系统健壮性，减少生产故障

---

### 🟢 长期优化项（12-26）
12. 添加 Metrics 端点
13. 结构化日志
14. 备份成功/失败通知
15. 多设备冲突友好提示
16. 导入进度实时反馈
17. 批量操作撤销功能
18. 添加架构图
19. 添加故障恢复手册
20. 添加性能调优指南
21. 添加请求速率限制
22. 输入验证加强
23. 环境变量校验
24. 添加数据库索引
25. 分页查询
26. 前端虚拟滚动

**预计时间**：8-12 小时  
**收益**：提升用户体验、可维护性、性能

---

## 实施建议

### 第一阶段：部署验收（本周）
- 完成所有 🔴 高优先级项
- 在真实环境运行 1 周，观察稳定性
- 记录实际遇到的问题到 Obsidian 踩坑.md

### 第二阶段：健壮性加固（2 周内）
- 完成测试覆盖扩展（6-8）
- 实现 AI 重试机制（9-11）
- 添加日志和监控（12-14）

### 第三阶段：体验优化（按需）
- 根据实际使用痛点，选择性实现 15-26
- 优先处理用户反馈最多的问题
- 性能优化在书签数量 > 1000 后再考虑

---

## 验收清单

完成改进后，使用此清单验证：

- [ ] ARM VPS 上成功构建并运行
- [ ] 真实 new-api 分类任务完成
- [ ] 公网无法访问 `8090` 端口
- [ ] VPS 重启后服务自动恢复
- [ ] 所有改动已提交到个人 fork
- [ ] 测试覆盖 > 80%（可选）
- [ ] AI 分类失败会自动重试
- [ ] 备份失败发送通知
- [ ] 文档包含架构图和故障手册

---

## 参考资料

- [SQLite Performance Tuning](https://www.sqlite.org/speed.html)
- [Fastify Best Practices](https://www.fastify.io/docs/latest/Guides/Getting-Started/)
- [Vue Virtual Scroller](https://github.com/Akryum/vue-virtual-scroller)
- [Docker Compose Best Practices](https://docs.docker.com/compose/production/)
- [Tailscale ACL](https://tailscale.com/kb/1018/acls/)

---

**文档生成时间**：2026-06-06  
**下次评审建议**：部署到生产 1 周后  
**维护者**：记得更新 Obsidian vault 的进度和踩坑记录
