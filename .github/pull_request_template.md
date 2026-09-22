## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Deploy ordering

Both production deploys fire from one push and web's finishes first, so for
that window the deployed bundle calls an API that has not restarted yet — for
real users, with nothing red in CI. An endpoint and the web code calling it
have to reach `main` in **two separate merges, api first**; removals go the
other way, web first. Two commits in one pull request do not count — one push
starts both deploys at once, which is the race itself.

- [ ] This adds no API surface the web app calls, **or** the web half is a separate, later pull request.
- [ ] This removes no API surface the web app still calls, **or** the web half already merged.
