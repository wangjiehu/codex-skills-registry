const DEFAULT_MARKER = "<!-- codex-skills-registry -->";
/**
 * Creates or updates a pull request issue comment with a stable marker.
 *
 * @param options - GitHub API and comment options.
 * @returns Publish result, including skip reasons when context is incomplete.
 */
export async function publishPullRequestComment(options) {
    const token = options.token;
    const repository = options.repository;
    const pullRequestNumber = options.pullRequestNumber;
    const apiUrl = options.apiUrl ?? "https://api.github.com";
    const marker = normalizeCommentMarker(options.marker);
    if (!token) {
        return { posted: false, updated: false, skippedReason: "GITHUB_TOKEN is not set." };
    }
    if (!repository) {
        return { posted: false, updated: false, skippedReason: "GitHub repository is not set." };
    }
    if (!pullRequestNumber) {
        return {
            posted: false,
            updated: false,
            skippedReason: "Pull request number is not available for this event.",
        };
    }
    const body = withCommentMarker(options.body, marker);
    const commentsPath = `/repos/${repository}/issues/${pullRequestNumber}/comments`;
    const viewerLogin = await resolveViewerLogin(apiUrl, token);
    const existing = await findMarkerComment(apiUrl, commentsPath, token, marker, viewerLogin);
    if (existing) {
        const updated = await githubRequest(apiUrl, `/repos/${repository}/issues/comments/${existing.id}`, token, {
            method: "PATCH",
            body: JSON.stringify({ body }),
        });
        return {
            posted: true,
            updated: true,
            url: updated.html_url ?? existing.html_url,
        };
    }
    const created = await githubRequest(apiUrl, commentsPath, token, {
        method: "POST",
        body: JSON.stringify({ body }),
    });
    return {
        posted: true,
        updated: false,
        url: created.html_url,
    };
}
function withCommentMarker(body, marker) {
    return body.includes(marker) ? body : `${marker}\n${body}`;
}
function normalizeCommentMarker(marker) {
    return marker && marker.trim().length > 0 ? marker : DEFAULT_MARKER;
}
/**
 * Resolves the login that authors comments created with this token. Any PR
 * participant can paste the hidden marker into their own comment, so the
 * marker alone must never select the comment to update.
 */
async function resolveViewerLogin(apiUrl, token) {
    try {
        const user = await githubRequest(apiUrl, "/user", token);
        if (typeof user.login === "string" && user.login.length > 0) {
            return user.login;
        }
    }
    catch {
        // GITHUB_TOKEN installation tokens cannot call /user; comments created
        // with them are authored by github-actions[bot].
    }
    return "github-actions[bot]";
}
async function findMarkerComment(apiUrl, commentsPath, token, marker, viewerLogin) {
    for (let page = 1;; page += 1) {
        const pageComments = await githubRequest(apiUrl, `${commentsPath}?per_page=100&page=${page}`, token);
        const match = pageComments.find((comment) => comment.body?.includes(marker) && comment.user?.login === viewerLogin);
        if (match) {
            return match;
        }
        if (pageComments.length < 100) {
            return undefined;
        }
    }
}
async function githubRequest(apiUrl, path, token, init = {}) {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            ...(init.headers ?? {}),
        },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`GitHub API request failed with ${response.status}: ${text.slice(0, 500)}`);
    }
    return (await response.json());
}
//# sourceMappingURL=github-comment.js.map