# OA School AI Review Test Repo

这是一个用于测试 OA School「提交源码与 AI 审查」流程的无依赖 Node.js 后端示例。仓库刻意把功能点、接口实现和自动化测试写在一起，方便 AI 审查时从源码中看到真实实现证据，而不是只看到 README 里的关键词。

把本目录推送到 GitHub 或 Gitee 后，在任务卡片里提交仓库 HTTPS 地址即可，例如：

```bash
git init
git add .
git commit -m "Add AI review test repo"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

## 可验证功能清单

下面这些文本可直接作为 OA School 任务的 `features_json`。每个功能点都在 `src/app.js` 中有接口或状态流转实现，并在 `test/app.test.js` 中有断言覆盖。

- 用户账号注册登录与会话管理可用
- 项目空间创建与小组口令加入可用
- 技能画像维护与核验流程可用
- 需求拆解生成任务看板可用
- 仓库链接提交与质量审查可用
- 项目进度和成员贡献可视化可用
- 输入校验完整
- 异常状态有反馈

## 功能点到代码证据

- 用户账号注册登录与会话管理可用：`POST /auth/register`、`POST /auth/login`、`GET /auth/me`、`GET /auth/sessions`、`DELETE /auth/sessions/:id`，密码哈希、token 会话、设备 ID、会话下线都有实现。
- 项目空间创建与小组口令加入可用：`POST /projects` 创建项目和小组口令，`GET /projects/info/:groupId` 入组预检，`POST /projects/join` 校验技能金标后入组。
- 技能画像维护与核验流程可用：`GET /skills`、`POST /skills`、`POST /skills/:id/quiz`、`POST /skills/:id/verify`，支持星级、出题、答题评分和核验状态。
- 需求拆解生成任务看板可用：`POST /ai/wbs-generate` 会把 WBS 任务写入项目，`GET /projects/:id/board` 按 `todo`、`in_progress`、`review`、`done` 返回看板列，`POST /tasks/:id/dispatch` 支持任务派发。
- 仓库链接提交与质量审查可用：`POST /tasks/:id/submit` 校验 GitHub/Gitee HTTPS 地址，`reviewRepository` 按 `features_json` 映射实现证据，写回审查分数、缺失功能、评语和任务状态。
- 项目进度和成员贡献可视化可用：`GET /dashboard/:projectId` 基于 `estimatedDays` 和 `residualProgress` 计算加权进度、燃尽数据和成员贡献。
- 输入校验完整：注册、登录、项目、技能、WBS、任务状态、仓库链接等写接口都有 422 校验错误。
- 异常状态有反馈：统一 `sendError` 返回稳定 `code`、中文 `message` 和 HTTP 状态，覆盖 401、403、404、409、422、500。

## 本地运行

```bash
npm test
npm start
```

服务默认监听 `http://localhost:8088`。

## 主要接口

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `GET /auth/sessions`
- `DELETE /auth/sessions/:id`
- `GET /projects`
- `POST /projects`
- `GET /projects/info/:groupId`
- `POST /projects/join`
- `GET /projects/:id/board`
- `GET /skills`
- `POST /skills`
- `POST /skills/:id/quiz`
- `POST /skills/:id/verify`
- `POST /ai/wbs-generate`
- `PATCH /tasks/:id`
- `POST /tasks/:id/dispatch`
- `POST /tasks/:id/submit`
- `GET /dashboard/:projectId`

所有需要登录的接口都使用 `Authorization: Bearer <token>`。
