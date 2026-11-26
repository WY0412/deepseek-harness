# Harness runtime image publication

The dependency comparison skips npm's regular root-level `node_modules/.package-lock.json` installation metadata. Files inside installed packages remain subject to the baseline comparison.

Master publishes an incremental runtime image on top of the immutable image in `runtime-base-baseline.json`. The workflow checks the Node image and platform, stages only whole new dependency packages, validates the candidate, and publishes its exact manifest before notifying Pool.

To update the runtime lock, pack the same three tarball directories as CI, set `DSH_RUNTIME_LOCK_SEED` to the previous accepted lock file, then run `node deploy/runtime-lock.mjs --write deploy/runtime-package-lock.json dist/npm dist/npm-vendor dist/npm-landlock` with npm 11.19.0. Review the resulting lock diff. The seed must be a separate path if you need it for later comparison.

A missing baseline, modified baseline package, invalid link, failed probe, or oversized new layer stops incremental publication. Inspect the failing path or manifest before choosing the manual `full` workflow mode on master. A successful full run does not change the checked-in baseline. To adopt a new baseline, record its immutable dependency-base digest, platform, Node digest, and lock source, then verify the next incremental publication. For service rollback, redeploy the previous known-good Pool image that pins the prior Harness SHA.

Compare the baseline and published manifest layer lists to verify reuse. The layer gate reports compressed new layer bytes; consult the registry copy logs for actual transfer behavior. Use `node --test deploy/*.test.mjs` to run local packaging regression tests.
