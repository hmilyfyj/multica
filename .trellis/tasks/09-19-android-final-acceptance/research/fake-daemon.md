# fake-daemon.py · 假 runtime daemon（FEATURE-558 阶段 5 收尾验收）

让本地后端相信 `probe550-daemon` 这台机器在线，并为夹具 agent「Probe550 Agent」
**真的跑完一轮聊天任务**，从而在设备上验证客户端聊天状态机：
`发消息 → 排队 / 运行中（pill + N steps）→ 助手气泡`，以及失败路径的失败气泡。

- 脚本：`research/fake-daemon.py`（Python 3 标准库，无第三方依赖）
- 日志：默认 `research/fake-daemon.log`（每次请求一行，含 HTTP 码与 body）
- 只用 REST + daemon token（这里用**用户 JWT**，见下「鉴权」）；不碰仓库代码、不改夹具 SQL

---

## 1. 前置条件（一次即可）

### 1.1 后端与夹具

compose 项目 `multica-probe542`，HTTP `http://127.0.0.1:8090`；登录用户
`probe551@example.com`（开发码 `888888`），工作区 `probe550` = `ab9300f7-4890-4bf7-b514-d56cb4f29d7c`，
夹具聊天会话「Android 回归会话」= `55100000-0000-4000-8000-000000000061`。

### 1.2 ⚠️ 必须先把夹具 agent 绑到假 runtime（否则永远 claim 不到）

夹具 agent `Probe550 Agent` 的 `runtime_id` 原本指向**另一个工作区**的运行时
`4fe47709-080c-47e2-9ec9-4b6b09d1ecc4`（`Probe Runtime`，所属 workspace `227180a2` = Probe 542，
`daemon_id = probe-local`）。假 daemon 的机器身份是 `probe550-daemon`，而
`ClaimTasksByRuntime` 会按「runtime 属于本 daemon」过滤（`server/internal/handler/daemon.go:1805`
附近：`rt.DaemonID != req.DaemonID` 直接 skip），所以任务会一直躺在
`4fe47709` 上、由本 daemon 认领不到（实测：claim 返回 `{"tasks":[]}`，任务停在 `queued`）。

一条 SQL 把 agent 指到本 daemon 会注册出来的 runtime（`a9fed2cd-…`）：

```bash
docker exec multica-probe542-postgres-1 psql -U multica -d multica -c \
  "update agent set runtime_id='a9fed2cd-1c9e-458c-a258-d6465bc2c684', updated_at=now() \
   where id='117d882d-2060-4c28-bd1f-4ba1bb4c137f';"
# UPDATE 1
```

> 备选（不想动 DB）：让假 daemon 换成本机身份 `probe-local` 直接服务那个既有 runtime：
> `python3 fake-daemon.py --daemon-id probe-local --workspace-id 227180a2-0e39-4732-93ec-4ae3e83396db`
> —— 注册会 upsert 到 `4fe47709`，claim 也就能过。本文件后续流程都按上面的默认身份 `probe550-daemon` 写。
>
> `seed-fixtures.sql` 不写 `agent.runtime_id`，所以这个绑定不会被每次重放夹具冲掉。

### 1.3 清掉上一轮残留的非终态任务（可选，但能让每轮「一轮一任务」）

同一个 chat session 是**串行**的：只要有一条 `dispatched / running / waiting_local_directory`
的任务挂在同一 session 上，新的排队任务就不会被 claim（见 `server/pkg/db/queries/agent.sql:789`
的 `NOT EXISTS (... active ...)`）。另外 `FAKE_MODE=fail` 会让服务端**自动建一条重试任务**
（`attempt=2 / max_attempts=2 / retry_of_task_id=<第一条>`），它会在下一轮被优先认领。

```bash
docker exec multica-probe542-postgres-1 psql -U multica -d multica -c \
  "update agent_task_queue set status='cancelled', completed_at=now() \
   where chat_session_id='55100000-0000-4000-8000-000000000061' \
     and status in ('queued','deferred','dispatched','running');"
```

---

## 2. 启动

```bash
cd .trellis/tasks/09-19-android-final-acceptance/research

# 前台跑（Ctrl-C / SIGTERM 优雅退出，退出码 0）
python3 fake-daemon.py --log fake-daemon.log

# 建议：先让它挂着，用 curl 自己发消息（贴近设备真实路径）
python3 fake-daemon.py

# 一轮即退（进程内处理完第一个到达终态的任务就退出）
python3 fake-daemon.py --once --send "FEATURE-558 验收：聊天流式回复"

# 模式文件不存在时用环境变量（默认 success）
FAKE_MODE=fail python3 fake-daemon.py --once --send "失败路径"
```

### 模式（`research/.fake-mode`，每轮 claim 前重读 → **不用重启进程就能切**）

| 值 | 行为 | 设备上看到 |
|---|---|---|
| `success` | `/start` → 前 2 条步骤 → 等 2s → 后 3 条步骤 → 等 2s → `/complete` | pill「Reading files」→「Running command」+「5 steps」→ 助手气泡 |
| `fail` | `/start` → `/fail`（`failure_reason=runtime_offline`） | 失败气泡「Daemon offline」+ 原始错误文本 |
| `pending` | `/start` → **只发 1 条** `tool_use` 步骤，**不完成**，保持 running | pill 停在「Reading files」+「1 step」，可长时间观察 |
| `slow` | 同 success，但 `/start` 前先等 15s | pill 先停在「Queued」/「Starting up」 |

```bash
printf 'pending\n' > .fake-mode   # 只要 /start 不发完成，用于观察「运行中」
printf 'success\n' > .fake-mode   # 让挂着的任务继续收尾（同一进程内）
printf 'fail\n'    > .fake-mode   # 下一条任务走失败路径
```

### 环境变量 / 参数（flag 优先）

| 变量 | 默认 | 说明 |
|---|---|---|
| `FAKE_BASE_URL` | `http://127.0.0.1:8090` | 后端地址 |
| `FAKE_EMAIL` / `FAKE_CODE` | `probe551@example.com` / `888888` | 登录凭据 |
| `FAKE_WORKSPACE_ID` | `ab9300f7-…`（probe550） | `X-Workspace-ID` + register 的 workspace |
| `FAKE_DAEMON_ID` | `probe550-daemon` | 机器身份（claim 授权按它过滤） |
| `FAKE_MODE` | `success` | 模式文件的回退值 |
| `FAKE_MODE_FILE` | `<脚本目录>/.fake-mode` | 模式文件路径 |
| `FAKE_STATE_FILE` | `<脚本目录>/.fake-inflight.json` | 未完成任务的状态（重启可续） |
| `FAKE_TOKEN` / `FAKE_TOKEN_FILE` | 空 / `<脚本目录>/.fake-token` | 直接给 token / token 缓存 |
| `FAKE_OUTPUT` | `FEATURE-558 流式夹具：助手回复已到达。` | `/complete` 的助手正文 |
| `FAKE_FAIL_REASON` | `runtime_offline` | 失败原因（服务端不校验枚举，客户端映射成 "Daemon offline"） |
| `FAKE_CLAIM_INTERVAL` / `FAKE_HEARTBEAT_INTERVAL` | `1.0` / `20.0`（秒） | 轮询 / 心跳周期 |
| `FAKE_SUCCESS_DELAY` / `FAKE_SLOW_DELAY` | `4.0` / `15.0`（秒） | 成功路径总停顿 / slow 模式前置停顿 |
| `FAKE_CHAT_SESSION_ID` | `55100000-…-000000000061` | `--send` 的目标会话 |
| `FAKE_RUNTIME_IDS` | 空 | 额外参与 claim 的 runtime_id（逗号分隔） |
| `FAKE_LOG` | `<脚本目录>/fake-daemon.log` | 日志文件 |

进程骨架：登录 → `POST /api/daemon/register` → 心跳线程（20s）→ 主循环
（有挂着的任务先收尾，否则 `POST /api/daemon/tasks/claim` max_tasks=1，1s 一次）。
`SIGINT/SIGTERM` → 优雅退出（退出码 0）。

### 鉴权（实测结论）

`middleware.DaemonAuth`（`server/internal/middleware/daemon_auth.go`）接受
`mdt_` daemon token、`mul_` PAT、`mcn_` cloud PAT **以及用户 JWT**。
本脚本走**用户 JWT**：`POST /auth/verify-code`（注意路径**没有** `/api` 前缀，跟其它
接口不同）拿到 30 天 JWT，之后所有 `/api/daemon/*` 与 `/api/chat/*` 都用它。
实测 register / heartbeat / claim / start / messages / complete / fail 全部 200。
**不需要 PAT**（仓库与 DB 里也没有现成的 `mul_` 行，未使用）。

`/auth/verify-code` 是**消费型**的：用开发码 `888888` 也必须先有一条未使用的
`verification_code` 行（`server/internal/handler/auth.go:409` 的 `isDevVerificationCode` 分支
仍然要先 `GetLatestVerificationCode` 成功）。所以脚本的登录是
「先试 verify → 400 就 `POST /auth/send-code` → 再 verify」，成功后把 token 写进
`.fake-token` 缓存，下次直接复用（`GET /api/daemon/workspaces` 探活），避免撞
`/auth/send-code` 的 **5 次/分钟** 限流（撞上时脚本会每 15s 重试，最多 4 次）。

---

## 3. 验收（下面每条都是本机实跑过的命令与输出）

### 3.a 启动后 `agent_runtime.status` = online ✅

```bash
cd .trellis/tasks/09-19-android-final-acceptance/research
python3 fake-daemon.py --log fake-daemon.log &    # 或 hub start
```
脚本启动即打印（register 的返回体被解析后）：

```
2026-09-18T21:47:44Z [register] runtime_id=a9fed2cd-1c9e-458c-a258-d6465bc2c684 status=online \
  owner_id=2f9cf0e9-992b-4cbc-bbfd-00a8cea18f1e visibility=private provider=claude-code
```

```bash
docker exec multica-probe542-postgres-1 psql -U multica -d multica -c \
 "select daemon_id, id, name, provider, status, last_seen_at from agent_runtime where daemon_id='probe550-daemon';"
```
```
    daemon_id    |                  id                  |       name       |  provider   | status |         last_seen_at
-----------------+--------------------------------------+------------------+-------------+--------+-------------------------------
 probe550-daemon | a9fed2cd-1c9e-458c-a258-d6465bc2c684 | Probe550 Runtime | claude-code | online | 2026-09-18 21:47:44.840593+00
(1 row)
```
（`register` 返回体里的 `runtimes[0].id` 就是上面这行 —— upsert 命中夹具既有行，不是新建。）

### 3.b curl 发一条聊天消息 → 假 daemon claim 到 ✅

客户端发消息的接口（`rg` 定位）：`server/cmd/server/router.go:2266`
`r.Post("/messages", h.SendChatMessage)`，挂在 `r.Route("/api/chat/sessions/{sessionId}")` 下
→ **`POST /api/chat/sessions/{sessionId}/messages`**（不是 `/api/chat-sessions/...`）。
请求体 `SendChatMessageRequest{content, attachment_ids}`（`server/internal/handler/chat.go:804`），
并且**必须带工作区头** `X-Workspace-ID`（否则 `middleware.RequireWorkspaceMember` 回 400
`workspace_id or workspace_slug is required`）。

```bash
TOKEN=$(cat .fake-token)   # 或自己跑一次 /auth/verify-code
curl -s -X POST http://127.0.0.1:8090/api/chat/sessions/55100000-0000-4000-8000-000000000061/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Workspace-ID: ab9300f7-4890-4bf7-b514-d56cb4f29d7c" \
  -H 'Content-Type: application/json' \
  -d '{"content":"FEATURE-558 设备验收：聊天流式回复"}' -w '\nHTTP %{http_code}\n'
```
```
{"message_id":"01a0b67d-8ca8-7685-8dc4-bf81ca29f73b","task_id":"01a0b67d-8ca1-756a-a70b-d6bc7c44f44a","supports_queue":true,"queued":false,"attachment_ids":null,"created_at":"2026-09-18T21:47:56Z"}

HTTP 201
```

假 daemon 1 秒内认领（`fake-daemon.log`）：

```
[claim] POST /api/daemon/tasks/claim -> HTTP 200 body={"tasks": [{"id": "01a0b67d-8ca1-756a-a70b-d6bc7c44f44a", ...}]}
[task]  claimed id=01a0b67d-8ca1-756a-a70b-d6bc7c44f44a status=dispatched runtime_id=a9fed2cd-1c9e-458c-a258-d6465bc2c684 agent_id=117d882d-2060-4c28-bd1f-4ba1bb4c137f chat_session_id=55100000-0000-4000-8000-000000000061
```

### 3.c-1 `FAKE_MODE=success` 一轮 → 多出 `role='assistant'` 且正文 = 设定文案 ✅

```bash
printf 'success\n' > .fake-mode
python3 fake-daemon.py --once --send "FEATURE-558 验收 A：success 一轮"
```
```
21:46:08.942Z [auth]      登录成功 user=2f9cf0e9-992b-4cbc-bbfd-00a8cea18f1e token_len=253
21:46:08.947Z [register]  runtime_id=a9fed2cd-1c9e-458c-a258-d6465bc2c684 status=online ...
21:46:08.959Z [chat-send] POST /api/chat/sessions/55100000-.../messages -> HTTP 201 body={"message_id": "01a0b67b-e8bd-...", "task_id": "01a0b67b-e8b9-75fe-aff2-09306ddb0515", ...}
21:46:08.975Z [claim]     POST /api/daemon/tasks/claim -> HTTP 200 body={"tasks": [{... "id": "01a0b67b-e8b9-75fe-aff2-09306ddb0515" ...}]}
21:46:08.980Z [start]     POST /api/daemon/tasks/01a0b67b-.../start -> HTTP 200 body={... "status": "running" ...}
21:46:08.986Z [messages]  POST /api/daemon/tasks/01a0b67b-.../messages -> HTTP 200 body={"status": "ok"}
21:46:11.038Z [messages]  POST /api/daemon/tasks/01a0b67b-.../messages -> HTTP 200 body={"status": "ok"}
21:46:13.118Z [complete]  POST /api/daemon/tasks/01a0b67b-.../complete -> HTTP 200 body={... "status": "completed" ...}
21:46:13.119Z [task]     completed id=01a0b67b-e8b9-75fe-aff2-09306ddb0515 output='FEATURE-558 流式夹具：助手回复已到达。'
```
（整轮 real 4.4s，退出码 0。）

DB 取证 —— 表 `chat_message`（列 `chat_session_id` / `role` / `content`；另有 `failure_reason`、
`elapsed_ms`）、表 `agent_task_queue`（列 `status` / `started_at` / `completed_at`）、
表 `task_message`（列 `seq` / `type` / `tool` / `content` / `output`）：

```
                  id                  |   role    |                content
--------------------------------------+-----------+----------------------------------------
 01a0b67d-9f7c-74dd-ad74-273458bb3f8c | assistant | FEATURE-558 流式夹具：助手回复已到达。
 01a0b67d-8ca8-7685-8dc4-bf81ca29f73b | user      | FEATURE-558 设备验收：聊天流式回复

                  id                  |  status   |          started_at           |         completed_at
--------------------------------------+-----------+-------------------------------+-------------------------------
 01a0b67d-8ca1-756a-a70b-d6bc7c44f44a | completed | 2026-09-18 21:47:57.194781+00 | 2026-09-18 21:48:01.272667+00

 seq |    type     | tool |              payload
-----+-------------+------+------------------------------------
   1 | tool_use    | Read |
   2 | tool_result | Read | < 214 lines>
   3 | thinking    |      | 夹具回复：整理一下要发出去的内容。
   4 | tool_use    | Bash |
   5 | tool_result | Bash | fixture-ok
```

### 3.c-2 `FAKE_MODE=fail` 一轮 → 任务失败落库 ✅

```bash
printf 'fail\n' > .fake-mode          # 进程不重启，下一条任务即走失败路径
python3 fake-daemon.py --once --send "FEATURE-558 设备验收：失败路径"
```
```
[claim]  POST /api/daemon/tasks/claim -> HTTP 200 body={"tasks": [{"id": "01a0b67d-ef45-717d-a0d6-23fb995c8619", ... "attempt": 2 ...}]}
[start]  POST /api/daemon/tasks/01a0b67d-ef45-.../start -> HTTP 200 body={... "status": "running" ...}
[fail]   POST /api/daemon/tasks/01a0b67d-ef45-.../fail -> HTTP 200 body={"status": "failed", "error": "fake-daemon: simulated runtime failure (FAKE_MODE=fail).", "failure_reason": "runtime_offline", "attempt": 2, "max_attempts": 2, "parent_task_id": "01a0b67d-ecdb-742c-b5ed-953f87e70235" ...}
[task]   failed id=01a0b67d-ef45-717d-a0d6-23fb995c8619 failure_reason=runtime_offline
```

```
                  id                  |  status   | attempt | max_attempts |  failure_reason |                          error                           |           retry_of_task_id
--------------------------------------+-----------+---------+--------------+-----------------+----------------------------------------------------------+--------------------------------------
 01a0b67d-ef45-717d-a0d6-23fb995c8619 | failed    |       2 |            2 | runtime_offline | fake-daemon: simulated runtime failure (FAKE_MODE=fail). | 01a0b67d-ecdb-742c-b5ed-953f87e70235
 01a0b67d-ecdb-742c-b5ed-953f87e70235 | failed    |       1 |            2 | runtime_offline | fake-daemon: simulated runtime failure (FAKE_MODE=fail). |

 id | role | failure_reason | content | elapsed_ms
 01a0b67d-f38d-732c-8303-56356c933392 | assistant | runtime_offline | fake-daemon: simulated runtime failure (FAKE_MODE=fail). | 1094
```
即：**`chat_message` 里落的是 `role='assistant'` + `failure_reason='runtime_offline'` +
`content=<error 文本>`**；`agent_task_queue.status='failed'`、`error` 是我们给的短文、
`failure_reason` 是枚举值。一个用户回合只产生**一条**失败气泡（自动重试那条不再写新气泡）。

### 3.d 额外验证过的路径

- **运行中切模式（pending → success，同一进程）**：claim → `/start` → 1 条 `tool_use` → 挂住；
  把 `.fake-mode` 改 `success` 后进程打印
  `[resume] task=… 模式=success 已发 1 条步骤，收尾`，随后 `/complete`，
  DB 里 `task_message` 补齐成 5 条、任务 `completed`、助手气泡出现。
- **进程重启后续跑**：挂住时写 `.fake-inflight.json`（`{"task_id":…,"sent":1,"held":true}`），
  重启用 `--once` 启动 → `[state] 恢复 pending 中的 task=… （服务端 status=running）`，
  模式切走后照旧收尾，state 文件被清掉，`--once` 退出码 0。
- **优雅退出**：`kill -TERM <pid>` → 日志 `收到信号 15，准备退出` / `退出`，退出码 0。
- **token 复用**：第二次启动走 `[auth] 复用缓存 token`，整轮 0.17s（不撞 send-code 限流）。

---

## 4. 设备上应该看到什么（验收脚本的观察点）

会话：**Android 回归会话**（`55100000-…-000000000061`），agent「Probe550 Agent」。

| 阶段 | 触发 | 界面 |
|---|---|---|
| 待发 | 点发送后（服务端 task `queued`） | 用户气泡出现；状态 pill 文案 **「Queued」** |
| 开始 | 假 daemon `/start`（task `dispatched → running`） | pill **「Starting up」→「Thinking」**（尚无步骤消息时） |
| 运行中 | 第 1 批步骤到达 | pill **「Reading files」**（`tool_use.Read`，slug 命中 `TOOL_LABELS.read`）；其下出现折叠 **「1 step」/「2 steps」**（`chat-timeline` 里 `type !== 'text'` 的行数） |
| 运行中 | 第 2 批步骤（`tool_use.Bash` + `tool_result`） | pill **「Running command」**；折叠 **「5 steps」**，展开可见 5 行：Read / `< 214 lines>` / 思考行 / Bash / `fixture-ok` |
| 完成 | `/complete` → `chat:done` | pill 消失；**助手气泡整条出现，正文 = `FEATURE-558 流式夹具：助手回复已到达。`**（客户端不做增量流式，见下） |
| 失败 | `FAKE_MODE=fail` | **失败气泡**（destructive 样式）：主文案 = `failureReasonLabel(failure_reason)` = **「Daemon offline」**（`runtime_offline` → `apps/mobile/lib/failure-reason-label.ts:23`），附原始错误文本 = `fake-daemon: simulated runtime failure (FAKE_MODE=fail).` |

**观察「运行中」用 `pending`**：`printf 'pending\n' > .fake-mode` 后发消息，pill 会停在
**「Reading files」+「1 step」** 直到你把模式改回 `success`（客户端没有重试按钮，失败也只有气泡 + pill 文案）。

两个和「流式」有关的、已经核实过的客户端约束（别把它们当成 bug）：

1. **没有增量文本流**：`type == 'text'` 的 `task:message` 会被
   `apps/mobile/components/chat/chat-timeline.tsx:41` 的 `items.filter(i => i.type !== 'text')` 丢掉，
   助手正文只在 `chat:done` 时以整条气泡出现。所以假 daemon 的步骤消息**不发** `text` 行。
2. **`type` 必须是 `thinking | tool_use | tool_result | error`**（`packages/core/types/events.ts:292`）。
   `StepRow` 的 `default` 分支返回 `null` —— 传 `type: "tool"` 只会让「N steps」计数 +1 却渲染不出行，
   也点亮不了 pill 的工具文案（pill 只认 `tool_use`）。

---

## 5. 已知坑 / 限制

1. **同 session 串行**：一条 in-flight 任务会挡住同 session 的新任务（`agent.sql:789`）。
   所以假 daemon 一次只处理 1 条（`max_tasks=1`），且脚本/人都不该同时往该 session 灌多条。
2. **fail 会自动重试**：服务端失败即建 `attempt=2 / max_attempts=2` 的重试任务（`deferred` → 秒级被 promote）。
   如果进程一直挂着且 `FAKE_MODE` 还是 `fail`，它会把重试也跑失败（`--once` 可以避开）。
   验收失败路径建议用 `--once`，或失败后立刻把模式切回 `success`。
3. **认领窗口**：任务被 dispatch 后若 daemon 没拿到响应（例如进程被杀），该任务要等
   `claimResponseRecoveryWindow = 90s`（`server/internal/service/task.go:194`）才会被重新认领；
   期间同 session 的新任务会被上面的串行栅栏挡住。测试时若发现「发了没反应」，先看
   `agent_task_queue` 里有没有 `dispatched` 的历史行。
4. **运行时新鲜度**：claim SQL 要求 `r.status='online'` 且 `last_seen_at/updated_at` 在
   `RuntimeClaimFreshnessSeconds = 150s` 内（`task.go:189`）—— 心跳 20s 一次足够；
   daemon 停掉后 150s 才会被扫成 offline。
5. **登录限流**：`/auth/send-code` 5 次/分钟；脚本已用 `.fake-token` 缓存规避，
   缓存失效时会自动重新登录（必要时等待重试）。
6. **`--once` 与 `pending`**：`pending` 语义就是「不完成」，所以 `--once` 遇到挂住的任务
   不会退出（退出会把状态留在 `.fake-inflight.json`，下次启动可续）。
7. 本脚本**不校验任务是否属于本会话**：任何落到本 runtime 上的任务都会被跑（夹具环境够用）；
   夹具 agent 绑到别的 runtime（见 1.2）时脚本什么也认领不到，这是设计内的 fail-closed。

## 6. 未做 / 未验证

- 未在真机/模拟器上实际点击验证渲染（本机无设备）；第 4 节的状态/文案是从客户端源码
  （`status-pill.tsx` 的 `TOOL_LABELS` 与 `pickStage`、`chat-timeline.tsx` 的「N steps」与
  `StepRow`、`chat-message-list.tsx` 的 `FailureBubble` + `failure-reason-label.ts`）推导的。
- 未验证 WebSocket 实时推送在设备断网重连后的表现（属于 559 的复验项，与本脚本无关）——
  本脚本只保证服务端真的发出了 `task:queued/dispatched/running`、`task:message`、`chat:done`。
- 未使用 daemon token（`mdt_`）/ PAT（`mul_`）路径：实测用户 JWT 已能通过 `DaemonAuth`
  的全部所需端点（register/heartbeat/claim/start/messages/complete/fail），故不做无谓的多路径实现。
