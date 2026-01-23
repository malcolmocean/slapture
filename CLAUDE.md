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
