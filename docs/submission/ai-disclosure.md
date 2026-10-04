# AI-assisted work: disclosure (draft for the team to edit)

The HackCanton rules allow AI-assisted work if it is used transparently. This is a factual draft written from what the repository shows. **The team should correct it, complete it and approve it before submitting.** Nothing in it is a claim about the quality or security of the output.

## Statement

Collara was built with AI-assisted tooling. The team used Anthropic's Claude Code, an AI coding agent, to write and revise most of the source code, the tests, the scripts and the documentation in this repository. This includes the research and synthesis notes in `docs/_research/` and the submission drafts in `docs/submission/`. The agent worked from the team's product specifications and from instructions kept in the repository: [`CLAUDE.md`](../../CLAUDE.md), and build prompts in `docs/_research/build-prompts/`.

The team set the product scope, requirements and constraints, and decided what to build and what to publish. Every run reported in the repository (unit tests, Daml tests, LocalNet integration tests, privacy and Tier B runs, CI) was actually executed. Commands and results are recorded in [`docs/verification.md`](../verification.md), and the counts are in `packages/domain/src/evidence.ts`. Copy marked INFERRED was written with AI assistance and has not been approved.

All data in the project is synthetic. AI tooling was not given any real customer, borrower or lender data.

## For the team to complete

- [ ] Name any other AI tools used (for example, for images, the logo, the video, the voice-over or translation). This draft names only the one evidenced in the repository.
- [ ] State which parts were written or reviewed by hand, and who reviewed the AI-written code before it was merged.
- [ ] Confirm that the HTML prototype in `Collara Website/` and the concept documents dated 2026-09-19 were created by the team before the repository existed. Say whether AI assisted with them.
- [ ] Keep this file linked from the README and paste the final text into the submission form if it asks for it.
