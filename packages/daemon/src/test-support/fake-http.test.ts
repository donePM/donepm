import { describe, expect, it } from "vitest";
import { fakeHttp, json, status } from "./fake-http.js";

describe("fakeHttp", () => {
  it("answers the longest matching route and records method, path and body", async () => {
    const http = fakeHttp({
      "GET /repos/acme": json({ which: "repos" }),
      "GET /repos/acme/widgets/issues": json([{ number: 7 }]),
      "POST /repos/acme/widgets/issues/7/comments": (r) => json({ echoed: r.body }, 201),
    });
    expect((await http({ method: "GET", url: "https://api.acme.test/repos/acme/widgets/issues?state=open" })).body).toBe('[{"number":7}]');
    const posted = await http({ method: "POST", url: "https://api.acme.test/repos/acme/widgets/issues/7/comments", body: { body: "Hi" } });
    expect(posted).toEqual({ status: 201, headers: { "content-type": "application/json" }, body: '{"echoed":{"body":"Hi"}}' });
    expect((await http({ method: "GET", url: "https://api.acme.test/repos/acme/other" })).body).toBe('{"which":"repos"}');
    expect(http.requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "GET", path: "/repos/acme/widgets/issues?state=open", body: undefined },
      { method: "POST", path: "/repos/acme/widgets/issues/7/comments", body: { body: "Hi" } },
      { method: "GET", path: "/repos/acme/other", body: undefined },
    ]);
  });

  it("matches a prefix only at a path boundary", async () => {
    const http = fakeHttp({ "GET /repos/acme/widgets": status(204) });
    expect((await http({ method: "GET", url: "https://api.acme.test/repos/acme/widgets-two" })).status).toBe(404);
    expect((await http({ method: "POST", url: "https://api.acme.test/repos/acme/widgets" })).status).toBe(404);
  });

  it("records headers with lower-case names, so a test can see the token was sent", async () => {
    const http = fakeHttp({});
    const r = await http({ method: "GET", url: "https://api.acme.test/user", headers: { Authorization: "Bearer t0k" } });
    expect(r).toEqual({ status: 404, headers: {}, body: "fake: no route for GET /user" });
    expect(http.requests[0]).toMatchObject({ host: "api.acme.test", headers: { authorization: "Bearer t0k" } });
  });
});
