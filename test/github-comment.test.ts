import { afterEach, describe, expect, it, vi } from "vitest";
import { publishPullRequestComment } from "../src/github-comment.js";

describe("github comment publishing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes empty markers to avoid updating unrelated comments", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({
          id: 2,
          body: String(init.body),
          html_url: "https://example.com/new",
        });
      }

      return jsonResponse([
        { id: 1, body: "unrelated comment", html_url: "https://example.com/old" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishPullRequestComment({
      body: "summary",
      token: "token",
      repository: "owner/repo",
      pullRequestNumber: 12,
      marker: "",
    });

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");

    expect(result.updated).toBe(false);
    expect(patchCall).toBeUndefined();
    expect(postCall).toBeDefined();
    expect(String(postCall?.[1]?.body)).toContain("<!-- codex-skills-registry -->");
  });

  it("searches paginated comments before creating a new one", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated comment",
      user: { login: "someone" },
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        return jsonResponse({ id: 200, html_url: "https://example.com/updated" });
      }
      if (new URL(url).pathname === "/user") {
        return new Response("forbidden", { status: 403 });
      }
      if (new URL(url).searchParams.get("page") === "1") {
        return jsonResponse(firstPage);
      }

      return jsonResponse([
        {
          id: 200,
          body: "<!-- codex-skills-registry -->\nold summary",
          html_url: "https://example.com/old",
          user: { login: "github-actions[bot]" },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishPullRequestComment({
      body: "new summary",
      token: "token",
      repository: "owner/repo",
      pullRequestNumber: 12,
    });

    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");

    expect(requestedUrls.some((url) => url.includes("page=2"))).toBe(true);
    expect(String(patchCall?.[0])).toContain("/issues/comments/200");
    expect(result.updated).toBe(true);
  });

  it("ignores marker comments from other authors instead of updating them", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        return jsonResponse({ id: 300, html_url: "https://example.com/new" });
      }
      if (new URL(url).pathname === "/user") {
        return new Response("forbidden", { status: 403 });
      }

      return jsonResponse([
        {
          id: 66,
          body: "<!-- codex-skills-registry -->\nspoofed summary",
          html_url: "https://example.com/spoofed",
          user: { login: "attacker" },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishPullRequestComment({
      body: "real summary",
      token: "token",
      repository: "owner/repo",
      pullRequestNumber: 12,
    });

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");

    expect(patchCall).toBeUndefined();
    expect(postCall).toBeDefined();
    expect(result.updated).toBe(false);
    expect(result.posted).toBe(true);
  });

  it("updates marker comments authored by the token identity", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        return jsonResponse({ id: 42, html_url: "https://example.com/updated" });
      }
      if (new URL(url).pathname === "/user") {
        return jsonResponse({ login: "release-bot" });
      }

      return jsonResponse([
        {
          id: 41,
          body: "<!-- codex-skills-registry -->\nspoofed summary",
          html_url: "https://example.com/spoofed",
          user: { login: "attacker" },
        },
        {
          id: 42,
          body: "<!-- codex-skills-registry -->\nold summary",
          html_url: "https://example.com/old",
          user: { login: "release-bot" },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishPullRequestComment({
      body: "new summary",
      token: "token",
      repository: "owner/repo",
      pullRequestNumber: 12,
    });

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");

    expect(String(patchCall?.[0])).toContain("/issues/comments/42");
    expect(result.updated).toBe(true);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json",
    },
  });
}
