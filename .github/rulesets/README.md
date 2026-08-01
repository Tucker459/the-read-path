# Branch protection

`main.json` is the ruleset protecting the default branch. It is kept in the
repository so the protection is reviewable and restorable rather than living
only in the settings UI.

## Applying it

```sh
gh api --method POST /repos/Tucker459/the-read-path/rulesets \
  --input .github/rulesets/main.json
```

To update an existing ruleset, find its id and `PUT` instead:

```sh
gh api /repos/Tucker459/the-read-path/rulesets --jq '.[] | "\(.id)\t\(.name)"'
gh api --method PUT /repos/Tucker459/the-read-path/rulesets/RULESET_ID \
  --input .github/rulesets/main.json
```

Or paste the same rules in **Settings → Rules → Rulesets → New ruleset**.

## What each rule does

| Rule | Effect |
| --- | --- |
| `deletion` | `main` cannot be deleted. |
| `non_fast_forward` | No force pushes. History on `main` cannot be rewritten. |
| `pull_request` | No direct commits to `main`. Everything arrives through a PR. |
| `required_status_checks` | The `check` job must pass before merge. |

`strict_required_status_checks_policy` requires a branch to be up to date with
`main` before merging, so the checks that passed are the checks for the code
that will actually land.

## Why zero required approvals

GitHub will not let you approve your own pull request. On a solo repository,
`required_approving_review_count: 1` is unmergeable-by-construction — every PR
would need a second person who does not exist.

Zero approvals still requires the pull request itself, so nothing reaches `main`
without CI passing and without a diff you had the chance to read. Raise this the
moment a second contributor appears.

## Why no bypass actors

`bypass_actors` is deliberately empty. On a repository where you are the only
admin, adding the admin role as a bypass would exempt you from every rule above
— which is to say, from all of them.

These rules exist to catch accidents, not to constrain an adversary. If one ever
genuinely blocks you, disable the ruleset in the settings UI, do the thing, and
turn it back on. That is a deliberate act; a bypass is a silent one.

## Note on the required check name

`check` is the job name in `.github/workflows/deploy.yml`. Renaming that job
without updating this file leaves a required check that can never report, and
every pull request will block forever waiting for it.
