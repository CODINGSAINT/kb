# Run the twelve-article review copy

Canonical folder: `C:/Users/07pal/OneDrive/Documents/New project/kb-learning-quality/`.

Branch: `codex/kb-learning-quality-review`. This lot is saved in a local review commit; use `git log -1` for its hash. No push, PR, merge or publication is part of this handoff. The original checkout and deployed site were not updated with these changes.

From this review folder run `npm ci` if dependencies are missing, then `npm run start:local`. Open http://localhost:4321. Use the normal **Reference design** reveal control. An existing server from the original checkout shows older content.

The built review preview, while its current local server is running, is http://127.0.0.1:8790/. To recreate a static preview, run `npm run build:site` and `python -m http.server 8790 --bind 127.0.0.1 --directory site` from this folder. The static preview contains no learning-data backend or paid model calls.

| Article | Application route | Walkthrough path |
| --- | --- | --- |
| Movie Booking | /#/t/4/0 | /learning-labs/index.html?topic=booking |
| ATM | /#/t/5/0 | /learning-labs/atm.html |
| Library | /#/t/9/0 | /learning-labs/library.html |
| Tic-Tac-Toe | /#/t/16/0 | /learning-labs/tictactoe.html |
| URL Shortener | /#/t/1/1 | /learning-labs/shortener.html |
| Rate Limiter | /#/t/2/1 | /learning-labs/index.html?topic=ratelimit |
| Distributed Cache | /#/t/3/1 | /learning-labs/distributed-cache.html |
| Notification System | /#/t/4/1 | /learning-labs/notification.html |
| AI/LLM Fundamentals | /#/t/1/2 | /learning-labs/ai-fundamentals.html |
| Spring AI Fundamentals | /#/t/6/2 | /learning-labs/spring-fundamentals.html |
| ChatClient | /#/t/7/2 | /learning-labs/index.html?topic=chatclient |
| Structured Output | /#/t/8/2 | /learning-labs/structured-output.html |

The walkthroughs use offline recorded executions or explicitly labelled explanatory cases. Tic-Tac-Toe also has a browser rules mode. They do not send payments, messages or provider calls. Text fallbacks, manual stepping, theme controls and narrow layouts are included.

REPORT.md describes validation and limits. Manifest counts distinguish generation from validation/review. The remaining 45 first-pass articles are deferred; Fundamentals and the three accepted LLD references remain unchanged. Owner review is the next step; no additional topics will be started automatically.
