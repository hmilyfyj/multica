-- FEATURE-551 · Android 全量回归验收夹具
--
-- 这不是应用代码改动，只是喂给本地后端（compose 项目 multica-probe542，
-- 127.0.0.1:8090）的一组数据，让收件箱 / 项目 / 评论 / 表情 / 聊天 / 属性
-- 选择器这些页面都有内容可看。
--
-- 复用 probe550 工作区（FEATURE-550 的多语法 Markdown 夹具就在那 3 个 issue 上），
-- 登录用户 probe551@example.com 由 `POST /auth/verify-code` + 开发码 888888 创建。
--
-- 幂等 + 可复位：本文件在每次验收前都会被重放一遍（acceptance.sh 开头），
-- 包含三件「状态复位」的事，缺一件都会让某一轮判定作废：
--   1. 收件箱行放回未归档、恢复未读（左滑归档那一条只能测一次）
--   2. `workspace.issue_counter` 与 `MAX(issue.number)` 对齐 —— 不对齐时
--      服务端分配到的号会和已有 issue 撞 `uq_issue_workspace_number`，
--      新建 issue 直接 500（实测：counter=2 而 max=3 → POST /api/issues 500）
--   3. 聊天 agent 设为 workspace 可见且 owner 指到登录用户，否则聊天页报
--      「No agents available」、composer 不可用

BEGIN;

-- 0) 解析本次用到的 id
CREATE TEMP TABLE _ids ON COMMIT DROP AS
SELECT
  (SELECT u.id FROM "user"   u WHERE u.email = 'probe551@example.com')                   AS u551,
  (SELECT u.id FROM "user"   u WHERE u.email = 'probe550@example.com')                   AS u550,
  (SELECT w.id FROM workspace w WHERE w.slug  = 'probe550')                              AS w550,
  (SELECT w.id FROM workspace w WHERE w.slug  = 'probe542')                              AS w542,
  (SELECT a.id FROM agent a WHERE a.workspace_id = (SELECT w.id FROM workspace w WHERE w.slug='probe550') LIMIT 1) AS a550,
  (SELECT i.id FROM issue i JOIN workspace w ON w.id = i.workspace_id WHERE w.slug='probe550' AND i.number = 1) AS i1,
  (SELECT i.id FROM issue i JOIN workspace w ON w.id = i.workspace_id WHERE w.slug='probe550' AND i.number = 2) AS i2,
  (SELECT i.id FROM issue i JOIN workspace w ON w.id = i.workspace_id WHERE w.slug='probe550' AND i.number = 3) AS i3;

-- 1) 用户加入两个工作区：工作区选择器要有 2 个可选项，且能互相切换
INSERT INTO member (workspace_id, user_id, role)
SELECT t.w550, t.u551, 'owner' FROM _ids t
WHERE NOT EXISTS (SELECT 1 FROM member m WHERE m.workspace_id = t.w550 AND m.user_id = t.u551);

INSERT INTO member (workspace_id, user_id, role)
SELECT t.w542, t.u551, 'owner' FROM _ids t
WHERE NOT EXISTS (SELECT 1 FROM member m WHERE m.workspace_id = t.w542 AND m.user_id = t.u551);

-- 2) 项目（项目列表 + 项目详情 + issue 的属性选择器都要有可选项）
INSERT INTO project (id, workspace_id, title, description, status, priority, lead_type, lead_id, start_date, due_date)
SELECT
  '55100000-0000-4000-8000-000000000001', t.w550,
  'Android 回归项目',
  'FEATURE-551 一次性验收夹具项目：用于项目列表、项目详情与 issue 的 project picker。',
  'in_progress', 'high', 'member', t.u551, current_date, current_date + 30
FROM _ids t
ON CONFLICT (id) DO NOTHING;

-- 3) 标签（label picker 要有可选项）
INSERT INTO issue_label (id, workspace_id, name, color)
SELECT v.id, t.w550, v.name, v.color
FROM _ids t,
     (VALUES
        ('55100000-0000-4000-8000-000000000011'::uuid, 'android',  '#3B82F6'),
        ('55100000-0000-4000-8000-000000000012'::uuid, '回归',     '#F59E0B'),
        ('55100000-0000-4000-8000-000000000013'::uuid, 'P0',       '#EF4444')
     ) AS v(id, name, color)
ON CONFLICT (id) DO NOTHING;

-- 4) issue 属性：让编辑页的每一个选择器进入时都有当前值可显示
UPDATE issue i SET
  status        = 'in_progress',
  priority      = 'high',
  project_id    = '55100000-0000-4000-8000-000000000001',
  assignee_type = 'member',
  assignee_id   = t.u551,
  start_date    = current_date,
  due_date      = current_date + 7,
  stage         = 2
FROM _ids t WHERE i.id = t.i1;

UPDATE issue i SET
  status        = 'todo',
  priority      = 'medium',
  assignee_type = 'member',
  assignee_id   = t.u551
FROM _ids t WHERE i.id = t.i2;

-- 5) issue ↔ label
INSERT INTO issue_to_label (issue_id, label_id)
SELECT t.i1, v.id FROM _ids t,
     (VALUES ('55100000-0000-4000-8000-000000000011'::uuid),
             ('55100000-0000-4000-8000-000000000012'::uuid)) AS v(id)
WHERE NOT EXISTS (SELECT 1 FROM issue_to_label x WHERE x.issue_id = t.i1 AND x.label_id = v.id);

-- 6) issue 上的表情（issue 详情正文的表情条）
INSERT INTO issue_reaction (id, issue_id, workspace_id, actor_type, actor_id, emoji)
SELECT '55100000-0000-4000-8000-000000000021', t.i1, t.w550, 'member', t.u550, '👍'
FROM _ids t
ON CONFLICT (id) DO NOTHING;

-- 7) 评论 + 评论表情（issue 详情的时间线）
INSERT INTO comment (id, issue_id, workspace_id, author_type, author_id, content, type, created_at)
SELECT v.id, t.i1, t.w550, 'member', t.u550, v.content, 'comment', now() - v.age
FROM _ids t,
     (VALUES
       ('55100000-0000-4000-8000-000000000031'::uuid, '这条评论用来检查 Android 上的评论卡片渲染：**加粗**、`行内代码`、列表。'::text, interval '30 minutes'),
       ('55100000-0000-4000-8000-000000000032'::uuid, E'带一段代码块的评论：\n\n```ts\nexport function probe(input: string): number {\n  return input.trim().length;\n}\n```', interval '20 minutes'),
       ('55100000-0000-4000-8000-000000000033'::uuid, '@probe551 这是一条提及评论，用于检查收件箱的 mention 通知。'::text, interval '10 minutes')
     ) AS v(id, content, age)
ON CONFLICT (id) DO NOTHING;

INSERT INTO comment_reaction (id, comment_id, workspace_id, actor_type, actor_id, emoji)
SELECT '55100000-0000-4000-8000-000000000041', '55100000-0000-4000-8000-000000000031', t.w550, 'member', t.u550, '🎉'
FROM _ids t
ON CONFLICT (id) DO NOTHING;

-- 8) 收件箱：2 条未读 + 1 条已读，覆盖「列表 / 未读态 / 已读翻页 / 滑动归档」
INSERT INTO inbox_item (id, workspace_id, recipient_type, recipient_id, type, severity, issue_id, title, body, read, actor_type, actor_id, created_at)
SELECT v.id, t.w550, 'member', t.u551, v.type, v.severity, v.issue_id, v.title, v.body, v.read, 'member', t.u550, now() - v.age
FROM _ids t,
     (VALUES
       ('55100000-0000-4000-8000-000000000051'::uuid, 'issue_assigned'::text, 'action_required'::text, NULL::uuid, 'probe550 把 PRB-1 指派给了你'::text, 'Markdown 语法全覆盖'::text, false::boolean, interval '40 minutes'),
       ('55100000-0000-4000-8000-000000000052'::uuid, 'mentioned', 'attention', NULL, 'probe550 在 PRB-1 的评论中提到了你', '带一段代码块的评论', false, interval '25 minutes'),
       ('55100000-0000-4000-8000-000000000053'::uuid, 'new_comment', 'info', NULL, 'PRB-2 有一条新评论', '长文档性能夹具', true, interval '3 hours')
     ) AS v(id, type, severity, issue_id, title, body, read, age)
ON CONFLICT (id) DO NOTHING;

-- issue_id 依赖 _ids，单独回填（避免在 VALUES 里引用临时表列）
UPDATE inbox_item SET issue_id = (SELECT i1 FROM _ids) WHERE id = '55100000-0000-4000-8000-000000000051';
UPDATE inbox_item SET issue_id = (SELECT i1 FROM _ids) WHERE id = '55100000-0000-4000-8000-000000000052';
UPDATE inbox_item SET issue_id = (SELECT i2 FROM _ids) WHERE id = '55100000-0000-4000-8000-000000000053';

-- 9) 聊天：一个已有历史的消息会话，用于检查会话列表与气泡渲染
INSERT INTO chat_session (id, workspace_id, agent_id, creator_id, title, status, last_read_at)
SELECT '55100000-0000-4000-8000-000000000061', t.w550, t.a550, t.u551, 'Android 回归会话', 'active', now()
FROM _ids t
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_message (id, chat_session_id, role, content, created_at)
SELECT v.id, '55100000-0000-4000-8000-000000000061', v.role, v.content, now() - v.age
FROM (VALUES
  ('55100000-0000-4000-8000-000000000071'::uuid, 'user'::text, '这条消息用于检查聊天页的历史气泡渲染。'::text, interval '15 minutes'),
  ('55100000-0000-4000-8000-000000000072'::uuid, 'assistant', E'已收到。\n\n- 列表渲染正常\n- 代码块也要能显示：`const ok = true`', interval '14 minutes')
) AS v(id, role, content, age)
ON CONFLICT (id) DO NOTHING;

-- ── 11) 图片查看器夹具（FEATURE-558 补验；551 因夹具没有图片而记为未覆盖）──
-- 图片文件本身不是 SQL 能造的：`research/make-fixture-images.py` 生成两张 PNG，
-- 由 acceptance558.sh `docker cp` 进后端容器 uploads 卷
-- （卷 multica-probe542_backend_uploads → 容器 /app/data/uploads，公开路由 /uploads/<key>）。
-- 这里造两种读取路径，都会被同一次验收验到：
--   a. markdown 内联图片（`![](/uploads/<file>)` 且**独占一行**才会被提升为 image 块）
--   b. 真实附件行（attachment.url = /uploads/<file> 公开路由；download_url 走 /api/attachments/<id>/download 需鉴权）
-- 用专用 issue，避免动 probe550 那三个 Markdown 夹具 issue 的判定。
INSERT INTO issue (id, workspace_id, number, title, description, status, priority,
                   creator_type, creator_id, assignee_type, assignee_id, created_at, updated_at)
SELECT '55800000-0000-4000-8000-000000000001', t.w550,
       (SELECT COALESCE(MAX(i.number), 0) + 1 FROM issue i WHERE i.workspace_id = t.w550),
       '图片查看器夹具',
       E'图片查看器夹具（FEATURE-558）。下面两张图各自独占一行：\n\n![probe-a](/uploads/probe558-a.png)\n\n![probe-b](/uploads/probe558-b.png)\n\n正文占位行，用于把图片滚进视口。',
       'todo', 'medium', 'member', t.u550, 'member', t.u551,
       now() - interval '5 minutes', now() - interval '5 minutes'
FROM _ids t
ON CONFLICT (id) DO NOTHING;

INSERT INTO attachment (id, workspace_id, issue_id, uploader_type, uploader_id, filename, url, content_type, size_bytes, created_at)
SELECT v.id, t.w550, '55800000-0000-4000-8000-000000000001', 'member', t.u550, v.filename, v.url, 'image/png', 30000, now() - interval '5 minutes'
FROM _ids t,
     (VALUES
       ('55800000-0000-4000-8000-000000000011'::uuid, 'probe558-a.png'::text, '/uploads/probe558-a.png'::text),
       ('55800000-0000-4000-8000-000000000012'::uuid, 'probe558-b.png'::text, '/uploads/probe558-b.png'::text)
     ) AS v(id, filename, url)
ON CONFLICT (id) DO NOTHING;

-- ── 12) 聊天流式夹具：把夹具 agent 绑到本机可注册的 runtime，并置在线 ──
-- fake-daemon.py 用 daemon_id='probe550-daemon' 注册，落在这条 runtime 上
-- （workspace=probe550）。客户端只在 agent 可用（runtime online）时才允许发送：
-- 551 验收时这条 runtime 是 offline，所以「发送后的排队 / 运行中 / 完成」整条链路没覆盖。
-- `status='online'` 只是把夹具摆正；真正的在线由 fake daemon 的 register/heartbeat 维持
-- （无心跳 150s 会被服务端扫回 offline）。
UPDATE agent SET runtime_id = 'a9fed2cd-1c9e-458c-a258-d6465bc2c684'
WHERE id = (SELECT a550 FROM _ids);
UPDATE chat_session SET runtime_id = 'a9fed2cd-1c9e-458c-a258-d6465bc2c684'
WHERE id = '55100000-0000-4000-8000-000000000061';
UPDATE agent_runtime SET status = 'online', last_seen_at = now()
WHERE id = 'a9fed2cd-1c9e-458c-a258-d6465bc2c684';

-- 12b 会话复位：只留两条夹具历史消息，其它（历次验收/探针/假 daemon 写进来的）全删。
-- 两件必须做的事：
--   · 不删干净，「助手回复出现」这类判据会被上一轮的残留直接点亮 —— 假通过；
--   · 不清同 session 的未终态任务，服务端按 session 串行，新消息会被挡住（实测）。
DELETE FROM chat_message
WHERE chat_session_id = '55100000-0000-4000-8000-000000000061'
  AND id <> ALL (ARRAY['55100000-0000-4000-8000-000000000071'::uuid,
                       '55100000-0000-4000-8000-000000000072'::uuid]);
DELETE FROM agent_task_queue
WHERE chat_session_id = '55100000-0000-4000-8000-000000000061';

-- 13) 清掉历次验收「新建 issue」留下的探针 issue。
-- 服务端对同工作区内的**同名活跃 issue** 会直接 409（`service.ErrActiveDuplicate`，
-- `server/internal/handler/issue.go:3152`），实测 2026-09-19：551 那轮建的
-- `FEATURE-551 acceptance issue` 仍在库里，258 轮的探针同名 → `POST /api/issues 409`
-- → C7d 判失败（截图里是原生对话框「Failed to create issue 409」）。
-- 删掉探针不伤夹具：这些 issue 只由验收自己创建；issue 相关外键几乎都是 CASCADE。
-- 注意放在 §10b 计数器对账**之前**，删完再对齐，避免号段再次漂移。
DELETE FROM issue
WHERE title = 'FEATURE-551 acceptance issue'
   OR title LIKE 'FEATURE-558 acceptance probe%';

-- ── 10) 状态复位（每轮验收前必跑，见文件头注释）──────────────────────
-- 10a 收件箱行放回未归档、恢复未读
UPDATE inbox_item SET archived = false, read = false
WHERE id IN ('55100000-0000-4000-8000-000000000051',
             '55100000-0000-4000-8000-000000000052');
UPDATE inbox_item SET archived = false
WHERE id = '55100000-0000-4000-8000-000000000053';

-- 10b issue 号计数器与 MAX(number) 对齐，否则新建 issue 撞唯一约束 → 500
UPDATE workspace w
SET issue_counter = (SELECT COALESCE(MAX(i.number), 0) FROM issue i WHERE i.workspace_id = w.id)
WHERE w.slug IN ('probe550', 'probe542');

-- 10c 聊天 agent：owner 指到登录用户 + workspace 可见，否则聊天页没有可用 agent
UPDATE agent a
SET owner_id = t.u551, visibility = 'workspace', status = 'idle'
FROM _ids t
WHERE a.id = t.a550;

COMMIT;
