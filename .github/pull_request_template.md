## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Deploy ordering

Both production deploys fire from one push and web ships ahead of api — measured
at web serving in 44s and api at 3m06s. For those ~2 minutes the deployed bundle
calls a deployed API that has not restarted yet, for real users, with nothing red
in CI. So an endpoint and the web code calling it have to reach `main` in **two
separate merges, api first**; removals go the other way, web first. Two commits
in one pull request do not count — one push starts both deploys at once, which is
the race itself.

- [ ] This adds no API surface the web app calls, **or** the web half is a separate, later pull request.
- [ ] This removes no API surface the web app still calls, **or** the web half already merged.
