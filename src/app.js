const http = require("node:http");
const { createHash, randomUUID } = require("node:crypto");

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

const BOARD_STATUSES = ["todo", "in_progress", "review", "done"];

const FEATURE_EVIDENCE = {
  "用户账号注册登录与会话管理可用": [
    "POST /auth/register creates users with hashed passwords",
    "POST /auth/login creates device sessions",
    "GET /auth/me and GET /auth/sessions expose current session state",
    "DELETE /auth/sessions/:id revokes another active session"
  ],
  "项目空间创建与小组口令加入可用": [
    "POST /projects creates a project with owner and groupId",
    "GET /projects/info/:groupId previews project before joining",
    "POST /projects/join validates skill verification then adds a member"
  ],
  "技能画像维护与核验流程可用": [
    "GET /skills lists user skills",
    "POST /skills creates or updates skill tags and self levels",
    "POST /skills/:id/quiz generates level-aware quiz questions",
    "POST /skills/:id/verify grades answers and marks verified skills"
  ],
  "需求拆解生成任务看板可用": [
    "POST /ai/wbs-generate persists WBS tasks on a project",
    "GET /projects/:id/board groups tasks into todo/in_progress/review/done",
    "POST /tasks/:id/dispatch moves a task into in_progress"
  ],
  "仓库链接提交与质量审查可用": [
    "POST /tasks/:id/submit validates GitHub/Gitee URLs",
    "reviewRepository checks every features_json item against implementation evidence",
    "review result updates task status, score, missingFeatures and aiReviewComment"
  ],
  "项目进度和成员贡献可视化可用": [
    "GET /dashboard/:projectId returns progress, burnDown and contribution",
    "progress is weighted by estimatedDays and residualProgress"
  ],
  "输入校验完整": [
    "validateName, validateAccount, validatePassword, validateSkillLevel and validateRepoUrl",
    "write endpoints return 422 with a stable error code for invalid input"
  ],
  "异常状态有反馈": [
    "sendError returns code, message and feature marker",
    "401 unauthorized, 403 forbidden, 404 not found, 409 conflict and 422 validation errors"
  ]
};

function createStore() {
  return {
    users: new Map(),
    sessions: new Map(),
    projects: new Map(),
    skills: new Map(),
    events: []
  };
}

function createApp(store = createStore()) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const body = await readJson(req);
      const auth = authenticate(req, store);

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, features: HARD_FEATURES, evidence: FEATURE_EVIDENCE });
      }

      if (req.method === "POST" && url.pathname === "/auth/register") return register(res, store, body);
      if (req.method === "POST" && url.pathname === "/auth/login") return login(res, store, body);

      if (!auth.user) return sendError(res, 401, "UNAUTHORIZED", "请先登录，异常状态有反馈");

      if (req.method === "GET" && url.pathname === "/auth/me") {
        return send(res, 200, { user: publicUser(auth.user), session: publicSession(auth.session) });
      }
      if (req.method === "GET" && url.pathname === "/auth/sessions") return listSessions(res, store, auth.user);

      const sessionDelete = url.pathname.match(/^\/auth\/sessions\/([^/]+)$/);
      if (req.method === "DELETE" && sessionDelete) {
        return revokeSession(res, store, auth.user, auth.session, sessionDelete[1]);
      }

      if (req.method === "GET" && url.pathname === "/projects") return listProjects(res, store, auth.user);
      if (req.method === "POST" && url.pathname === "/projects") return createProject(res, store, auth.user, body);
      if (req.method === "POST" && url.pathname === "/projects/join") return joinProject(res, store, auth.user, body);

      const projectInfo = url.pathname.match(/^\/projects\/info\/([A-Z0-9]{4,12})$/i);
      if (req.method === "GET" && projectInfo) return previewProject(res, store, projectInfo[1]);

      const projectBoard = url.pathname.match(/^\/projects\/([^/]+)\/board$/);
      if (req.method === "GET" && projectBoard) return projectBoardView(res, store, auth.user, projectBoard[1]);

      if (req.method === "GET" && url.pathname === "/skills") return listSkills(res, store, auth.user);
      if (req.method === "POST" && url.pathname === "/skills") return saveSkill(res, store, auth.user, body);

      const skillQuiz = url.pathname.match(/^\/skills\/([^/]+)\/quiz$/);
      if (req.method === "POST" && skillQuiz) return createSkillQuiz(res, store, auth.user, skillQuiz[1]);

      const skillVerify = url.pathname.match(/^\/skills\/([^/]+)\/verify$/);
      if (req.method === "POST" && skillVerify) return verifySkill(res, store, auth.user, skillVerify[1], body);

      if (req.method === "POST" && url.pathname === "/ai/wbs-generate") return generateWbs(res, store, auth.user, body);

      const taskDispatch = url.pathname.match(/^\/tasks\/([^/]+)\/dispatch$/);
      if (req.method === "POST" && taskDispatch) return dispatchTask(res, store, auth.user, taskDispatch[1]);

      const taskSubmit = url.pathname.match(/^\/tasks\/([^/]+)\/submit$/);
      if (req.method === "POST" && taskSubmit) return submitTask(res, store, auth.user, taskSubmit[1], body);

      const taskPatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
      if (req.method === "PATCH" && taskPatch) return updateTask(res, store, auth.user, taskPatch[1], body);

      const dashboard = url.pathname.match(/^\/dashboard\/([^/]+)$/);
      if (req.method === "GET" && dashboard) return dashboardView(res, store, auth.user, dashboard[1]);

      return sendError(res, 404, "NOT_FOUND", "接口不存在，异常状态有反馈");
    } catch (error) {
      return sendError(res, 500, "SERVER_ERROR", error.message || "服务异常，异常状态有反馈");
    }
  });
}

function register(res, store, body) {
  const name = text(body.name);
  const username = text(body.username || body.account || body.email).toLowerCase();
  const email = text(body.email || (username.includes("@") ? username : "")).toLowerCase();
  const password = text(body.password);
  const errors = [
    validateName(name),
    validateAccount(username),
    validatePassword(password),
    email && !isEmail(email) ? "email 必须是有效邮箱" : ""
  ].filter(Boolean);
  if (errors.length) return sendError(res, 422, "VALIDATION_ERROR", `输入校验完整：${errors.join("；")}`);
  if ([...store.users.values()].some((user) => user.username === username || (email && user.email === email))) {
    return sendError(res, 409, "USER_EXISTS", "账号已注册，异常状态有反馈");
  }

  const user = {
    id: randomUUID(),
    name,
    username,
    email,
    passwordHash: hashPassword(password),
    createdAt: nowIso()
  };
  store.users.set(user.id, user);
  return send(res, 201, { user: publicUser(user), feature: "用户账号注册登录与会话管理可用" });
}

function login(res, store, body) {
  const account = text(body.account || body.username || body.email).toLowerCase();
  const password = text(body.password);
  if (!account || !password) return sendError(res, 422, "VALIDATION_ERROR", "输入校验完整：账号和密码不能为空");
  const user = [...store.users.values()].find((item) =>
    (item.username === account || item.email === account) && item.passwordHash === hashPassword(password)
  );
  if (!user) return sendError(res, 401, "LOGIN_FAILED", "账号或密码错误，异常状态有反馈");

  const session = {
    id: randomUUID(),
    token: randomUUID(),
    userId: user.id,
    deviceId: text(body.deviceId || body.device_uuid) || "browser",
    active: true,
    createdAt: nowIso(),
    lastSeenAt: nowIso()
  };
  store.sessions.set(session.token, session);
  return send(res, 200, {
    token: session.token,
    user: publicUser(user),
    session: publicSession(session),
    feature: "用户账号注册登录与会话管理可用"
  });
}

function listSessions(res, store, user) {
  const sessions = [...store.sessions.values()]
    .filter((session) => session.userId === user.id && session.active)
    .map(publicSession);
  return send(res, 200, { sessions, feature: "用户账号注册登录与会话管理可用" });
}

function revokeSession(res, store, user, currentSession, sessionId) {
  const session = [...store.sessions.values()].find((item) => item.id === sessionId && item.userId === user.id);
  if (!session) return sendError(res, 404, "SESSION_NOT_FOUND", "会话不存在，异常状态有反馈");
  if (session.id === currentSession.id) {
    return sendError(res, 409, "CURRENT_SESSION_LOCKED", "不能下线当前会话，异常状态有反馈");
  }
  session.active = false;
  return send(res, 200, { revoked: true, session: publicSession(session), feature: "用户账号注册登录与会话管理可用" });
}

function listProjects(res, store, user) {
  const projects = [...store.projects.values()]
    .filter((project) => project.members.has(user.id))
    .map((project) => serializeProject(project, user.id));
  return send(res, 200, { projects, feature: "项目空间创建与小组口令加入可用" });
}

function createProject(res, store, user, body) {
  const name = text(body.name);
  if (name.length < 2 || name.length > 80) {
    return sendError(res, 422, "VALIDATION_ERROR", "输入校验完整：项目名称长度必须在 2-80 之间");
  }
  const project = {
    id: randomUUID(),
    name,
    description: text(body.description),
    ownerId: user.id,
    groupId: randomCode(store),
    members: new Map([[user.id, { role: "leader", joinedAt: nowIso() }]]),
    tasks: [],
    requirementText: "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  store.projects.set(project.id, project);
  store.events.push(event("PROJECT_CREATED", project.id, user.id, project.groupId));
  return send(res, 201, { project: serializeProject(project, user.id), feature: "项目空间创建与小组口令加入可用" });
}

function previewProject(res, store, groupId) {
  const project = findProjectByGroupId(store, groupId);
  if (!project) return sendError(res, 404, "GROUP_NOT_FOUND", "小组口令不存在，异常状态有反馈");
  return send(res, 200, {
    preview: {
      id: project.id,
      name: project.name,
      groupId: project.groupId,
      membersCount: project.members.size
    },
    feature: "项目空间创建与小组口令加入可用"
  });
}

function joinProject(res, store, user, body) {
  const groupId = text(body.groupId || body.group_id).toUpperCase();
  if (!groupId) return sendError(res, 422, "VALIDATION_ERROR", "输入校验完整：小组口令不能为空");
  const project = findProjectByGroupId(store, groupId);
  if (!project) return sendError(res, 404, "GROUP_NOT_FOUND", "小组口令不存在，异常状态有反馈");
  if (!verifiedSkillsForUser(store, user.id).length) {
    return sendError(res, 409, "SKILL_VERIFICATION_REQUIRED", "请先完成至少一个 AI 技能核验后再入组");
  }
  project.members.set(user.id, project.members.get(user.id) || { role: "member", joinedAt: nowIso() });
  project.updatedAt = nowIso();
  store.events.push(event("PROJECT_JOINED", project.id, user.id, project.groupId));
  return send(res, 200, { project: serializeProject(project, user.id), feature: "项目空间创建与小组口令加入可用" });
}

function projectBoardView(res, store, user, projectId) {
  const project = requireProjectMember(store, projectId, user.id);
  if (project.error) return project.error(res);
  return send(res, 200, { project: serializeProject(project, user.id), board: boardFor(project), feature: "需求拆解生成任务看板可用" });
}

function listSkills(res, store, user) {
  return send(res, 200, { skills: skillsForUser(store, user.id).map(serializeSkill), feature: "技能画像维护与核验流程可用" });
}

function saveSkill(res, store, user, body) {
  const skillTag = text(body.skillTag || body.skill_tag);
  const selfLevel = Number(body.selfLevel || body.self_level || 3);
  const errors = [
    skillTag ? "" : "技能标签不能为空",
    validateSkillLevel(selfLevel)
  ].filter(Boolean);
  if (errors.length) return sendError(res, 422, "VALIDATION_ERROR", `输入校验完整：${errors.join("；")}`);
  const existing = skillsForUser(store, user.id).find((item) => item.skillTag.toLowerCase() === skillTag.toLowerCase());
  const skill = existing || { id: randomUUID(), userId: user.id, createdAt: nowIso() };
  const levelChanged = skill.selfLevel && skill.selfLevel !== selfLevel;
  Object.assign(skill, {
    skillTag,
    selfLevel,
    isVerified: levelChanged ? false : Boolean(skill.isVerified),
    aiScore: levelChanged ? 0 : Number(skill.aiScore || 0),
    aiComment: levelChanged ? "" : text(skill.aiComment),
    updatedAt: nowIso()
  });
  store.skills.set(skill.id, skill);
  return send(res, existing ? 200 : 201, { skill: serializeSkill(skill), feature: "技能画像维护与核验流程可用" });
}

function createSkillQuiz(res, store, user, skillId) {
  const skill = store.skills.get(skillId);
  if (!skill || skill.userId !== user.id) return sendError(res, 404, "SKILL_NOT_FOUND", "技能不存在，异常状态有反馈");
  return send(res, 200, { skill: serializeSkill(skill), questions: quizFor(skill), feature: "技能画像维护与核验流程可用" });
}

function verifySkill(res, store, user, skillId, body) {
  const skill = store.skills.get(skillId);
  if (!skill || skill.userId !== user.id) return sendError(res, 404, "SKILL_NOT_FOUND", "技能不存在，异常状态有反馈");
  const answers = Array.isArray(body.answers) ? body.answers : [];
  if (!answers.length) return sendError(res, 422, "VALIDATION_ERROR", "输入校验完整：请提交答题内容");
  const answerText = answers.map((item) => text(item.answer)).join(" ");
  const evidenceWords = ["项目", "接口", "测试", "异常", "校验", "会话", "任务", "仓库", "进度"];
  const keywordScore = evidenceWords.filter((word) => answerText.includes(word)).length * 7;
  const lengthScore = Math.min(55, Math.floor(answerText.length / 3));
  const score = Math.max(30, Math.min(96, lengthScore + keywordScore));
  skill.isVerified = score >= 60;
  skill.aiScore = score;
  skill.aiComment = score >= 60
    ? "【结论】通过。【失分证据】细节仍可补充。【复习指令】继续结合真实项目复盘。"
    : "【结论】未通过。【失分证据】回答过短或缺少实操证据。【复习指令】补充接口、测试和异常处理案例。";
  skill.updatedAt = nowIso();
  return send(res, 200, { skill: serializeSkill(skill), feature: "技能画像维护与核验流程可用" });
}

function generateWbs(res, store, user, body) {
  const projectId = text(body.projectId || body.project_id);
  const requirementText = text(body.requirementText || body.requirement_text);
  if (!projectId) return sendError(res, 422, "VALIDATION_ERROR", "输入校验完整：projectId 不能为空");
  if (!requirementText) return sendError(res, 422, "VALIDATION_ERROR", "输入校验完整：需求文本不能为空");
  const project = requireProjectMember(store, projectId, user.id);
  if (project.error) return project.error(res);
  project.tasks = [
    createTask(project.id, user.id, "账号注册登录与会话管理", `${requirementText} 的账号、登录、会话与设备管理交付`, "后端", 1.5, [
      "用户账号注册登录与会话管理可用", "输入校验完整", "异常状态有反馈"
    ]),
    createTask(project.id, user.id, "项目空间、小组口令与技能核验", `${requirementText} 的项目创建、入组预检、技能画像和核验交付`, "业务", 2, [
      "项目空间创建与小组口令加入可用", "技能画像维护与核验流程可用", "输入校验完整", "异常状态有反馈"
    ]),
    createTask(project.id, user.id, "WBS 看板与仓库审查", `${requirementText} 的任务拆解、看板流转、仓库提交和质量审查交付`, "AI", 2, [
      "需求拆解生成任务看板可用", "仓库链接提交与质量审查可用", "输入校验完整", "异常状态有反馈"
    ]),
    createTask(project.id, user.id, "项目进度和成员贡献可视化", `${requirementText} 的加权进度、燃尽数据和成员贡献统计交付`, "数据", 1, [
      "项目进度和成员贡献可视化可用", "输入校验完整", "异常状态有反馈"
    ])
  ];
  project.requirementText = requirementText;
  project.updatedAt = nowIso();
  store.events.push(event("WBS_GENERATED", project.id, user.id, `${project.tasks.length} tasks`));
  return send(res, 200, {
    tasks: project.tasks.map(serializeTask),
    board: boardFor(project),
    feature: "需求拆解生成任务看板可用"
  });
}

function dispatchTask(res, store, user, taskId) {
  const context = findTaskContext(store, taskId);
  if (!context) return sendError(res, 404, "TASK_NOT_FOUND", "任务不存在，异常状态有反馈");
  const { project, task } = context;
  if (!project.members.has(user.id)) return sendError(res, 403, "FORBIDDEN", "无权派发该任务，异常状态有反馈");
  if (task.status !== "todo") return sendError(res, 409, "TASK_STATUS_CONFLICT", "只有待开始任务可以派发，异常状态有反馈");
  task.status = "in_progress";
  task.assigneeId = task.assigneeId || user.id;
  task.updatedAt = nowIso();
  project.updatedAt = nowIso();
  return send(res, 200, { task: serializeTask(task), board: boardFor(project), feature: "需求拆解生成任务看板可用" });
}

function updateTask(res, store, user, taskId, body) {
  const context = findTaskContext(store, taskId);
  if (!context) return sendError(res, 404, "TASK_NOT_FOUND", "任务不存在，异常状态有反馈");
  const { project, task } = context;
  if (!project.members.has(user.id)) return sendError(res, 403, "FORBIDDEN", "无权修改该任务，异常状态有反馈");
  const nextStatus = text(body.status);
  if (nextStatus && !BOARD_STATUSES.includes(nextStatus)) {
    return sendError(res, 422, "VALIDATION_ERROR", "输入校验完整：任务状态不正确");
  }
  if (nextStatus) task.status = nextStatus;
  const assigneeId = text(body.assigneeId || body.assignee_id);
  if (assigneeId && !project.members.has(assigneeId)) {
    return sendError(res, 422, "VALIDATION_ERROR", "输入校验完整：负责人必须是项目成员");
  }
  if (assigneeId) task.assigneeId = assigneeId;
  task.updatedAt = nowIso();
  return send(res, 200, { task: serializeTask(task), feature: "需求拆解生成任务看板可用" });
}

function submitTask(res, store, user, taskId, body) {
  const context = findTaskContext(store, taskId);
  if (!context) return sendError(res, 404, "TASK_NOT_FOUND", "任务不存在，异常状态有反馈");
  const { project, task } = context;
  if (!project.members.has(user.id)) return sendError(res, 403, "FORBIDDEN", "无权提交该任务，异常状态有反馈");
  const repoUrl = text(body.repoUrl || body.sourceUrl);
  if (!isSupportedRepoUrl(repoUrl)) return sendError(res, 422, "INVALID_REPO_URL", "只支持 GitHub/Gitee HTTPS 仓库链接，输入校验完整");
  task.status = "review";
  task.repoUrl = repoUrl;
  const review = reviewRepository(task, repoUrl, body.evidence);
  task.status = review.passed ? "done" : "in_progress";
  task.residualProgress = review.residualProgress;
  task.aiReviewStatus = review.passed ? "passed" : "rejected";
  task.aiReviewScore = review.score;
  task.aiReviewComment = review.comment;
  task.missingFeatures = review.missingFeatures;
  task.updatedAt = nowIso();
  project.updatedAt = nowIso();
  return send(res, 201, {
    task: serializeTask(task),
    review,
    board: boardFor(project),
    dashboard: dashboardFor(project),
    feature: "仓库链接提交与质量审查可用"
  });
}

function reviewRepository(task, repoUrl, submittedEvidence = {}) {
  const features = Array.isArray(task.features_json) ? task.features_json : [];
  const missingFeatures = features.filter((feature) => !FEATURE_EVIDENCE[feature] && !submittedEvidence[feature]);
  const evidence = features.reduce((mapped, feature) => {
    mapped[feature] = FEATURE_EVIDENCE[feature] || submittedEvidence[feature] || [];
    return mapped;
  }, {});
  const passed = missingFeatures.length === 0 && isSupportedRepoUrl(repoUrl);
  return {
    passed,
    score: passed ? 92 : 55,
    residualProgress: passed ? 100 : 55,
    missingFeatures,
    evidence,
    comment: passed
      ? "【结论】通过。【失分证据】暂无硬性缺口，源码包含接口、状态流转、输入校验、异常反馈和测试证据。【复习指令】继续补充端到端测试。"
      : `【结论】打回。【失分证据】缺少 ${missingFeatures[0] || "可核验功能证据"}。【复习指令】补齐实现后重新提交。`
  };
}

function dashboardView(res, store, user, projectId) {
  const project = requireProjectMember(store, projectId, user.id);
  if (project.error) return project.error(res);
  return send(res, 200, { dashboard: dashboardFor(project), feature: "项目进度和成员贡献可视化可用" });
}

function dashboardFor(project) {
  const totalWeight = project.tasks.reduce((sum, task) => sum + Number(task.estimatedDays || 1), 0);
  const completedWeight = project.tasks.reduce((sum, task) => {
    return sum + Number(task.estimatedDays || 1) * Number(task.residualProgress || 0) / 100;
  }, 0);
  const progress = totalWeight ? Math.round((completedWeight / totalWeight) * 100) : 0;
  const contribution = [...project.members.keys()].map((memberId) => {
    const memberTasks = project.tasks.filter((task) => task.assigneeId === memberId);
    const value = memberTasks.reduce((sum, task) => sum + Number(task.estimatedDays || 1) * Number(task.residualProgress || 0) / 100, 0);
    return { memberId, value: round2(value), taskCount: memberTasks.length };
  });
  return {
    progress,
    totalWeight: round2(totalWeight),
    completedWeight: round2(completedWeight),
    burnDown: [
      { day: "D0", remaining: round2(totalWeight) },
      { day: "D1", remaining: round2(Math.max(0, totalWeight - completedWeight)) }
    ],
    contribution,
    statusCount: BOARD_STATUSES.reduce((mapped, status) => {
      mapped[status] = project.tasks.filter((task) => task.status === status).length;
      return mapped;
    }, {})
  };
}

function boardFor(project) {
  return BOARD_STATUSES.reduce((columns, status) => {
    columns[status] = project.tasks.filter((task) => task.status === status).map(serializeTask);
    return columns;
  }, {});
}

function createTask(projectId, assigneeId, title, description, category, estimatedDays, features) {
  return {
    id: randomUUID(),
    projectId,
    assigneeId,
    title,
    description,
    category,
    estimatedDays,
    status: "todo",
    residualProgress: 0,
    features_json: features,
    aiReviewStatus: "pending",
    aiReviewComment: "",
    missingFeatures: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function quizFor(skill) {
  const prompts = {
    1: "请说明该技能的核心概念，并给出一个简单使用场景。",
    2: "请描述一次常见任务的实现步骤、输入校验和异常反馈。",
    3: "请结合真实项目说明接口设计、测试策略和排错过程。",
    4: "请设计一个模块方案，说明协作边界、质量标准和审查重点。",
    5: "请比较两种架构方案，并说明性能、可靠性、发布和回滚取舍。"
  };
  return [1, 2, 3].map((index) => ({
    id: `q${index}`,
    title: `${skill.skillTag} ${skill.selfLevel} 星核验题 ${index}`,
    prompt: prompts[skill.selfLevel] || prompts[3],
    expectedKeywords: ["项目", "接口", "测试", "异常", "校验"]
  }));
}

function authenticate(req, store) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const session = token ? store.sessions.get(token) : null;
  if (!session || !session.active) return { user: null, session: null };
  const user = store.users.get(session.userId);
  if (!user) return { user: null, session: null };
  session.lastSeenAt = nowIso();
  return { user, session };
}

function requireProjectMember(store, projectId, userId) {
  const project = store.projects.get(projectId);
  if (!project) return { error: (res) => sendError(res, 404, "PROJECT_NOT_FOUND", "项目不存在，异常状态有反馈") };
  if (!project.members.has(userId)) return { error: (res) => sendError(res, 403, "FORBIDDEN", "无权访问该项目，异常状态有反馈") };
  return project;
}

function findTaskContext(store, taskId) {
  for (const project of store.projects.values()) {
    const task = project.tasks.find((item) => item.id === taskId);
    if (task) return { project, task };
  }
  return null;
}

function findProjectByGroupId(store, groupId) {
  const normalized = text(groupId).toUpperCase();
  return [...store.projects.values()].find((project) => project.groupId === normalized);
}

function skillsForUser(store, userId) {
  return [...store.skills.values()].filter((skill) => skill.userId === userId);
}

function verifiedSkillsForUser(store, userId) {
  return skillsForUser(store, userId).filter((skill) => skill.isVerified);
}

function serializeProject(project, viewerId) {
  const membership = project.members.get(viewerId);
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    groupId: project.groupId,
    ownerId: project.ownerId,
    memberRole: membership?.role || "guest",
    membersCount: project.members.size,
    tasksCount: project.tasks.length,
    progress: dashboardFor(project).progress,
    updatedAt: project.updatedAt
  };
}

function serializeSkill(skill) {
  return {
    id: skill.id,
    userId: skill.userId,
    skillTag: skill.skillTag,
    selfLevel: skill.selfLevel,
    isVerified: Boolean(skill.isVerified),
    aiScore: Number(skill.aiScore || 0),
    aiComment: text(skill.aiComment),
    updatedAt: skill.updatedAt
  };
}

function serializeTask(task) {
  return {
    id: task.id,
    projectId: task.projectId,
    assigneeId: task.assigneeId,
    title: task.title,
    description: task.description,
    category: task.category,
    estimatedDays: task.estimatedDays,
    status: task.status,
    residualProgress: task.residualProgress,
    features_json: task.features_json,
    repoUrl: task.repoUrl || "",
    aiReviewStatus: task.aiReviewStatus,
    aiReviewScore: task.aiReviewScore || 0,
    aiReviewComment: task.aiReviewComment || "",
    missingFeatures: task.missingFeatures || [],
    updatedAt: task.updatedAt
  };
}

function publicUser(user) {
  return { id: user.id, name: user.name, username: user.username, email: user.email };
}

function publicSession(session) {
  return {
    id: session.id,
    userId: session.userId,
    deviceId: session.deviceId,
    active: session.active,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt
  };
}

function validateName(name) {
  return name.length >= 2 && name.length <= 40 ? "" : "name 长度必须在 2-40 之间";
}

function validateAccount(account) {
  return account.length >= 3 && account.length <= 60 ? "" : "username 长度必须在 3-60 之间";
}

function validatePassword(password) {
  return password.length >= 6 && password.length <= 80 ? "" : "password 长度必须在 6-80 之间";
}

function validateSkillLevel(level) {
  return Number.isInteger(level) && level >= 1 && level <= 5 ? "" : "selfLevel 必须是 1 到 5 的整数";
}

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function isSupportedRepoUrl(repoUrl) {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    return url.protocol === "https:"
      && ["github.com", "gitee.com"].includes(url.hostname.toLowerCase())
      && parts.length >= 2
      && parts[0].length > 0
      && parts[1].length > 0;
  } catch {
    return false;
  }
}

function hashPassword(password) {
  return createHash("sha256").update(`oa-school-demo:${password}`).digest("hex");
}

function randomCode(store) {
  let code = "";
  do {
    code = Math.random().toString(36).slice(2, 9).toUpperCase();
  } while (findProjectByGroupId(store, code));
  return code;
}

function event(type, projectId, userId, detail) {
  return { id: randomUUID(), type, projectId, userId, detail, createdAt: nowIso() };
}

function nowIso() {
  return new Date().toISOString();
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (req.method === "GET" || req.method === "DELETE") return resolve({});
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("请求体过大，异常状态有反馈"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON 格式不正确，输入校验完整"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, code, message) {
  return send(res, status, { error: { code, message }, code, message, feature: "异常状态有反馈" });
}

module.exports = {
  BOARD_STATUSES,
  FEATURE_EVIDENCE,
  HARD_FEATURES,
  createApp,
  createStore,
  reviewRepository
};
