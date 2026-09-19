# PRD：Runtimes / Squads / Skills 只读视图（FEATURE-569）

- 类型：中等（6 个新路由 + 11 个域组件 + 3 个纯函数模块 + 数据层追加 + More 菜单入口）
- 上游：FEATURE-541 阶段 7；参考 `packages/views/{runtimes,squads,skills}/**`
- 目标分支：`main`

## 1. 背景与范围

移动端 `apps/mobile` 目前这三个域完全没有页面（`app/(app)/[workspace]/more/` 只有 agents / projects / autopilots / issues / pins）。
本任务补三个域的只读视图（各一对列表 + 详情），Web 仍是这三个域的写操作入口。

**做**：三个域的列表 + 详情只读展示。
**不做**（本任务明确排除）：

- Runtimes：连接远程 / 云运行时、runtime profile 配置、定价页（自定义价格覆盖）
- Squads：归档、leader 转移、成员增删改、指令编辑
- Skills：创建、文件树编辑、从源更新（refresh）、runtime 本地导入
- 三个域的实时事件订阅（无对应 mobile WS 订阅；新鲜度靠焦点刷新 / 重连 / 下拉刷新）

## 2. 已核实事实（读代码得到，不是推测）

### 2.1 后端契约

| 端点 | 位置 | 关键响应字段 |
|---|---|---|
| `GET /api/runtimes` | `server/cmd/server/router.go:2191`、handler `runtime.go:902` | 裸数组；`id/name/custom_name/runtime_mode(local\|cloud)/provider/status(online\|offline)/device_info/metadata/owner_id/visibility/profile_id/last_seen_at/created_at` |
| `GET /api/runtimes/{id}/usage?days=&tz=` | `router.go:2195`、`runtime.go:112` | 裸数组，按天 × 模型；`date/provider/model/input_tokens/output_tokens/cache_read_tokens/cache_write_tokens/cost_usd_ticks/uncosted_*`；默认 `days=90`，按 viewer tz 分桶 |
| `GET /api/squads` | `router.go:2007`、`squad.go:191` | 裸数组；`squadToResponse` 全部字段 **+ 派生** `member_count` / `member_preview`（最多 3 条） |
| `GET /api/squads/{id}` | `router.go:2010`、`squad.go:326` | 同 `SquadResponse`（含 `instructions`），**无** leader 对象，只有 `leader_id` |
| `GET /api/squads/{id}/members` | `router.go:2013`、`squad.go:545` | 裸数组；`id/squad_id/member_type(agent\|member)/member_id/role/created_at` |
| `GET /api/skills` | `router.go:2160`、`skill.go:348` | 裸数组 `SkillSummaryResponse`：**无 `content`**，有 `config`（来源在 `config.origin`）、`description`、`created_at/updated_at` |
| `GET /api/skills/{id}?include=metadata` | `router.go:2164`、`skill.go:468` | `SkillWithFileMetadataResponse`：summary + `content_size`/`content_hash` + `files[{path,size,content_hash}]`，**不含任何文件正文** |

补充事实：

1. **runtimes 域没有单条详情端点**（`/api/runtimes/{id}` 下只有 `PATCH` 与只读子资源），web 与 CLI 也都只调列表 —— 详情页必须从列表缓存里按 id 取行。
2. **runtime 没有顶层 `type` / `version`**：`provider` 即类型；`metadata.version` 是该 runtime 自身 CLI（如 `2.1.12 (Claude Code)`），`metadata.cli_version` 是机器级的 multica daemon 版本（同机所有 runtime 相同，网页版刻意不在行内显示）。`profile_id` 非空 = 自定义 profile。
3. **skill 没有 `source` 字段**：来源只存在于 `config.origin` JSONB（`readOrigin` 见 `packages/views/skills/lib/origin.ts:23`）。`GET /api/skills/search` 的 `source` 是 ClawHub 上游搜索结果，与 workspace skill 无关。
4. `packages/views/runtimes/utils.ts` 里 186 行的 `MODEL_PRICING` 表只服务网页版图表，`apps/mobile` 不依赖 `@multica/views`（`apps/mobile/package.json` 只有 `@multica/core`）。

## 3. 字段map（移动端 ↔ web）

### 3.1 Runtimes

列表行（`runtime-list.tsx:191-516` + `runtimes-page.tsx:469-518`）：

| 移动端 | 来源 | web 对应 |
|---|---|---|
| 名称 | `runtimeDisplayName`（core `runtimes/display.ts:10`，`custom_name ?? name`） | 同名函数 |
| 类型 | `provider` → `providerDisplayName`（core `display.ts:60`）+ `runtime_mode` 徽标（Local/Cloud） | `ProviderLogo` + `RuntimeKindBadge` |
| 在线状态 | `deriveRuntimeHealth(status, last_seen_at)`（core `derive-health.ts:17`）→ Online / Recently lost / Offline / Long offline | `HealthCell` + `healthLabel`（`shared.tsx:102`） |
| 版本 | `metadata.version`；cloud 与缺失都显示 `—` | `CliCell`（`runtime-list.tsx:446-516`，同一取法与同一 cloud 例外） |
| 最近心跳 | `last_seen_at` → `timeAgo` | `formatLastSeen` |

详情（`runtime-detail.tsx` HeroCard `253-374`）：

| 区块 | 字段 |
|---|---|
| 基本信息 | 名称 / 健康徽标 / 最近心跳 / 类型（provider + mode）/ 版本（`metadata.version`）/ 设备（`device_info` 按首个 `" · "` 切成 hostname + runtime 两半，`parseDeviceInfo` `runtime-detail.tsx:232`）/ daemon CLI 版本（`readRuntimeCliVersion`）/ 可见性（`visibility`，private→Private）/ 归属（`owner_id` → 成员名）/ 创建时间 |
| 用量概要 | `GET /usage?days=30`：计费成本（仅 provider 上报的 `cost_usd_ticks ÷ 1e10`）、输入 / 输出 / 缓存读 / 缓存写 token 合计、活跃天数、出现过但未计价的 token 数（>0 才显示） |

**与 web 的差异（有意）**：web 的用量区块是图表 + 客户端价格表估算；移动端不做图表，且**只用 provider 上报成本**，不复刻 `MODEL_PRICING`（避免把 186 行网页版价格表复制进移动端）。未计价 token 单独成行显示，保证「成本为 $0」不会被误读成「没有用量」。

### 3.2 Squads

列表行（`squads-page.tsx:175-248`）：名称 + 描述 / 成员数 / leader（`leader_id` → agent 名，缺失时退化为 id 前 8 位，与 `LeaderCell` `193-209` 一致）。
详情（`squad-detail-page.tsx` inspector `716-818` + Members `1090-1311` + Instructions `1314+`）：基本信息（名称 / 成员数 / leader / 创建者 / 创建时间 / 描述）、成员列表（`/members` → agent / member 两类的头像 + 名称 + role）、指令（`instructions` 原文只读，空时给空文案）。

### 3.3 Skills

列表行（`skills-page.tsx:232-376`）：名称 / 来源（`readOrigin` → Manual / Runtime local / ClawHub / Skills.sh / GitHub；runtime_local 有 provider 时带 provider）/ 更新时间。
详情（`skill-detail-page.tsx` SkillIdentity `295-388` + FilesTab `564-757`）：名称 / 描述 / 来源 / 创建者 / 创建时间 / 更新时间 / 文件数、文件清单（`SKILL.md` 恒在 + `files[].path`，带 size）。

**与 web 的差异（有意）**：详情用 `?include=metadata`，不带正文字节（SKILL.md 正文常见 50–200KB，见 `skill.go:107-121`）；因此移动端只列清单、不提供文件内容查看器；来源只显示文案、不渲染外链（`originSourceUrl` 的主机白名单校验不复制，避免把可被任意写者污染成 `href` 的 JSONB 直接变成可点链接）。

## 4. 修改边界

新增：

- `apps/mobile/app/(app)/[workspace]/more/{runtimes,squads,skills}.tsx`
- `apps/mobile/app/(app)/[workspace]/more/{runtimes,squads,skills}/[id].tsx`
- `apps/mobile/components/{runtimes,squads,skills}/**`
- `apps/mobile/data/queries/skills.ts`（新增）；`runtimes.ts` / `squads.ts` 追加 key 工厂
- `apps/mobile/lib/{runtime-display,squad-display,skill-origin}.ts` + 单测

修改（只追加）：

- `apps/mobile/data/schemas.ts`（skill / squad member / runtime usage schema + fallback）
- `apps/mobile/data/api.ts`（5 个读方法）
- `apps/mobile/app/(app)/[workspace]/_layout.tsx`（6 条 `Stack.Screen`）
- `apps/mobile/components/nav/more-tab-dropdown.tsx`（3 条 `NAV_ITEMS`）

**不触碰**：三个域的任何写路径；`SHEET_OPTIONS` 现有取值；Agents 的 More 菜单入口（565/567 已记为另案，本任务不越界补）。

## 5. 验收条件

1. More 菜单出现 `Runtimes` / `Squads` / `Skills` 三项，各自能进入列表；列表行内容按 §3，三态（loading / error+重试 / empty）与下拉刷新可用。
2. 点行进详情：runtime 详情有基本信息 + 用量概要；squad 详情有基本信息 + 成员列表 + 指令；skill 详情有描述 + 文件清单。
3. 拿不到记录（404 / 跨工作区 / 列表里不存在）时显示 not-found，不白屏。
4. `pnpm --filter @multica/mobile typecheck / lint / test` 全绿。
5. 设备验收由用户在真机自测（本轮不启动模拟器）。

## 6. 风险

- `components/nav/more-tab-dropdown.tsx` 与 `_layout.tsx` 是跨任务热点文件（566/567 都改过），改动保持纯追加、单行粒度，便于合并。
- 三个域都没有 mobile WS 订阅：列表在别的设备改动后靠焦点 / 重连 / 下拉刷新同步，符合现有只读域的一致做法（567 同）。
