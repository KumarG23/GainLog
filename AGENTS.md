# Repository Working Agreement

## Who does what

Any capable coding agent Neal assigns (for example Claude or Jarvis/Hermes) may do application work: architecture, implementation, refactoring, debugging, tests, integration and review. No specific model is required.

Jarvis (Hermes, running locally) handles deploys and anything that needs Neal's machines or network: backend deploys on the Proxmox host, systemd units, signed Android builds and sideloading to the phone, and other on-host operations.

Whoever does the work is responsible for inspecting the complete result, including any subagent output, and producing real test, build or deployment evidence.

## Definition of done

A code change is not complete merely because it works locally. Before ending a work session or reporting completion:

1. Review the changed scope and affected callers/contracts; inspect intended tracked and untracked changes for correctness, security, secrets, and accidental files.
2. Run the repository's relevant tests, type checks, lint, and platform/build checks.
3. Use concise self-review by default. Name a concrete risk before broader tests or independent review; high-risk boundaries should receive scoped independent review under `/home/neal/AGENTS.md`. No routine whole-candidate review, repeated gates or parent re-verification.
4. Commit the coherent change with a descriptive conventional commit message.
5. Push the current branch to its configured GitHub upstream.
6. Verify `HEAD` equals the upstream branch and the working tree is clean.

Create a checkpoint commit and push at the end of any substantial work session even when a larger feature is unfinished; clearly label incomplete work in the commit message. Never push known-broken builds, credentials, private health data, generated signing material, or unrelated files merely to satisfy the checkpoint rule.

If pushing is blocked by authentication, network failure, or failing verification, report the blocker explicitly and leave a precise recovery note. Do not silently leave valuable work only on one machine.
