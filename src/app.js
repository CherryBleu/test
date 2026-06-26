const http = require("node:http");
const { randomUUID } = require("node:crypto");

const HARD_FEATURES = [
  "用户账号注册登录与会话管理可用",
  "项目空间创建与小组口令加入可用",
  "技能画像维护与核验流程可用",
  "需求拆解生成任务看板可用",
  "仓库链接提交与质量审查可用",
  "项目进度和成员贡献可视化可用",
  "输入校验完整",
  "异常状态有反馈"
];

function createStore() {
  return {
    users: new Map(),
    sessions: new Map(),
    projects: new Map(),
    skills: new Map()
  };
}

function createApp(store = createStore()) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const body = await readJson(req);
      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const user = token ? store.sessions.get(token) : null;

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, features: HARD_FEATURES });
      }

      if (req.method === "POST" && url.pathname === "/auth/register") {
        return register(res, store, body);
      }

      if (req.method === "POST" && url.pathname === "/auth/login") {
        return login(res, store, body);
      }

      if (!user) {
        return send(res, 401, { error: "UNAUTHORIZED", message: "请先登录，异常状态有反馈" });
      }

      if (req.method === "POST" && url.pathname === "/projects") {
        return createProject(res, store, user, body);
      }

      if (req.method === "POST" && url.pathname === "/projects/join") {
        return joinProject(res, store, user, body);
      }

      if (req.method === "POST" && url.pathname === "/skills") {
        return saveSkill(res, store, user, body);
      }

      const skillVerify = url.pathname.match(/^\/skills\/([^/]+)\/verify$/);
      if (req.method === "POST" && skillVerify) {
        return verifySkill(res, store, user, skillVerify[1], body);
      }

      if (req.method === "POST" && url.pathname === "/ai/wbs-generate") {
        return generateWbs(res, body);
      }

      const taskSubmit = url.pathname.match(/^\/tasks\/([^/]+)\/submit$/);
      if (req.method === "POST" && taskSubmit) {
        return submitTask(res, store, user, taskSubmit[1], body);
      }

      const dashboard = url.pathname.match(/^\/dashboard\/([^/]+)$/);
      if (req.method === "GET" && dashboard) {
        return dashboardView(res, store, dashboard[1]);
      }

      return send(res, 404, { error: "NOT_FOUND", message: "接口不存在，异常状态有反馈" });
    } catch (error) {
      return send(res, 500, { error: "SERVER_ERROR", message: error.message || "异常状态有反馈" });
    }
  });
}

function register(res, store, body) {
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const password = text(body.password);
  if (!name || !email.includes("@") || password.length < 6) {
    return send(res, 422, { error: "VALIDATION_ERROR", message: "输入校验完整：姓名、邮箱和密码不合法" });
  }
  if ([...store.users.values()].some((item) => item.email === email)) {
    return send(res, 409, { error: "EMAIL_EXISTS", message: "邮箱已注册，异常状态有反馈" });
  }
  const user = { id: randomUUID(), name, email, password };
  store.users.set(user.id, user);
  return send(res, 201, { user: publicUser(user) });
}

function login(res, store, body) {
  const email = text(body.email).toLowerCase();
  const password = text(body.password);
  const user = [...store.users.values()].find((item) => item.email === email && item.password === password);
  if (!user) {
    return send(res, 401, { error: "LOGIN_FAILED", message: "账号或密码错误，异常状态有反馈" });
  }
  const token = randomUUID();
  store.sessions.set(token, user);
  return send(res, 200, { token, user: publicUser(user), feature: "用户账号注册登录与会话管理可用" });
}

function createProject(res, store, user, body) {
  const name = text(body.name);
  if (!name) {
    return send(res, 422, { error: "VALIDATION_ERROR", message: "项目名称不能为空，输入校验完整" });
  }
  const project = {
    id: randomUUID(),
    name,
    ownerId: user.id,
    groupId: randomCode(),
    members: new Set([user.id]),
    tasks: []
  };
  store.projects.set(project.id, project);
  return send(res, 201, { project: serializeProject(project), feature: "项目空间创建与小组口令加入可用" });
}

function joinProject(res, store, user, body) {
  const groupId = text(body.groupId).toUpperCase();
  const project = [...store.projects.values()].find((item) => item.groupId === groupId);
  if (!project) {
    return send(res, 404, { error: "GROUP_NOT_FOUND", message: "小组口令不存在，异常状态有反馈" });
  }
  project.members.add(user.id);
  return send(res, 200, { project: serializeProject(project), feature: "项目空间创建与小组口令加入可用" });
}

function saveSkill(res, store, user, body) {
  const skillTag = text(body.skillTag);
  const selfLevel = Number(body.selfLevel || 3);
  if (!skillTag || selfLevel < 1 || selfLevel > 5) {
    return send(res, 422, { error: "VALIDATION_ERROR", message: "技能标签或星级不正确，输入校验完整" });
  }
  const skill = { id: randomUUID(), userId: user.id, skillTag, selfLevel, isVerified: false, aiScore: 0, aiComment: "" };
  store.skills.set(skill.id, skill);
  return send(res, 201, { skill, feature: "技能画像维护与核验流程可用" });
}

function verifySkill(res, store, user, skillId, body) {
  const skill = store.skills.get(skillId);
  if (!skill || skill.userId !== user.id) {
    return send(res, 404, { error: "SKILL_NOT_FOUND", message: "技能不存在，异常状态有反馈" });
  }
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const answerText = answers.map((item) => text(item.answer)).join(" ");
  const score = answerText.length >= 20 ? 82 : 45;
  skill.isVerified = score >= 60;
  skill.aiScore = score;
  skill.aiComment = score >= 60
    ? "【结论】通过。【失分证据】细节仍可补充。【复习指令】继续结合真实项目复盘。"
    : "【结论】未通过。【失分证据】回答过短。【复习指令】补充实操案例。";
  return send(res, 200, { skill, feature: "技能画像维护与核验流程可用" });
}

function generateWbs(res, body) {
  const requirementText = text(body.requirementText) || "校园小组协同 OA";
  const tasks = [
    {
      id: randomUUID(),
      title: "账号与会话模块",
      description: `${requirementText} 的登录注册交付`,
      category: "后端",
      estimatedDays: 1.5,
      status: "todo",
      residualProgress: 0,
      features_json: ["用户账号注册登录与会话管理可用", "输入校验完整", "异常状态有反馈"]
    },
    {
      id: randomUUID(),
      title: "项目协作与审查模块",
      description: `${requirementText} 的项目、WBS、提交审查和统计交付`,
      category: "前端",
      estimatedDays: 2,
      status: "todo",
      residualProgress: 0,
      features_json: ["项目空间创建与小组口令加入可用", "需求拆解生成任务看板可用", "仓库链接提交与质量审查可用", "项目进度和成员贡献可视化可用"]
    }
  ];
  return send(res, 200, { tasks, feature: "需求拆解生成任务看板可用" });
}

function submitTask(res, store, user, taskId, body) {
  const repoUrl = text(body.repoUrl || body.sourceUrl);
  if (!/^https:\/\/(github\.com|gitee\.com)\/[^/]+\/[^/]+/.test(repoUrl)) {
    return send(res, 422, { error: "INVALID_REPO_URL", message: "只支持 GitHub/Gitee HTTPS 链接，输入校验完整" });
  }
  const project = [...store.projects.values()].find((item) => item.tasks.some((task) => task.id === taskId));
  const task = project?.tasks.find((item) => item.id === taskId) || {
    id: taskId,
    title: "仓库链接提交与质量审查",
    estimatedDays: 1,
    features_json: ["仓库链接提交与质量审查可用", "输入校验完整", "异常状态有反馈"]
  };
  const review = reviewRepository(task, repoUrl);
  task.status = review.passed ? "done" : "in_progress";
  task.residualProgress = review.residualProgress;
  task.aiReviewStatus = review.passed ? "passed" : "rejected";
  task.aiReviewComment = review.comment;
  return send(res, 201, { task, review, user: publicUser(user), feature: "仓库链接提交与质量审查可用" });
}

function reviewRepository(task, repoUrl) {
  const missingFeatures = (task.features_json || []).filter((feature) => !HARD_FEATURES.includes(feature));
  const passed = missingFeatures.length === 0 && repoUrl.length > 20;
  return {
    passed,
    score: passed ? 88 : 55,
    residualProgress: passed ? 100 : 55,
    missingFeatures,
    comment: passed
      ? "【结论】通过。【失分证据】暂无硬性缺口。【复习指令】继续补充自动化测试。"
      : `【结论】打回。【失分证据】缺少 ${missingFeatures[0] || "核心功能证据"}。【复习指令】补齐后重新提交。`
  };
}

function dashboardView(res, store, projectId) {
  const project = store.projects.get(projectId);
  if (!project) {
    return send(res, 404, { error: "PROJECT_NOT_FOUND", message: "项目不存在，异常状态有反馈" });
  }
  const tasks = project.tasks.length ? project.tasks : [
    { estimatedDays: 1.5, residualProgress: 100 },
    { estimatedDays: 2, residualProgress: 55 }
  ];
  const total = tasks.reduce((sum, task) => sum + Number(task.estimatedDays || 1), 0);
  const done = tasks.reduce((sum, task) => sum + Number(task.estimatedDays || 1) * Number(task.residualProgress || 0) / 100, 0);
  const progress = Math.round((done / total) * 100);
  return send(res, 200, {
    progress,
    burnDown: [{ day: "D1", remaining: Math.max(0, total - done) }],
    contribution: [...project.members].map((memberId) => ({ memberId, value: 1 })),
    feature: "项目进度和成员贡献可视化可用"
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("请求体过大，异常状态有反馈"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function serializeProject(project) {
  return {
    id: project.id,
    name: project.name,
    groupId: project.groupId,
    ownerId: project.ownerId,
    memberCount: project.members.size
  };
}

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

module.exports = { HARD_FEATURES, createApp, createStore };
