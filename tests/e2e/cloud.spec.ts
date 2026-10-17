import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("作者注册、revision 冲突、所有权隔离、匿名快照读取与撤回", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("已保存至本地");
  const p = await page.evaluate(async () => {
    const id = localStorage.getItem("hovercv:last");
    if (!id) throw Error("未保存项目");
    return new Promise<any>((resolve, reject) => {
      const req = indexedDB.open("hovercv");
      req.onsuccess = () => {
        const get = req.result
          .transaction("projects")
          .objectStore("projects")
          .get(id);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      };
    });
  });
  const credentials = {
    name: "测试作者",
    email: `author-${randomUUID()}@example.com`,
    password: randomUUID() + randomUUID(),
  };
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: credentials,
    headers: { Origin: "http://localhost:3000" },
  });
  expect(signup.status(), await signup.text()).toBe(200);
  const save = await page.request.put("/api/projects/" + p.id, {
    data: p,
    headers: { Origin: "http://localhost:3000" },
  });
  expect(save.status(), await save.text()).toBe(200);
  const { revision } = await save.json();
  expect(revision).toBe(1);
  const conflict = await page.request.put("/api/projects/" + p.id, {
    data: p,
    headers: { Origin: "http://localhost:3000" },
  });
  expect(conflict.status()).toBe(409);
  const pub = await page.request.post("/api/publish/" + p.id, {
    data: { revision },
    headers: { Origin: "http://localhost:3000" },
  });
  expect(pub.status(), await pub.text()).toBe(200);
  const { id } = await pub.json();
  const anonymous = await browser.newContext();
  const reader = await anonymous.newPage();
  expect((await anonymous.cookies()).length).toBe(0);
  const privateRead = await anonymous.request.get("/api/projects/" + p.id);
  expect(privateRead.status()).toBe(401);
  const errors: string[] = [];
  reader.on("pageerror", (e) => errors.push(e.message));
  await reader.goto("/read/" + id);
  const frame = reader.frameLocator("iframe");
  await expect(frame.locator(".hotspot")).toHaveCount(3);
  await expect(frame.locator(".page>img")).toHaveJSProperty("complete", true);
  await frame.locator(".hotspot").first().hover();
  await expect(frame.locator("#card")).toBeVisible();
  await frame.locator("#card").getByRole("button", { name: "下一张" }).click();
  await expect(frame.locator("#card nav")).toContainText("2 / 3");
  expect(errors).toEqual([]);
  // Publishing is immutable: editing the cloud draft doesn't mutate its older public snapshot.
  const changed = { ...p, revision, name: "已经修改的草稿" };
  const update = await page.request.put("/api/projects/" + p.id, {
    data: changed,
    headers: { Origin: "http://localhost:3000" },
  });
  expect(update.status(), await update.text()).toBe(200);
  const snap = await anonymous.request.get("/api/read/" + id);
  expect(await snap.text()).not.toContain("已经修改的草稿");
  // Another authenticated author cannot read or overwrite this project.
  const outsider = await browser.newContext();
  const otherSignup = await outsider.request.post("/api/auth/sign-up/email", {
    data: { ...credentials, email: `other-${randomUUID()}@example.com` },
    headers: { Origin: "http://localhost:3000" },
  });
  expect(otherSignup.status()).toBe(200);
  expect((await outsider.request.get("/api/projects/" + p.id)).status()).toBe(
    404,
  );
  expect(
    (
      await outsider.request.put("/api/projects/" + p.id, {
        data: { ...p, revision: 2 },
        headers: { Origin: "http://localhost:3000" },
      })
    ).status(),
  ).toBe(404);
  await outsider.close();
  const revoke = await page.request.delete(
    "/api/publish/" + p.id + "?snapshot=" + id,
    { headers: { Origin: "http://localhost:3000" } },
  );
  expect(revoke.status()).toBe(200);
  expect((await anonymous.request.get("/api/read/" + id)).status()).toBe(404);
  await reader.reload();
  await expect(reader.getByText("这份简历暂时无法阅读")).toBeVisible();
  await anonymous.close();
});
