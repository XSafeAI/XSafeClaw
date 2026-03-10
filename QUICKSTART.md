# SafetyAgent 快速开始

## 🚀 启动应用

### 1. 启动PostgreSQL（如果还没启动）

```bash
cd /data/data-pool/dingyifan/SafetyAgent
sudo docker-compose up -d postgres

# 检查状态
sudo docker-compose ps
```

### 2. 初始化数据库

```bash
source .venv/bin/activate
python scripts/init_db.py
```

### 3. 启动应用

```bash
# 方法1：使用run.py脚本
python run.py

# 方法2：作为模块运行
python -m sas

# 方法3：使用uvicorn直接运行
uvicorn sas.api.main:app --host 0.0.0.0 --port 6874 --reload
```

### 4. 访问API

- **API文档**: http://localhost:6874/docs
- **健康检查**: http://localhost:6874/health
- **根端点**: http://localhost:6874/

## 📡 API接口

### Sessions（会话管理）

- `GET /api/sessions/` - 列出所有会话
- `GET /api/sessions/{session_id}` - 获取会话详情
- `DELETE /api/sessions/{session_id}` - 删除会话

### Runs（运行记录）

- `GET /api/runs/` - 列出所有运行记录
- `GET /api/runs/?session_id={id}` - 按会话过滤
- `GET /api/runs/{run_id}` - 获取运行详情
- `GET /api/runs/{run_id}/tool-calls` - 获取工具调用记录

### Stats（统计信息）

- `GET /api/stats/overview` - 总体统计
- `GET /api/stats/by-model` - 按模型统计
- `GET /api/stats/daily?days=7` - 每日统计

## 🔧 配置

编辑 `.env` 文件：

```bash
# 数据库连接
DATABASE_URL=postgresql+asyncpg://sas:safetyagent_password@localhost:5434/sas

# OpenClaw会话目录
OPENCLAW_SESSIONS_DIR=~/.openclaw/agents/main/sessions

# API设置
API_HOST=0.0.0.0
API_PORT=6874
API_RELOAD=true

# 日志级别
LOG_LEVEL=INFO

# 文件监听
ENABLE_FILE_WATCHER=true
FULL_SCAN_INTERVAL_HOURS=1
```

## 🛠️ 数据库管理

### 查看数据库

```bash
# 连接PostgreSQL
docker exec -it safetyagent-postgres psql -U sas -d sas

# 常用SQL命令
\dt                           # 列出所有表
SELECT * FROM sessions;       # 查看会话
SELECT * FROM runs;           # 查看运行记录
SELECT * FROM tool_calls;     # 查看工具调用
\q                            # 退出
```

### 备份/恢复

```bash
# 备份
docker exec safetyagent-postgres pg_dump -U sas sas > backup.sql

# 恢复
cat backup.sql | docker exec -i safetyagent-postgres psql -U sas -d sas
```

## 📊 监控

应用会自动：
1. ✅ 监听 `~/.openclaw/agents/main/sessions/` 目录下的 `.jsonl` 文件
2. ✅ 解析会话事件（用户消息、助手回复、模型变更等）
3. ✅ 将数据存入PostgreSQL数据库
4. ✅ 通过FastAPI提供REST API访问

## 🐛 调试

```bash
# 查看应用日志
LOG_LEVEL=DEBUG python run.py

# 检查数据库连接
python scripts/init_db.py

# 手动同步现有文件
# TODO: 创建 scripts/import_existing.py
```

## 📦 依赖更新

```bash
# 使用清华镜像源
uv sync --index-url https://pypi.tuna.tsinghua.edu.cn/simple

# 添加新依赖
uv add package-name --index-url https://pypi.tuna.tsinghua.edu.cn/simple
```
