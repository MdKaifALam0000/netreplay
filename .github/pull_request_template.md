## Description
<!-- Provide a brief summary of the changes introduced by this pull request. -->

## Changes Proposed
- 

## Verification Checklist
- [ ] `npm run check:setup` passes.
- [ ] `npm run typecheck:api` and `npm run typecheck:web` pass without errors.
- [ ] `npm test` passes (unit, API, and web test suites).
- [ ] `npm run test:smoke` passes with expected latency delta.
- [ ] `npm run test:e2e` passes all 14 end-to-end journey stages.
- [ ] No secrets, local `.env`, SQLite `dev.db`, or coverage files are committed.
- [ ] Network fault cleanup is guaranteed in `finally` blocks.
- [ ] Documentation updated if relevant.
