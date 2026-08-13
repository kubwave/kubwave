# AI pull request review

An on-demand AI reviewer that runs [opencode](https://opencode.ai) against a pull request and posts its findings as a single sticky comment. It never runs by itself, never blocks a merge, and never gets write access to anything.

This directory is self-contained. To add the same reviewer to another repository, copy these three files and change the prompt.

| File                              | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `.github/workflows/ai-review.yml` | Triggers, checkout, the opencode run, and the sticky comment             |
| `.github/ai-review/prompt.md`     | What the reviewer looks for, and the exact output format it must produce |
| `.github/ai-review/opencode.json` | Read-only permissions and disabled session sharing                       |

## Install

### 1. Get a model API key

Any provider opencode supports works. With an [opencode Go](https://opencode.ai/go) or [Zen](https://opencode.ai/docs/zen/) subscription, copy the API key from the opencode dashboard — the same key covers both, and the provider prefix in the model name decides which one is used.

### 2. Add the repository secret

**Settings → Secrets and variables → Actions → Secrets → New repository secret**

| Secret              | Required                      | Value                          |
| ------------------- | ----------------------------- | ------------------------------ |
| `OPENCODE_API_KEY`  | yes, for opencode             | Your opencode Go / Zen API key |
| `ANTHROPIC_API_KEY` | only for `anthropic/*` models | Anthropic API key              |
| `OPENAI_API_KEY`    | only for `openai/*` models    | OpenAI API key                 |

Nothing else needs configuring — `GITHUB_TOKEN` is provided automatically.

### 3. Choose the model (optional)

**Settings → Secrets and variables → Actions → Variables → New repository variable**

| Variable          | Default               | Value                                             |
| ----------------- | --------------------- | ------------------------------------------------- |
| `AI_REVIEW_MODEL` | `opencode-go/kimi-k3` | `provider/model`, e.g. `opencode-go/gpt-5.6-luna` |

The value is a single `provider/model` string, so **it selects the provider as well as the model**. Switching providers means changing this variable and adding that provider's API key secret:

```
opencode-go/kimi-k3               # opencode Go subscription
opencode/claude-opus-4-8          # opencode Zen, pay as you go
anthropic/claude-sonnet-4-5       # direct, needs ANTHROPIC_API_KEY
openai/gpt-5.6                    # direct, needs OPENAI_API_KEY
```

The full model list is at [models.dev](https://models.dev). Pick one with a large context window and tool support — the reviewer reads files, so both matter.

A **secret** named `AI_REVIEW_MODEL` also works and takes precedence over the default, which is useful if you would rather not expose the model name. A variable is the better choice otherwise: secrets are masked as `***` in run logs, so you lose the ability to see which model actually ran.

### 4. Create the label

**Issues → Labels → New label**, named exactly `ai-review`. Colour and description are up to you.

### 5. Verify

Open a small throwaway pull request and add the `ai-review` label. Within a few minutes a comment should appear. If it does not, check **Actions → AI review** for the run.

## Usage

Two ways to trigger a review, both manual:

- Add the **`ai-review` label** to a pull request.
- Comment **`/ai-review`** on a pull request.

Re-triggering updates the existing comment instead of posting a new one. Removing and re-adding the label runs it again.

The comment path is restricted to users with `OWNER`, `MEMBER`, or `COLLABORATOR` association. The label path needs no extra check, because applying a label already requires write access.

## Adapting it to another repository

Only `prompt.md` is project-specific. Rewrite these parts of it:

1. **The opening line** — what the project is, in one sentence.
2. **The conventions file** — this repo points the reviewer at `AGENTS.md`. Point yours at `CONTRIBUTING.md`, `CLAUDE.md`, or whatever holds your rules. Drop the line if there is nothing to point at.
3. **The "What to review" list** — replace the project-specific convention violations with your own. Keep the generic categories (correctness, security, missing tests, simplification).

Leave the **Output** section alone. The workflow extracts everything between `<<<REVIEW>>>` and `<<<END>>>` and posts it verbatim, so changing the markers means changing the workflow too.

In `ai-review.yml`, the only values worth revisiting are `BUN_VERSION`, `OPENCODE_VERSION` (both pinned on purpose), and `timeout-minutes`.

## How it works

1. `pull_request_target` (on `labeled`) and `issue_comment` both run in the context of the **base** branch. That is the only way the workflow can read repository secrets, including on pull requests from forks.
2. The base branch is checked out first, and `.github/ai-review/` is copied to a temp directory. Everything after this point uses that trusted copy.
3. The pull request revision is then checked out — preferring `refs/pull/<n>/merge`, which is the merged result, and falling back to `refs/pull/<n>/head` when the pull request has conflicts. The diff is taken against the merge parent or the merge base respectively.
4. opencode runs over the checkout with the diff attached, and prints its review to stdout.
5. The block between the markers is extracted and posted as a comment carrying the `<!-- ai-review -->` marker, updating the existing one if present.

## Security

A pull request can contain hostile content, and the reviewer reads it. The precautions, in the order they matter:

- **No write access anywhere.** `opencode.json` denies `edit`, `bash`, and `webfetch`. The reviewer can read, grep, and glob, and nothing else. Denying `webfetch` in particular means it cannot exfiltrate what it reads.
- **No git credentials.** The checkout uses `persist-credentials: false`, so no token is left on disk for the reviewer to find.
- **The pull request cannot rewrite its own review rules.** The prompt and config are staged from the base branch before the pull request revision is checked out.
- **No plugins from the pull request.** The run passes `--pure`, and any `opencode.json`, `opencode.jsonc`, or `.opencode/` shipped by the pull request is deleted before the run, so it cannot re-grant the permissions above.
- **No registry hijacking.** `bunx` runs from the runner temp directory, so a `bunfig.toml` in the pull request cannot redirect where the opencode package is downloaded from.
- **Session sharing off.** `"share": "disabled"` keeps review sessions from being published to opencode.ai.

What remains is prompt injection: a pull request can include text that tries to talk the reviewer into a misleading verdict. Since the reviewer can only produce a comment, the worst case is a wrong review — treat the output as advice, not as a gate.

## Cost

Each run is one agent session over the diff plus whatever files it reads. Larger diffs and larger models cost more; diffs above 400 KB are truncated. The trigger is manual precisely so the spend stays deliberate — if you switch it to run automatically on every push, expect a multiple of that.

## Troubleshooting

**The workflow does not start.** Both triggers must exist on the **default branch** — GitHub ignores `pull_request_target` and `issue_comment` workflows that only exist on a feature branch.

**The comment says the review did not complete.** Open the run. The usual causes are a missing or expired `OPENCODE_API_KEY`, a model name that does not exist for that provider, or the 15-minute timeout on a very large diff.

**The comment holds raw opencode output.** The model did not emit the markers. Re-run it; if it keeps happening, the model is too weak to follow the output contract — switch `AI_REVIEW_MODEL` to a stronger one.

**Nothing happens on a fork pull request.** Check that the trigger was a label or a comment from someone with write access. Fork pull requests are supported, but only a collaborator can start the review.
