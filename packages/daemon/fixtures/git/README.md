# git fixtures

- `review.diff`: `git diff --no-color --no-ext-diff --no-prefix 446b264 eb6530a -- packages/daemon/src/daemon.ts packages/web/src/board/ItemCard.vue packages/web/src/time/duration.ts`
  on this repository (commit #99), the shape `createReviewDraft` reads to check that inline review
  comments sit on lines of the diff (D43).
