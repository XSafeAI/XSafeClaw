# XSafeClaw 发布指南

## 前置条件

- Python >= 3.11，已安装 `uv`
- Node.js >= 18，已安装 `npm`
- PyPI API Token（在 https://pypi.org/manage/account/token/ 创建）

## 完整发布流程

### 1. 更新版本号

编辑 `pyproject.toml`，修改 `version` 字段：

```toml
version = "x.y.z"
```

### 2. 构建前端

```bash
cd frontend
npm install
npm run build
cd ..
```

构建产物会输出到 `src/xsafeclaw/static/`，随 Python 包一起分发。

### 3. 排除大文件

`src/xsafeclaw/static/` 中的 `Map/` 和 `music/` 目录体积较大，需要在 `pyproject.toml` 中排除以满足 PyPI 100MB 限制：

```toml
[tool.hatch.build.targets.wheel]
packages = ["src/xsafeclaw"]
exclude = ["src/xsafeclaw/static/Map", "src/xsafeclaw/static/music"]

[tool.hatch.build.targets.sdist]
exclude = ["src/xsafeclaw/static/Map", "src/xsafeclaw/static/music"]
```

### 4. 安装构建工具

```bash
uv pip install build twine
```

### 5. 清理旧构建产物

```bash
rm -rf dist/
```

### 6. 构建 Python 包

```bash
uv run python -m build
```

构建完成后确认文件大小低于 100MB：

```bash
ls -lh dist/
```

预期产物：
- `xsafeclaw-x.y.z-py3-none-any.whl`（wheel）
- `xsafeclaw-x.y.z.tar.gz`（sdist）

### 7. 上传到 PyPI

```bash
uv run twine upload dist/* -u __token__ -p <YOUR_PYPI_API_TOKEN>
```

将 `<YOUR_PYPI_API_TOKEN>` 替换为你的 Token（以 `pypi-` 开头）。

上传成功后可在 https://pypi.org/project/xsafeclaw/ 查看。

### 8. 验证安装

```bash
pip install xsafeclaw==x.y.z
```

## 快速命令（一键复制）

```bash
# 完整发布流程（替换版本号和 Token）
cd frontend && npm install && npm run build && cd .. \
  && rm -rf dist/ \
  && uv run python -m build \
  && ls -lh dist/ \
  && uv run twine upload dist/* -u __token__ -p <YOUR_PYPI_API_TOKEN>
```
