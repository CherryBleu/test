# OA School AI Review Test Repo

这是一个用于测试 OA School「提交源码与 AI 审查」流程的最小后端示例。

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

下面这些文本是给 `features_json` 和兜底审查使用的硬性功能点示例。测试任务里如果包含类似功能，源码和测试都能对应到。

- 用户账号注册登录与会话管理可用
- 项目空间创建与小组口令加入可用
- 技能画像维护与核验流程可用
- 需求拆解生成任务看板可用
- 仓库链接提交与质量审查可用
- 项目进度和成员贡献可视化可用
- 输入校验完整
- 异常状态有反馈

## 本地运行

```bash
npm test
npm start
```

服务默认监听 `http://localhost:8088`。

## 主要接口

- `POST /auth/register`
- `POST /auth/login`
- `POST /projects`
- `POST /projects/join`
- `POST /skills`
- `POST /skills/:id/verify`
- `POST /ai/wbs-generate`
- `POST /tasks/:id/submit`
- `GET /dashboard/:projectId`

所有需要登录的接口都使用 `Authorization: Bearer <token>`。
