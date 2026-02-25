# Vue DevTools v6

![screenshot](./media/screenshot-shadow.png)

[文档](https://devtools.vuejs.org/) | [安装扩展](https://devtools.vuejs.org/guide/installation.html)

> **注意**: 新一代 Vue DevTools 正在 [vuejs/devtools-next](https://github.com/vuejs/devtools-next) 开发中。

## 项目简介

Vue DevTools v6 Pro 是基于 Vue.js 官方开发者工具的增强版本，支持 Vue 1/2/3，在原有组件树查看、状态检查、事件追踪、路由/Vuex 调试等功能基础上，新增两大核心特性：

### 1. 生产环境支持
增强了 Vue 实例检测逻辑，可在生产构建的网站上使用 DevTools。即使页面没有显式暴露 `__VUE_DEVTOOLS_GLOBAL_HOOK__`，也能通过 DOM 遍历检测 `__vue__` / `__vue_app__` 属性，自动识别 Vue 应用。

### 2. 组件数据深度搜索
- 支持按 props、data、setup state、computed 字段内容搜索组件（不仅限于组件名称）
- 搜索命中时，tag 标签显示完整数据路径（如 `$data.store.state.currentUser.name`）
- 设置菜单中提供 "Search component data" 开关，默认关闭以保持性能，按需开启

项目采用 **pnpm workspaces + Lerna** 的 Monorepo 架构，构建系统基于 **Webpack 5**。

## 技术栈

- **包管理**: pnpm workspaces + Lerna
- **构建工具**: Webpack 5（统一配置工厂在 `packages/build-tools`）
- **前端**: Vue 3 + TypeScript
- **后端注入层**: JavaScript（通过 esbuild-loader 支持 TS）
- **样式**: Tailwind CSS + PostCSS + Stylus
- **Chrome 扩展**: Manifest V3

## Monorepo 包结构

### Shell 层（运行环境）

| 包 | 说明 |
|---|------|
| [shell-chrome](./packages/shell-chrome) | Chrome 浏览器扩展（MV3） |
| [shell-firefox](./packages/shell-firefox) | Firefox 浏览器扩展 |
| [shell-electron](./packages/shell-electron) | Electron 独立应用 |
| [shell-host](./packages/shell-host) | 前端开发环境宿主（端口 8091） |
| [shell-dev-vue2](./packages/shell-dev-vue2) | Vue 2 演示/调试应用 |
| [shell-dev-vue3](./packages/shell-dev-vue3) | Vue 3 演示/调试应用 |

### 核心层

| 包 | 说明 |
|---|------|
| [app-frontend](./packages/app-frontend) | DevTools 面板 UI（Vue 3 应用） |
| [app-backend-core](./packages/app-backend-core) | 注入页面的核心逻辑，与 Vue 应用交互 |
| [app-backend-api](./packages/app-backend-api) | 抽象 API 层，连接公共 API、核心和 Vue 处理器 |
| [app-backend-vue1](./packages/app-backend-vue1) | Vue 1 适配器 |
| [app-backend-vue2](./packages/app-backend-vue2) | Vue 2 适配器 |
| [app-backend-vue3](./packages/app-backend-vue3) | Vue 3 适配器 |

### 工具层

| 包 | 说明 |
|---|------|
| [api](./packages/api) | 公共 API（`@vue/devtools-api`），供 Vue 插件集成 |
| [shared-utils](./packages/shared-utils) | 前后端共享工具模块 |
| [build-tools](./packages/build-tools) | Webpack 构建配置工厂 |
| [docs](./packages/docs) | 文档站点（VitePress） |

## 快速开始

### 环境要求

- Node.js >= 8.10
- pnpm

### 安装依赖

```bash
pnpm install
```

### 构建所有包

```bash
# 首次运行或依赖变更后，需要先构建所有包
pnpm build

# 监听模式构建（先构建 backend 和 shared 包，再并行监听）
pnpm build:watch
```

## 编译链路

项目中不同层的包采用不同的编译方式，理解这一点对于开发非常重要：

### 前端层（直接从 src/ 编译）

`app-frontend` 通过 webpack alias `@front` 直接指向 `src/` 目录，webpack 使用 `esbuild-loader` 和 `vue-loader` 直接处理 `.ts`/`.vue` 源码。修改 `app-frontend/src/` 下的文件后，`pnpm dev:chrome` 会自动检测变化并重新打包。

### 后端层（需要先 tsc 编译到 lib/）

`app-backend-*`、`shared-utils`、`app-backend-api` 等包的编译流程是**两步走**：

```
src/*.ts  ──(tsc 编译)──→  lib/*.js  ──(webpack 打包)──→  shell-chrome/build/*.js
```

webpack 通过 alias 和 `package.json` 的 `main` 字段解析到 `lib/` 目录：

| 包 | webpack 解析路径 | 解析方式 |
|---|---|---|
| `app-frontend` | `src/` | webpack alias `@front` |
| `app-backend-core` | `lib/` | webpack alias `@back` |
| `shared-utils` | `lib/` | webpack alias |
| `app-backend-api` | `lib/` | webpack alias |
| `app-backend-vue2` | `lib/` | `package.json` main 字段 |
| `app-backend-vue3` | `lib/` | `package.json` main 字段 |

> **重要**：只运行 `pnpm dev:chrome` 时，webpack 只监视 `lib/` 中的文件。修改 backend 包的 `src/*.ts` 不会自动触发重新打包，必须先通过 `tsc` 编译到 `lib/`。

## 浏览器扩展开发

### Chrome 扩展开发

#### 方式一：纯扩展开发（只修改 shell-chrome / app-frontend）

```bash
# 启动 Chrome 扩展的 webpack watch 模式
pnpm dev:chrome
```

构建产物输出到 `packages/shell-chrome/build/` 目录。此方式适用于只修改 `shell-chrome` 自身或 `app-frontend`（前端面板 UI）的场景，因为 webpack 直接从 `app-frontend/src/` 读取源码。

**加载扩展到 Chrome：**

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `packages/shell-chrome` 目录
5. 代码修改后 webpack 会自动重新编译，刷新目标页面即可生效（如修改了 devtools 面板页面，需关闭再重新打开 DevTools 面板）

#### 方式二：修改 backend 包（app-backend-*、shared-utils 等）

修改 `app-backend-vue2`、`app-backend-vue3`、`app-backend-core`、`shared-utils` 等包时，需要**同时运行两个终端**：

```bash
# 终端 1：监视所有 backend 包的 TypeScript 编译（src/ → lib/）
pnpm build:watch

# 终端 2：监视 webpack 打包（lib/ → shell-chrome/build/）
pnpm dev:chrome
```

`build:watch` 会先执行一次全量 build，然后并行启动所有 backend 包的 `tsc -w`，实时将 `src/` 变更编译到 `lib/`，webpack 检测到 `lib/` 变化后自动重新打包。

如果**不想启动 `build:watch`**，也可以手动单独编译修改的包：

```bash
# 例如修改了 app-backend-vue2
cd packages/app-backend-vue2
pnpm build

# 如果 shared-utils 也有修改，也需要单独编译
cd packages/shared-utils
pnpm build

# 然后回到 shell-chrome 重新打包（如果已有 dev:chrome 在跑，webpack 会自动检测）
```

#### 方式三：前端面板 + 演示应用联调

适用于修改 DevTools 面板 UI（`app-frontend`）或后端逻辑（`app-backend-*`）时使用：

```bash
# 终端 1：启动 Vue 3 演示应用 + shell-host 开发服务器
pnpm dev:vue3

# 或使用 Vue 2 演示应用
pnpm dev:vue2
```

这会同时启动：
- **shell-dev-vue3**（或 vue2）: 目标演示页面（默认端口 8090）
- **shell-host**: DevTools 面板宿主（默认端口 8091）

在浏览器中访问演示应用，打开浏览器 DevTools 即可看到 Vue 面板。

#### 方式四：生产模式监听构建

```bash
pnpm dev:chrome:prod
```

与 `dev:chrome` 相同，但使用生产模式编译（代码压缩、去除开发警告）。

### Firefox 扩展开发

```bash
# 启动 Firefox 扩展的 webpack watch 模式
pnpm dev:firefox

# 使用 web-ext 直接运行 Firefox 扩展
pnpm run:firefox
```

### Chrome 扩展文件结构

```
packages/shell-chrome/
├── manifest.json          # Chrome MV3 清单文件
├── devtools-background.html  # DevTools 页面入口
├── devtools.html          # DevTools 面板 HTML
├── src/
│   ├── hook.ts            # 在 document_start 注入，设置 Vue 挂钩
│   ├── detector.ts        # 在 document_idle 注入，检测 Vue 实例
│   ├── devtools-background.ts  # DevTools 面板初始化
│   ├── devtools.ts        # DevTools 面板主入口
│   ├── backend.ts         # 后端逻辑注入
│   ├── proxy.ts           # 代理通信层
│   └── service-worker.ts  # MV3 Service Worker
├── build/                 # webpack 构建产物
└── webpack.config.js      # webpack 配置
```

### Chrome 扩展架构

```
目标页面                      DevTools 面板
┌────────────────────┐       ┌──────────────────┐
│  hook.js           │       │  devtools.ts      │
│  (document_start)  │       │  (app-frontend)   │
│                    │       │                   │
│  detector.js       │       │                   │
│  (document_idle)   │       │                   │
│                    │       │                   │
│  backend.js        │◄─────►│  proxy.ts         │
│  (app-backend-core)│ 消息  │  (通信桥接)        │
└────────────────────┘       └──────────────────────┘
         ▲                            ▲
         │                            │
         ▼                            │
┌──────────────────┐                  │
│  service-worker  │──────────────────┘
│  (消息路由)       │
└──────────────────┘
```

## Electron 独立应用开发

```bash
pnpm dev:electron
```

详细使用说明见 [packages/shell-electron/README.md](./packages/shell-electron/README.md)。

## 其他命令

| 命令 | 说明 |
|------|------|
| `pnpm lint` | ESLint 代码检查 |
| `pnpm test` | 运行 lint + 类型检查 |
| `pnpm test:e2e` | 运行 E2E 测试（Cypress） |
| `pnpm zip` | 打包扩展 zip |
| `pnpm sign:firefox` | 签名 Firefox 扩展 |
| `pnpm docs:dev` | 本地开发文档站点 |

## 常见问题

### 修改了 backend 代码但扩展行为没变？

**最常见原因**：只运行了 `pnpm dev:chrome`，但 backend 包（`app-backend-*`、`shared-utils`）的 `src/` 修改没有编译到 `lib/`。

解决方法：
```bash
# 方案一：启动 tsc watch（推荐，一劳永逸）
pnpm build:watch  # 在另一个终端

# 方案二：手动编译修改的包
cd packages/app-backend-vue2 && pnpm build
cd packages/shared-utils && pnpm build
```

编译完成后还需要：
1. 在 `chrome://extensions/` 点击扩展的刷新按钮
2. 刷新被检查的目标页面
3. 如修改了 DevTools 面板相关代码，还需关闭并重新打开 DevTools

### 修改代码后扩展没有更新？

- 如修改了 `content_scripts`（hook/detector），需要在 `chrome://extensions/` 点击刷新按钮，然后刷新目标页面
- 如修改了 `service-worker`，需要在扩展详情页点击 Service Worker 链接查看是否有错误
- 如修改了 DevTools 面板（frontend），需要关闭并重新打开 DevTools
- 如修改了 backend 包，确保已编译到 `lib/`（参见上一条）

### 构建报错？

确保已先运行 `pnpm build` 构建所有包的依赖产物（特别是 `shared-utils`、`app-backend-api` 等被其他包依赖的包）。

### 如何只构建特定包？

```bash
# 进入具体包目录
cd packages/app-backend-vue2
pnpm build
```

## Contributing

See the [Contributing guide](https://devtools.vuejs.org/guide/contributing.html).

## License

[MIT](http://opensource.org/licenses/MIT)
