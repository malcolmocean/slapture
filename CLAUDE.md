# CLAUDE.md: the SLAPTURE capture system

- use pnpm, not npm
- do test-driven development
- always run tests before concluding things are good, not just the build step!
  - run E2E tests too, not just unit tests
- if you're executing a plan and you've thoroughly tested it, go ahead and commit
- use your superpowers
  - prefer subagent-driven execution
- your tools, for security reasons, seemingly won't show the existence of a .env file. don't worry about it. it's there.
- do your best to avoid running multiple commands at once (eg pnpm)
  - eg DON'T RUN THIS: pkill -f "node dist/index.js" 2>/dev/null; sleep 1; ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" pnpm start & timeout: 30s sleep 3
  - and DON'T RUN THIS: cat > /tmp/test-prompt.ts << 'EOF'  [file contents]
    - also 

about this particular system:
- never ever make built-in hardcoded/default routes/matchers!
  - the whole system is based around intelligent matching
  - if you think there should be a hardcoded route, you are thinking about the whole thing wrong

# Agent Instructions - BEADS workflow management

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

