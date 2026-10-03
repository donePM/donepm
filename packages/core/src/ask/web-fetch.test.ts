import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_FETCH_DOMAINS, isDomain, matchingDomain, webFetchHost } from "./web-fetch.js";

describe("webFetchHost", () => {
  it("reads the host of an http(s) URL, lower case", () => {
    expect(webFetchHost({ url: "https://GitHub.com/actions/checkout/releases", prompt: "x" })).toBe("github.com");
    expect(webFetchHost({ url: "http://nodejs.org/en" })).toBe("nodejs.org");
  });

  it("has no host for other schemes, credentials in the URL, or bad input", () => {
    expect(webFetchHost({ url: "file:///etc/passwd" })).toBeUndefined();
    expect(webFetchHost({ url: "https://user:pw@github.com/" })).toBeUndefined();
    expect(webFetchHost({ url: "not a url" })).toBeUndefined();
    expect(webFetchHost({})).toBeUndefined();
    expect(webFetchHost(null)).toBeUndefined();
  });
});

describe("matchingDomain", () => {
  it("matches the domain and its subdomains", () => {
    expect(matchingDomain("github.com", ["github.com"])).toBe("github.com");
    expect(matchingDomain("api.github.com", ["github.com"])).toBe("github.com");
  });

  it("does not match a look-alike or a parent domain", () => {
    expect(matchingDomain("evilgithub.com", ["github.com"])).toBeUndefined();
    expect(matchingDomain("github.com.evil.io", ["github.com"])).toBeUndefined();
    expect(matchingDomain("github.com", ["docs.github.com"])).toBeUndefined();
  });

  it("matches nothing with an empty list", () => {
    expect(matchingDomain("github.com", [])).toBeUndefined();
  });
});

describe("isDomain", () => {
  it("accepts bare host names", () => {
    for (const d of DEFAULT_WEB_FETCH_DOMAINS) expect(isDomain(d)).toBe(true);
  });

  it("rejects schemes, paths, ports, wildcards and upper case", () => {
    for (const d of ["https://github.com", "github.com/x", "github.com:443", "*.github.com", "GitHub.com", "localhost", ""]) {
      expect(isDomain(d)).toBe(false);
    }
  });
});
