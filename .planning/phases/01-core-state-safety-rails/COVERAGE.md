# API Coverage — GitHub REST/GraphQL (as the Warden's App and the maintainer's gh login)

> Full coverage by default. Opt-outs are explicit, reasoned decisions. Scope: the GitHub capabilities the Warden's state layer touches in Phase 1.

| capability | decision | reason |
|---|---|---|
| repo-contents-read | INTEGRATE | |
| labels-list | INTEGRATE | |
| labels-create | INTEGRATE | |
| issue-labels-add | INTEGRATE | |
| issue-labels-remove | INTEGRATE | |
| issue-labels-replace-all | OPT-OUT | explicitly out of scope: STATE-06 forbids replacing the whole label set |
| issue-comments-list | INTEGRATE | |
| issue-comments-create | INTEGRATE | |
| issue-comments-update | INTEGRATE | |
| issue-comments-delete | INTEGRATE | |
| pull-reviews-list | INTEGRATE | |
| pull-reviews-create | OPT-OUT | not needed yet: COMMENT reviews are posted from Phase 4 (REV-07) |
| pull-review-approve | OPT-OUT | explicitly out of scope: the Warden never approves (GATE-04) |
| pull-merge | OPT-OUT | explicitly out of scope: the Warden never merges (GATE-04) |
| graphql-open-items-timeline | INTEGRATE | |
| users-lookup | INTEGRATE | |
| app-manifest-conversion | INTEGRATE | |
| app-installation-lookup | INTEGRATE | |
| app-installation-tokens | INTEGRATE | |
| actions-variables-read | INTEGRATE | |
| actions-environments-write | INTEGRATE | |
| actions-environment-secrets-write | INTEGRATE | |
| actions-environment-variables-write | INTEGRATE | |
| repository-rulesets | INTEGRATE | |
| workflow-dispatch | INTEGRATE | |
| workflow-files-write | OPT-OUT | explicitly out of scope: the App has no workflows permission; setup writes callers to the working tree only |
| webhooks | OPT-OUT | explicitly out of scope: polling by schedule replaces event delivery (no pull_request_target, App webhook inactive) |
| checks-write | OPT-OUT | not needed: Phase 1 only reads CI state through statusCheckRollup |
| git-refs-push | OPT-OUT | not needed yet: bot branches under warden/** arrive in Phase 6 |
