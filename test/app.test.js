const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp } = require("../src/app");

test("covers the AI review smoke flow", async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const registered = await request(baseUrl, "POST", "/auth/register", {
      name: "Test User",
      email: "test@example.com",
      password: "secret123"
    });
    assert.equal(registered.status, 201);

    const loggedIn = await request(baseUrl, "POST", "/auth/login", {
      email: "test@example.com",
      password: "secret123"
    });
    assert.equal(loggedIn.status, 200);
    const token = loggedIn.body.token;

    const project = await request(baseUrl, "POST", "/projects", { name: "AI Review Demo" }, token);
    assert.equal(project.status, 201);
    assert.match(project.body.project.groupId, /^[A-Z0-9]+$/);

    const skill = await request(baseUrl, "POST", "/skills", { skillTag: "后端", selfLevel: 4 }, token);
    assert.equal(skill.status, 201);

    const verified = await request(baseUrl, "POST", `/skills/${skill.body.skill.id}/verify`, {
      answers: [{ answer: "我能结合真实项目说明接口设计、输入校验、异常状态反馈和测试策略。" }]
    }, token);
    assert.equal(verified.status, 200);
    assert.equal(verified.body.skill.isVerified, true);

    const wbs = await request(baseUrl, "POST", "/ai/wbs-generate", {
      requirementText: "校园小组协同 OA"
    }, token);
    assert.equal(wbs.status, 200);
    assert.ok(wbs.body.tasks[0].features_json.includes("输入校验完整"));

    const submitted = await request(baseUrl, "POST", `/tasks/${wbs.body.tasks[0].id}/submit`, {
      repoUrl: "https://github.com/example/oa-school-ai-review-test-repo"
    }, token);
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.review.passed, true);

    const dashboard = await request(baseUrl, "GET", `/dashboard/${project.body.project.id}`, null, token);
    assert.equal(dashboard.status, 200);
    assert.equal(typeof dashboard.body.progress, "number");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

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
