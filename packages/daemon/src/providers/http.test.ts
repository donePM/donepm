import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchHttp } from "./http.js";

interface Seen {
  method?: string;
  url?: string;
  contentType?: string;
  body: string;
}

describe("fetchHttp", () => {
  let server: Server;
  let base: string;
  const seen: Seen[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, contentType: req.headers["content-type"], body });
        if (req.url === "/never") return; // no answer: the client's timeout ends it
        res.writeHead(req.url === "/missing" ? 404 : 200, { "X-Rate": "5" });
        res.end(`answer to ${req.method} ${req.url}`);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends JSON bodies as JSON and returns status, lower-case headers and body", async () => {
    const r = await fetchHttp({ method: "POST", url: `${base}/issues?x=1`, body: { title: "Hi" } });
    expect(r.status).toBe(200);
    expect(r.headers["x-rate"]).toBe("5");
    expect(r.body).toBe("answer to POST /issues?x=1");
    expect(seen.at(-1)).toEqual({ method: "POST", url: "/issues?x=1", contentType: "application/json", body: '{"title":"Hi"}' });
  });

  it("returns an error status as an answer, not a throw", async () => {
    expect((await fetchHttp({ method: "GET", url: `${base}/missing` })).status).toBe(404);
  });

  it("gives status 0 with the reason when no answer comes", async () => {
    const r = await fetchHttp({ method: "GET", url: `${base}/never`, timeoutMs: 50 });
    expect(r.status).toBe(0);
    expect(r.body).not.toBe("");
  });
});
