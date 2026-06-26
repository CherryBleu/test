const assert = require("node:assert/strict");
const test = require("node:test");
const { HARD_FEATURES, createApp, reviewRepository } = require("../src/app");

test("covers README hard features with executable evidence", async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const health = await request(baseUrl, "GET", "/health");
    assert.equal(health.status, 200);
    for (const feature of HARD_FEATURES) {
      assert.ok(health.body.features.includes(feature));
      assert.ok(Array.isArray(health.body.evidence[feature]));
      assert.ok(health.body.evidence[feature].length > 0);
    }

    const invalidRegister = await request(baseUrl, "POST", "/auth/register", {
      name: "A",
      username: "x",
      password: "123"
    });
    assert.equal(invalidRegister.status, 422);
    assert.equal(invalidRegister.body.code, "VALIDATION_ERROR");
    assert.match(invalidRegister.body.message, /输入校验完整/);

    const leader = await registerAndLogin(baseUrl, {
      name: "Leader User",
      username: "leader01",
      email: "leader@example.com",
      password: "secret123",
      deviceId: "leader-laptop"
    });

    const secondLogin = await request(baseUrl, "POST", "/auth/login", {
      username: "leader01",
      password: "secret123",
      deviceId: "leader-phone"
    });
    assert.equal(secondLogin.status, 200);

    const sessions = await request(baseUrl, "GET", "/auth/sessions", null, leader.token);
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.sessions.length, 2);
    const otherSession = sessions.body.sessions.find((item) => item.id !== leader.session.id);
    const revoked = await request(baseUrl, "DELETE", `/auth/sessions/${otherSession.id}`, null, leader.token);
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.revoked, true);

    const project = await request(baseUrl, "POST", "/projects", {
      name: "AI Review Demo",
      description: "校园小组协同 OA"
    }, leader.token);
    assert.equal(project.status, 201);
    assert.match(project.body.project.groupId, /^[A-Z0-9]+$/);

    const preview = await request(baseUrl, "GET", `/projects/info/${project.body.project.groupId}`, null, leader.token);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.preview.name, "AI Review Demo");

    const member = await registerAndLogin(baseUrl, {
      name: "Member User",
      username: "member01",
      email: "member@example.com",
      password: "secret123",
      deviceId: "member-laptop"
    });

    const blockedJoin = await request(baseUrl, "POST", "/projects/join", {
      groupId: project.body.project.groupId
    }, member.token);
    assert.equal(blockedJoin.status, 409);
    assert.equal(blockedJoin.body.code, "SKILL_VERIFICATION_REQUIRED");

    const skill = await request(baseUrl, "POST", "/skills", { skillTag: "后端", selfLevel: 4 }, member.token);
    assert.equal(skill.status, 201);

    const quiz = await request(baseUrl, "POST", `/skills/${skill.body.skill.id}/quiz`, null, member.token);
    assert.equal(quiz.status, 200);
    assert.equal(quiz.body.questions.length, 3);
    assert.match(quiz.body.questions[0].title, /4 星/);

    const verified = await request(baseUrl, "POST", `/skills/${skill.body.skill.id}/verify`, {
      answers: [
        {
          answer: "我能结合真实项目说明接口设计、输入校验、异常状态反馈、会话管理、任务看板、仓库审查、进度统计和自动化测试策略。"
        }
      ]
    }, member.token);
    assert.equal(verified.status, 200);
    assert.equal(verified.body.skill.isVerified, true);

    const joined = await request(baseUrl, "POST", "/projects/join", {
      groupId: project.body.project.groupId
    }, member.token);
    assert.equal(joined.status, 200);
    assert.equal(joined.body.project.membersCount, 2);

    const wbs = await request(baseUrl, "POST", "/ai/wbs-generate", {
      projectId: project.body.project.id,
      requirementText: "校园小组协同 OA"
    }, leader.token);
    assert.equal(wbs.status, 200);
    assert.equal(wbs.body.tasks.length, 4);
    assert.ok(wbs.body.tasks.some((task) => task.features_json.includes("仓库链接提交与质量审查可用")));

    const board = await request(baseUrl, "GET", `/projects/${project.body.project.id}/board`, null, leader.token);
    assert.equal(board.status, 200);
    assert.equal(board.body.board.todo.length, 4);

    const reviewTask = wbs.body.tasks.find((task) => task.features_json.includes("仓库链接提交与质量审查可用"));
    const dispatched = await request(baseUrl, "POST", `/tasks/${reviewTask.id}/dispatch`, null, leader.token);
    assert.equal(dispatched.status, 200);
    assert.equal(dispatched.body.task.status, "in_progress");

    const badRepo = await request(baseUrl, "POST", `/tasks/${reviewTask.id}/submit`, {
      repoUrl: "ftp://example.com/bad"
    }, leader.token);
    assert.equal(badRepo.status, 422);
    assert.equal(badRepo.body.code, "INVALID_REPO_URL");

    const submitted = await request(baseUrl, "POST", `/tasks/${reviewTask.id}/submit`, {
      repoUrl: "https://github.com/example/oa-school-ai-review-test-repo"
    }, leader.token);
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.review.passed, true);
    assert.equal(submitted.body.task.status, "done");
    assert.equal(submitted.body.task.residualProgress, 100);
    assert.ok(submitted.body.review.evidence["仓库链接提交与质量审查可用"].length > 0);

    const dashboard = await request(baseUrl, "GET", `/dashboard/${project.body.project.id}`, null, leader.token);
    assert.equal(dashboard.status, 200);
    assert.equal(typeof dashboard.body.dashboard.progress, "number");
    assert.ok(dashboard.body.dashboard.progress > 0);
    assert.ok(Array.isArray(dashboard.body.dashboard.burnDown));
    assert.ok(Array.isArray(dashboard.body.dashboard.contribution));

    const directReview = reviewRepository({
      features_json: HARD_FEATURES
    }, "https://github.com/example/oa-school-ai-review-test-repo");
    assert.equal(directReview.passed, true);
    assert.equal(directReview.missingFeatures.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function registerAndLogin(baseUrl, user) {
  const registered = await request(baseUrl, "POST", "/auth/register", user);
  assert.equal(registered.status, 201);

  const loggedIn = await request(baseUrl, "POST", "/auth/login", {
    username: user.username,
    password: user.password,
    deviceId: user.deviceId
  });
  assert.equal(loggedIn.status, 200);
  return {
    user: loggedIn.body.user,
    token: loggedIn.body.token,
    session: loggedIn.body.session
  };
}

async function request(baseUrl, method, path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body == null ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}
