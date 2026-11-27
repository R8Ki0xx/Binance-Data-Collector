# <img src="frontend/public/logo.svg" width="36" height="36" alt="" align="top"> QuantPilot

[English](./README.md) | **简体中文**

自行部署的加密货币永续合约 AI 交易平台，支持 **Hyperliquid** 和**币安合约**：大模型交易员与规则程序、市场资金流信号、因子库，以及帮你完成配置的对话助手。

QuantPilot 是 [Hyper Alpha Arena](https://github.com/HammerGPT/Hyper-Alpha-Arena) 的修改版，独立维护，与原作者没有从属或合作关系。详见[署名与许可](#署名与许可)。

> **风险提示：** 本软件可以用真实资金下单。自动交易和 AI 决策可能让你亏掉全部本金。请先在测试网使用。本项目不构成任何投资建议。

![因子库（深色模式）](screenshots/factors-dark.png)

| AI 交易员（浅色模式） | Pilot AI 助手（深色模式） |
|---|---|
| ![AI 交易员](screenshots/traders-light.png) | ![助手](screenshots/assistant-dark.png) |

## 功能

- **AI 交易员**：用提示词描述策略，由大模型决策，支持 OpenAI 兼容接口和 Anthropic 格式。
- **程序化交易**：用 Python 编写策略，先回测再运行。
- **信号系统**：按订单流、持仓量、资金费率和因子条件触发交易员。
- **因子库**：内置因子与自定义因子，附带有效性评分。
- **归因分析**：按交易对、触发方式和因子拆解收益表现。
- **Pilot AI**：能查看系统状态、创建资源的对话助手，也可以接入 Telegram 和 Discord 机器人。
- **界面**：中英文切换，深色与浅色模式。

## 快速开始（Docker）

需要安装 Docker 和 Compose。

```bash
docker compose up -d --build
```

打开 <http://localhost:8802>，在应用内填写大模型 API 密钥和交易所钱包。

Compose 默认只在 `127.0.0.1` 上开放端口，不要把它们暴露到公网。

## 本地开发

需要 Node.js 18 以上、[pnpm](https://pnpm.io) 8、[uv](https://docs.astral.sh/uv/)、Python 3.12 以上和 PostgreSQL。

```bash
pnpm install
cd backend && uv sync && cd ..
export DATABASE_URL=postgresql://user:password@localhost:5432/alpha_arena
export SNAPSHOT_DATABASE_URL=postgresql://user:password@localhost:5432/alpha_snapshots
export HYPERLIQUID_ENCRYPTION_KEY=...   # 一个 Fernet 密钥
pnpm dev                                # 接口在 5611 端口，网页在 8802 端口
```

项目固定使用的 `pandas-ta` 版本在原生 Windows 上无法导入，请用 Docker 或 WSL 运行后端。

运行后端测试（不需要网络和 PostgreSQL）：

```bash
cd backend
uv run python -m unittest discover -s tests
```

## 配置项

| 环境变量 | 作用 | 默认值 |
|---|---|---|
| `DATABASE_URL`、`SNAPSHOT_DATABASE_URL` | PostgreSQL 连接 | Compose 自动设置 |
| `HYPERLIQUID_ENCRYPTION_KEY` | 加密保存的钱包密钥 | Docker 自动生成 |
| `FACTOR_ENGINE_ENABLED` | 定时计算因子 | Compose 中为 `true` |
| `HYPERLIQUID_BUILDER_ADDRESS`、`HYPERLIQUID_BUILDER_FEE` | 对主网订单收取你自己的 builder fee | 关闭 |
| `BINANCE_BROKER_ID` | 你的经纪商 ID；设置后启用返佣检查和每日额度 | 关闭 |

查看数据采集状态：`GET /api/binance/collector/status`。

## 与原项目的区别

- 修复币安数据采集：改用现行 WebSocket 地址，持仓量与标记价合并存储，不再重复累计；新增缺口补齐、限流处理和状态接口。
- 默认不收 builder fee，不带 broker ID 和邀请链接，需要时自行配置。
- 去掉登录和会员功能。依赖原项目托管服务的功能（Strategy Radar、Hyper Insight 钱包跟踪）不可用。
- 重做界面外壳，新增深色模式。

## 署名与许可

基于 Heliki AI Community 的 [Hyper Alpha Arena](https://github.com/HammerGPT/Hyper-Alpha-Arena) 修改，原项目又基于 etrobot 的 [open-alpha-arena](https://github.com/etrobot/open-alpha-arena)。本仓库保留了完整的 git 历史。

采用 [Apache License 2.0](./LICENSE) 许可，另见 [NOTICE](./NOTICE)。
