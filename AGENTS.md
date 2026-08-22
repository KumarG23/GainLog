# Repository Working Agreement

## Definition of done

A code change is not complete merely because it works locally. Before ending a work session or reporting completion:

1. Review the complete tracked and untracked diff for correctness, security, secrets, and accidental files.
2. Run the repository's relevant tests, type checks, lint, and platform/build checks.
3. Obtain an independent code review for substantive code changes and resolve blocking findings.
4. Commit the coherent change with a descriptive conventional commit message.
5. Push the current branch to its configured GitHub upstream.
6. Verify `HEAD` equals the upstream branch and the working tree is clean.

Create a checkpoint commit and push at the end of any substantial work session even when a larger feature is unfinished; clearly label incomplete work in the commit message. Never push known-broken builds, credentials, private health data, generated signing material, or unrelated files merely to satisfy the checkpoint rule.

If pushing is blocked by authentication, network failure, or failing verification, report the blocker explicitly and leave a precise recovery note. Do not silently leave valuable work only on one machine.
