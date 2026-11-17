# ADR 0010: YAML-Scoped Business Rules (Standing Orders)

**Status:** Draft
**Date:** 2026-11-17
**Deciders:** @trek-e

## Context

Repository maintainers need readable, auditable limits on what the factory may do automatically, what requires approval, and when it must escalate. Standing orders should express policy without becoming an executable task language or allowing a model to expand its own permissions.

## Decision

- Store declarative standing authority in `.github/ORDERS.yaml`; operational settings belong in `.github/warden.yml`. Each setting has one canonical home.
- Each named rule group (also called a program) expresses scope, applicable built-in task/conditions, exclusions, allow/deny decisions, approval gates and escalation. It is not executable task code.
- Use a closed, schema-validated vocabulary implemented by Warden. Do not promise arbitrary expressions, shell commands, a general DSL or enterprise policy machinery in MVP.
- Apply mandatory platform constraints and the operator-approved authority ceiling first. Within applicable standing orders, denial or human approval prevails over allowance. Invalid policy cannot grant authority; unresolved conflicts escalate.
- Evaluate approved policy, not proposed PR changes that attempt to authorize themselves.
- Apply the Execute-Verify-Report discipline: perform authorized work, independently verify its result, and report actual completion or explicit blockers. This is a task contract, not an instruction to execute YAML as code.
- Ship versioned starter orders and schemas in the scoped Warden package. Setup never overwrites existing orders. Validate both YAML files and show effective-policy changes before upgrade.
- Start narrow. The decision corpus may justify a proposed authority expansion, but a maintainer must approve it before it takes effect. Historical agreement alone is not permission.

## Consequences

Rules remain portable between repositories and separate from factory task implementation. Two configuration files require clear ownership and combined validation, but avoid conflating operational tuning with authority.

Policy edits, rule conflicts and schema/default changes receive explicit review. No speculative DSL or general migration engine is required to deliver the MVP.

## Related

- [Configuration and release](0005-releasable-and-configurable-per-repo.md)
- [Tiered autonomy](0008-tiered-autonomy-and-merge-gates.md)
- [Credential authority ceiling](0011-credential-controller.md)
- [Standing orders terminology](../../GLOSSARY.md#rule-model)
