// AUTO-GENERATED FROM critical-path-api/openapi.json
// DO NOT EDIT. Regenerate with: npm run generate:api
// Deprecated operations and schemas are filtered out at generation time.

export interface paths {
    "/api/auth/signup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign up
         * @description Create a new user account and start a session. The client supplies the user id. A verification email is sent to the address; the account is usable immediately and `email_verified` starts false. Account creation is capped at 50 an hour per source IP, whatever addresses are used: past that the call answers 429 and creates nothing. Every unexpired invitation outstanding for the address, across every project, takes effect here and the account joins those boards at the invited role.
         */
        post: operations["postApiAuthSignup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Log in
         * @description Exchange email and password for a session token.
         */
        post: operations["postApiAuthLogin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/forgot-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request password reset
         * @description Email a password-reset link. Responds 204 when an account with that address exists and 404 when none does, so someone who mistyped their address is told so rather than left waiting for mail that will never arrive. This is no more revealing than signup, which already answers 409 for an address in use. Repeated requests are rate limited per source address and per email and answer 429.
         */
        post: operations["postApiAuthForgotPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reset password
         * @description Set a new password using a token from a password-reset email, and start a session on it. On success every outstanding reset token is invalidated. Redeeming the link proves control of the address, which is the same proof signup takes, so the caller is signed in rather than sent back to a login form to retype the password they just chose. Other existing sessions stay signed in; revoke them individually from GET /api/auth/sessions.
         */
        post: operations["postApiAuthResetPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/verify-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify email address
         * @description Mark an email address as verified using a token from a verification email. Unauthenticated: the token authenticates nothing, creates no session and returns nothing about the account. Idempotent — redeeming a token again succeeds without moving the recorded time, and every outstanding token for the address stays usable. A token stops working once the account moves to a different address, and expires 24 hours after it was issued.
         */
        post: operations["postApiAuthVerifyEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/unsubscribe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Unsubscribe from one kind of notification
         * @description Switch off the one notification kind the token names, and report which it was so the landing page can say what it did. Unauthenticated and idempotent: the token proves nothing beyond itself, is refused by every authenticating path, and never expires, because an unsubscribe link has to work in a year-old email. There is deliberately no request shape that switches a preference back on — that is what makes a leaked or replayed link harmless, and it must not be weakened by adding one. The response is the same whether or not the account still exists, so nothing here reveals that.
         */
        post: operations["postApiAuthUnsubscribe"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/unsubscribe/all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Unsubscribe from every notification
         * @description Switch off every notification email for the account the token names, whatever kind the token itself carries. Same properties as the single-kind form: unauthenticated, idempotent, and incapable of switching anything on.
         */
        post: operations["postApiAuthUnsubscribeAll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/unsubscribe/one-click": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * One-click unsubscribe (RFC 8058)
         * @description The target of the List-Unsubscribe header on notification email. A mail client posts List-Unsubscribe=One-Click as form data, which is not JSON, so the token comes from the query string and the body is never read. It switches off the kind the token names.
         */
        post: operations["postApiAuthUnsubscribeOneClick"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Log out
         * @description Delete the current session.
         */
        post: operations["postApiAuthLogout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Current user
         * @description Return the authenticated user.
         */
        get: operations["getApiAuthMe"];
        put?: never;
        post?: never;
        /**
         * Delete account
         * @description Permanently delete the authenticated account. The current password must be re-supplied. This removes the account, every session and personal access token, every project the caller created together with its columns, tasks, labels, dependencies, comments, activity, webhooks and images, their memberships and task assignments in other people's projects, their comments and activity entries there, and their submitted feedback. Stored avatar and image objects are removed after the transaction commits. It answers 409 with a blocking_projects list while the caller still owns a project that has other members: hand each one over with PUT /api/projects/{id}/owner, or delete it, and retry. Deletion cannot be undone.
         */
        delete: operations["deleteApiAuthMe"];
        options?: never;
        head?: never;
        /**
         * Update current user
         * @description Update the name and/or email of the authenticated user. Moving to a different mailbox invalidates any outstanding password-reset tokens, resets `email_verified` to false and sends a verification email to the new address; a change of letter case alone does neither. The verification send shares the resend budget, so an exhausted budget answers 429 and changes nothing.
         */
        patch: operations["patchApiAuthMe"];
        trace?: never;
    };
    "/api/auth/tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List personal access tokens
         * @description List the caller's personal access tokens, newest first. Secrets are never returned. Expired tokens stay listed until they are revoked. `last_used_at` is null until the token first authenticates, and is accurate to about a minute thereafter.
         */
        get: operations["getApiAuthTokens"];
        put?: never;
        /**
         * Create personal access token
         * @description Mint a named personal access token for scripts and agents. The secret is returned once and never again; only its hash is stored. Omit `expires_at` (or send null) for a token that never expires. Tokens carry the same permissions as the user and survive password changes and resets.
         */
        post: operations["postApiAuthTokens"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/tokens/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke personal access token
         * @description Revoke one of your personal access tokens. Any WebSocket authenticated with that token is closed; other tokens and browser sessions are untouched. Another user's token answers 404, the same as one that does not exist.
         */
        delete: operations["deleteApiAuthTokensById"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List sessions
         * @description List the caller's live sessions, newest first, with `is_current` true on the one this request was made with. Each carries the `User-Agent` sent when it was created, verbatim and unparsed, or null when the client sent none; no network address is recorded, here or anywhere. Sessions past their expiry are left out — they authenticate nothing, so listing them would misreport where the account is signed in. This lists sessions only: personal access tokens authenticate the same requests and are listed by GET /api/auth/tokens, so neither endpoint alone shows everything that can act as the account. A caller holding a personal access token sees every session and none marked current, since a token is not a session.
         */
        get: operations["getApiAuthSessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke session
         * @description Revoke one of your own sessions. Its token stops working immediately and any WebSocket authenticated with it is closed; other sessions and every personal access token are untouched. Revoking the session the request was made with is allowed and is a sign-out of this device. Another user's session answers 404, the same as one that does not exist.
         */
        delete: operations["deleteApiAuthSessionsById"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/change-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Change password
         * @description Change the password of the authenticated user. Requires the current password. Existing sessions are left signed in, including this one; revoke them individually from GET /api/auth/sessions.
         */
        post: operations["postApiAuthChangePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/verify-email/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resend verification email
         * @description Send a fresh verification email to the authenticated user's own address. Takes no body. Answers 204 without sending when the address is already verified. Earlier links stay valid. There is deliberately no unauthenticated form of this: verification does not gate signing in, so anyone needing a new link can sign in and ask, and that leaves no endpoint that reveals whether an address has an account.
         */
        post: operations["postApiAuthVerifyEmailResend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export account data
         * @description Download everything held about the calling account that is not board content, as one JSON file, with Content-Disposition attachment and a fixed filename that carries no user text. It is free, never gated, and a personal access token may fetch it: every collection in it is already readable one endpoint at a time, so this adds no reach, only convenience. format identifies the shape and version is bumped only on a breaking change to it. account carries the profile plus the notification preferences; sessions lists every session row including ones already past expires_at, which the session listing hides because they authenticate nothing; personal_access_tokens and feedback are the metadata and the prose the account submitted; projects names each board the account created or is a member of, with role owner for one it created and joined_at taken from the membership, or from the board itself for one it created. Board content is deliberately absent — cards, labels, assignments and images belong to a project and come out of GET /api/projects/{id}/export, which every member of a board can call. Comments and activity come out of no route at all yet; when they do it will be that one, where a comment arrives attached to its card. Nothing here names another person, and no credential material is included: no password hash, no session or token hash, and no invitation record, since an invitation carries a token hash and an invitee's address. avatar_url is a server-relative path that stops resolving once the account is gone; fetch the bytes before deleting the account.
         */
        get: operations["getApiAuthMeExport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me/notification-settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read notification settings
         * @description Return which notification emails the authenticated user has switched on. All default to true. They are read here rather than on the user record because that record is published to everyone sharing a project and a preference is private.
         */
        get: operations["getApiAuthMeNotificationSettings"];
        /**
         * Set notification settings
         * @description Change the notification preferences the body names and leave the rest alone, then return the full set. Every key is optional so a client can send only what it changed, and so a kind added to a later release does not start refusing saves from a client that predates it. A preference stays meaningful while the address is unverified — no mail is sent then either way — so the toggles are never forced off.
         */
        put: operations["putApiAuthMeNotificationSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload avatar
         * @description Set the profile image of the authenticated user via multipart form data. The upload must sniff as PNG, JPEG, GIF, or WebP by magic bytes (the client-declared MIME type is ignored) and be at most 10 MB. The image is normalized server-side: auto-oriented, downscaled to fit within 1024x1024 (never enlarged), and re-encoded as WebP. Animated GIF/WebP uploads keep only their first frame. Replaces any existing avatar; the old stored object is deleted after the transaction commits.
         */
        post: operations["postApiAuthMeAvatar"];
        /**
         * Remove avatar
         * @description Remove the profile image of the authenticated user. The stored object is deleted after the transaction commits. Idempotent: removing a nonexistent avatar succeeds. Returns the updated user so clients can adopt it directly.
         */
        delete: operations["deleteApiAuthMeAvatar"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List visible users
         * @description Without project_id, list the caller and every user sharing at least one project with them (as creator or member on either side). With project_id (the caller must have access to the project — 404 otherwise), list users who can access that project plus users still assigned to its tasks or still holding a comment on them. Ordered by name. email narrows either listing to the one user holding that exact address, case-insensitively, and is the only way to name someone by address: a user record never carries one. It selects from the same set the unfiltered call already returns in full, so it discloses nothing new — an address that belongs to nobody visible yields an empty list rather than 404, which on this route means the project is missing or unreadable. A malformed address is 400.
         */
        get: operations["getApiUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List projects
         * @description List projects the caller can access (created by them or shared with them as a member) with member ids, member roles, open and done task counts, and the caller's personal sort position (null when never set). Archived tasks count toward neither total. Ordered by position (nulls last), then created_at, then id. last_seen_at is when the caller last opened the board (null until they have), and has_unseen_changes says whether a live card in an unarchived project has been commented on or logged activity by somebody else since then — so a board the caller has never opened reports false, not everything.
         */
        get: operations["getApiProjects"];
        put?: never;
        /**
         * Create project
         * @description Create a project with the default Backlog / To Do / In Progress / Done columns, or deep-copy an existing project by passing source_project_id (copies columns, labels, tasks, task labels, dependencies, images, and recurring series with their templates — not comments, assignees, members, archived cards, the accent colour, or the archived state of the project itself; copies start personal). A copied series keeps the source’s status and schedules its next occurrence from today, so it behaves like the original without firing an occurrence the source already missed. Returns 422 when source_project_id does not reference an existing project and 404 when it references a project the caller cannot access. A source holding more than 5000 live tasks returns 422 and copies nothing.
         */
        post: operations["postApiProjects"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get board payload
         * @description Get a project with its columns, tasks (including label, assignee, and blocker ids plus image counts), and labels in one payload. Archived tasks are excluded, as are archived tasks appearing as blockers of the tasks that are included. changed_task_ids names the tasks in this payload that somebody else commented on or logged activity for since the caller last stamped the board with PUT /:id/seen, and is empty for a caller who never has. Reading the board does not stamp it.
         */
        get: operations["getApiProjectsById"];
        put?: never;
        post?: never;
        /**
         * Delete project
         * @description Delete a project and everything in it. Only the project owner may delete: other members with access get 403 and non-accessors get 404. Stored image objects are removed after commit.
         */
        delete: operations["deleteApiProjectsById"];
        options?: never;
        head?: never;
        /**
         * Update project
         * @description Update project fields. Set archived_at to an ISO timestamp to archive or null to unarchive. Set is_public to true to publish the board read-only at GET /api/public/projects/:id/board, which serves card titles, descriptions and their embedded images, labels, blockers, and assignee names and avatars to anyone with the project id and no account. Set it back to false to stop serving it. Set color to one of the fixed accent keys to mark the board across every surface that lists it, or null for no colour; the choice is shared with everyone who can see the board and rides the project_updated realtime and webhook events. The public board never carries it. Editors only: a viewer gets 403 and non-accessors 404.
         */
        patch: operations["patchApiProjectsById"];
        trace?: never;
    };
    "/api/projects/{id}/archived-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List archived tasks
         * @description List every archived task in a project in board-payload shape plus archived_at, most recently archived first and then in board position order, so a column archived in one call lists the way it was returned. Unpaginated and unfiltered — clients search it themselves, the same way they do the board payload.
         */
        get: operations["getApiProjectsByIdArchivedTasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export project
         * @description Download everything in a project. The default zip holds project.json (the manifest below), tasks.csv (one row per task, for spreadsheets), and images/ with the real bytes of every attached image, so the archive survives losing the account. Archived cards are exported too, after the live ones, each carrying the archived_at that marks it and the column_id it was archived from; a live card has archived_at null. Pass format=json for the manifest alone. The manifest is the documented, stable interchange format the importer reads back: format identifies it, version is bumped only on a breaking shape change, and ids are the original server ids — created_by, member_ids and assignee_ids resolve against users[], label_ids against labels[], column_id against columns[], and blocker_ids against tasks[]. Task descriptions are stored verbatim, so their embedded /api/images/<uuid> sources resolve by id against the entries of tasks[].attachments[] whose kind is image, and each such entry carries the archive-relative path of its file. Every project member may export; the export is free and never gated. A project whose images would exceed the 4 GiB zip ceiling answers 413 and must be exported with format=json, which carries no stored bytes — fetch each image from GET /api/images/{id} by the id of its tasks[].attachments[] entry.
         */
        get: operations["getApiProjectsByIdExport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects/{id}/position": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set project position
         * @description Set the caller's personal sort position for a project. Positions are per user and order the project list for the caller only; other members are unaffected. A sort_key already taken among the caller’s positions ranks the project immediately after the one holding it, so the stored key is not always the one that was sent; the project_position_updated event carries the key that was stored.
         */
        put: operations["putApiProjectsByIdPosition"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects/{id}/seen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Mark project seen
         * @description Move the caller's marker for a project to now, so nothing already in it counts as an unseen change any more. Per user and invisible to everyone else; any member may call, viewers included, and non-accessors get 404. Archiving does not stop it. Only this endpoint stamps — reading the board, the export or a webhook never does, so a script cannot clear somebody else’s dot.
         */
        put: operations["putApiProjectsByIdSeen"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set project members
         * @description Replace the full member set of a project, change member roles, or both. Editors may call; a viewer may only use it to remove themselves and gets 403 for anything else; non-accessors get 404. Omit user_ids to change roles only, which cannot add or remove anyone however stale the caller’s member list is. The creator has implicit access, is always an editor, and is never stored as a member: their id is silently stripped from both user_ids and roles if present. Every newly added id must reference an existing user and every roles entry must name someone in the resulting member set (422 with a plain error body otherwise). A retained member with no roles entry keeps their stored role. Removed members lose their task assignments in the project, and pending invitations sent by anyone this leaves without write access are revoked with it.
         */
        put: operations["putApiProjectsByIdMembers"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects/{id}/members/by-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add project member by email
         * @description Share a project with one exact, case-insensitive email address. When the address already has an account the user is added immediately and the response is status "member": adding an existing member is an idempotent no-op that changes their role only when role is given, so re-inviting never silently promotes a viewer, and adding the creator (implicit access, always an editor) stores nothing. When the address has no account a pending invitation is created instead and the response is status "invited"; the invitation is emailed a link and takes effect when the recipient signs up with that address or accepts the link, whichever comes first. role defaults to editor and is the effective role either way. The invitation token is never returned. Unlike other POSTs this one takes no client-supplied id: the invitation is keyed by project and address, which the client already supplies, and whether a row is created at all depends on server state the client cannot see, so there is nothing to render optimistically. A pending invitation for an address that has since gained an account is dropped as the member is added, since only signup claims one. 422 past 100 pending invitations on the project (expired ones count until they are revoked). Two hourly budgets answer 429: 100 addresses looked up per caller, which every call spends whether or not the address has an account, and 20 invitation emails per caller, which only a call that actually sends one spends — so adding people who already have accounts never runs the mail budget down, though once that budget is gone every call answers 429 until the hour is out, whatever the address, rather than letting the 429 itself say which addresses have accounts. A third limit allows three re-mails an hour of any one address. Editors may call; a viewer gets 403 and non-accessors 404.
         */
        post: operations["postApiProjectsByIdMembersByEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects/{id}/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List pending project invitations
         * @description List the invitations outstanding on a project — addresses invited to share it that have no account yet. Expired invitations stay listed with their expires_at so they can be resent or revoked rather than silently vanishing. Invitation tokens are never returned. Editors only: the list is a management surface made entirely of email addresses that only editors can create, so a viewer gets 403 and non-accessors 404.
         */
        get: operations["getApiProjectsByIdInvitations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects/{id}/invitations/{invitationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke a project invitation
         * @description Withdraw a pending invitation. Every copy of its link stops working at once, including one already sitting in the recipient’s mailbox, because redemption always consults the row. 404 when the project has no such invitation. Editors only.
         */
        delete: operations["deleteApiProjectsByIdInvitationsByInvitationId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects/{id}/invitations/{invitationId}/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resend a project invitation
         * @description Email a pending invitation again and give it a fresh 14-day deadline, which is also how an expired invitation is revived. The link is unchanged, so the copy the recipient already has keeps working. 404 when the project has no such invitation, 429 past three resends an hour for one invitation or past the caller’s hourly budget of invitation emails. Editors only.
         */
        post: operations["postApiProjectsByIdInvitationsByInvitationIdResend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/projects/{id}/owner": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Transfer project ownership
         * @description Hand a project to another member. Only the current creator may call: other members with access get 403 and non-accessors get 404. user_id must already be a project member (422 otherwise). The incoming owner becomes created_by and their member row is dropped, so handing the project to a viewer promotes them — the creator is always an editor. The outgoing creator gains an ordinary editor member row and may then leave via PUT /:id/members. Passing your own id is a no-op. Task assignments are unaffected.
         */
        put: operations["putApiProjectsByIdOwner"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/invitations/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept a project invitation
         * @description Redeem an invitation link and join the board it names. The caller must be signed in but need not be signed in as the invited address — an invitation is a grant to whoever holds the link, so someone who signs up under a different address can still accept. Joining consumes the invitation: a second attempt with the same token answers 422, as does one that was revoked, expired, or whose board has been deleted. A caller who already has access joins nothing, so the link survives for whoever it was addressed to and the response reports the access they already had — an existing member is never demoted, and the board’s owner is always an editor. There is no project id in the path because the holder of a link does not know it.
         */
        post: operations["postApiInvitationsAccept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/columns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create column
         * @description Create a board column in a project. The client supplies the column id. Returns 404 when the referenced project is unknown or inaccessible and 409 on a duplicate id.
         */
        post: operations["postApiColumns"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/columns/{id}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Duplicate a column
         * @description Copy a column and every live card in it into the same project. The new column keeps the source’s name and done flag; each copied card keeps its title, description, due date, labels, assignees, images, cover image and its position, so the cards land in the same relative order. A dependency edge is copied only when both of its ends are inside the copied set, so edges between two cards in the column survive and edges leaving it do not. Archived cards are not copied, and neither are comments or activity history — each copy’s log starts with its own created entry. The client supplies the new column id and its position; a duplicate id returns 409. One column_created event is published plus one task_created per copied card. A copy that would take the project past its 5000-task ceiling, archived cards counted, returns 422 and copies nothing.
         */
        post: operations["postApiColumnsByIdDuplicate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/columns/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete column
         * @description Delete a column. An empty column returns 204. A column with tasks requires a `move_tasks_to` query parameter naming another column in the same project; its tasks are appended after the target column’s existing tasks (keeping relative order) and the response is 200 with the moved tasks’ new positions. Returns 409 when the column has tasks and no target is given, and 422 when `move_tasks_to` does not exist, belongs to another project, or equals the deleted column. Archived tasks count as tasks here, so a column that looks empty in the board payload can still require `move_tasks_to`, and `moved_tasks` can name tasks that payload never served.
         */
        delete: operations["deleteApiColumnsById"];
        options?: never;
        head?: never;
        /**
         * Update column
         * @description Update the name, position, or done flag of a column. A sort_key already taken in the project ranks the column immediately after the one holding it rather than failing, so the echoed sort_key is not always the one that was sent.
         */
        patch: operations["patchApiColumnsById"];
        trace?: never;
    };
    "/api/columns/{id}/move-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move all tasks to another column
         * @description Move every live task in a column to another column in the same project, appended after the target column’s existing tasks and keeping their relative order. The source column is kept; an empty source column is a 200 with an empty `moved_tasks`. Archived tasks stay where they are, so restoring one later returns it to the column it was archived from. Returns 422 when `target_column_id` does not exist, belongs to another project, or equals the source column.
         */
        post: operations["postApiColumnsByIdMoveTasks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/columns/{id}/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reorder tasks within a column
         * @description Re-stamp positions for the column’s unarchived tasks in the given order, a one-shot sort that commits to manual order rather than acting as a persistent view mode. The client supplies every unarchived task id of the column in its new order; the server assigns evenly spaced positions (1000, 2000, …) so later drags have room to midpoint. No column changes, so neither updated_at, column_since nor the activity log are touched. A duplicate id, an id that is archived or in another column, or a missing id set returns 422 with a plain error body. Emits one `column_tasks_reordered` event with the moved tasks’ new positions.
         */
        post: operations["postApiColumnsByIdReorder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/columns/{id}/archive-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Archive all tasks in a column
         * @description Archive every live task in a column in one call: a soft delete that keeps the rows and their dependency edges but takes the tasks out of the board payload, out of every blocker and dependent list, and out of the project task counts. Already archived tasks keep their original archived_at and are absent from the response, so repeating the call is a no-op 200. The column itself is kept.
         */
        post: operations["postApiColumnsByIdArchiveTasks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a task
         * @description Create a task in a column. The client supplies the task id. An unknown or inaccessible project returns 404. The column must belong to the project, labels must belong to the project, and assignees must be users with access to the project; those violations return 422 with a plain error body. due_date is an optional calendar day (YYYY-MM-DD, no time and no timezone); anything else returns 422. A project holds at most 5000 tasks, archived ones included; past that, creating one returns 422 while reading and editing the existing cards keeps working.
         */
        post: operations["postApiTasks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Duplicate a task
         * @description Copy a task into the same column. The copy carries the title, description, due date, labels, assignees, images and cover image of the original, each image copied to its own stored object so deleting one leaves the other intact. It carries no dependency edges: a copy keeps an edge only when both of its ends are copied too, which one card never is. It carries no comments and no activity history either — the copy’s log starts with its own created entry. Duplicating an archived task produces a live card. The client supplies the new id and its position; a duplicate id returns 409. A project already holding 5000 tasks, archived ones included, returns 422.
         */
        post: operations["postApiTasksByIdDuplicate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create tasks in bulk
         * @description Create between 1 and 100 tasks in one column of one project in a single request, for pasting a list. The client supplies every task id, so a retry after a dropped response cannot double-create. Each item carries only a title and a position: descriptions, due dates, labels and assignees are set afterwards with the single-task endpoints. The batch is all or nothing — a duplicate id, whether it already exists or is repeated inside the batch, returns 409 and creates none of them. An unknown or inaccessible project returns 404 and a column_id outside the project returns 422, as does a batch that would take the project past its 5000-task ceiling. Each created task gets its own created activity entry and its own task_created event.
         */
        post: operations["postApiTasksBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get task detail
         * @description Get a task in board-payload shape plus its project id, archived_at (null unless the task is archived), its attachments, its full comment stream oldest first, and its checklist in list order. Archived tasks are readable here even though they are absent from every board payload. `series_summary` names the recurrence in English for a card a recurring series created, and is null for every other card — including one whose series has since been deleted.
         */
        get: operations["getApiTasksById"];
        put?: never;
        post?: never;
        /**
         * Delete an archived task
         * @description Permanently delete a task that has already been archived. A task still on the board is refused with 422: archiving is the reversible step and deletion is only reachable from the archive, so nothing can be destroyed in one action. Dependencies, labels, assignees, and images cascade; stored image objects are removed after commit.
         */
        delete: operations["deleteApiTasksById"];
        options?: never;
        head?: never;
        /**
         * Update a task
         * @description Update title, description (a Tiptap doc, or null to clear it), due_date (a calendar day YYYY-MM-DD, or null to clear it; omit it to leave it alone), or move the task by sending column_id and position together. The new column must belong to the task’s project and due_date must be a real calendar day; violations return 422 with a plain error body. A sort_key already taken in the destination — including by an archived card the caller cannot see — ranks the task immediately after the card holding it rather than failing, so the echoed sort_key is not always the one that was sent. updated_at is bumped only when the patch changes title or description — a pure move or due-date change leaves it untouched. expected_updated_at is an optimistic-concurrency precondition on the task’s content: it is honored only when the patch includes title or description, a patch that only moves the task or sets its due date is always last-write-wins and ignores it, and a precondition that does not match the stored updated_at returns 409 and writes nothing.
         */
        patch: operations["patchApiTasksById"];
        trace?: never;
    };
    "/api/tasks/{id}/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get task activity
         * @description The task’s activity log, oldest first: who created it, retitled it, edited its description, moved it between columns, set, changed or cleared its due date, added or removed a label, an assignee or a blocker, and who archived or restored it. A due-date entry carries the calendar day as text, with a null old value when it was first set and a null new value when it was cleared. Each entry carries the actor, the time, and the old and new value of what changed, with column, label, user and blocker names snapshotted as they were at the time. The log is append-only and starts when a task is created, so tasks that predate this feature read as empty until they next change. Consecutive description edits by one actor within a few minutes are recorded as a single entry whose old value is the text from before that session.
         */
        get: operations["getApiTasksByIdActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/cross-project-dependencies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a task’s dependencies in other projects
         * @description The task’s dependency edges whose other end lives in a different project, fetched separately from the board because the board payload deliberately carries no identity for the remote side — only `open_cross_project_blocker_count`. `blocked_by` names the tasks blocking this one and `blocking` the tasks it blocks; both carry the remote title, project and done state, and both omit archived remote tasks exactly as `blocker_ids` does. An edge whose other end is in a project the caller cannot access is never listed: it is added to `hidden_blocked_by_count` or `hidden_blocking_count` instead, and only while it is open, so the counts reconcile with `open_cross_project_blocker_count` and never reveal that an unreadable task is done. A task the caller cannot read is 404.
         */
        get: operations["getApiTasksByIdCrossProjectDependencies"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Archive a task
         * @description Archive a task: a soft delete that keeps the row and every dependency edge but takes the task out of the board payload, out of every blocker and dependent list, and out of the project task counts. Archiving an already archived task is an idempotent 200 that keeps the original archived_at. updated_at is not bumped — the card’s content did not change.
         */
        post: operations["postApiTasksByIdArchive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Restore an archived task
         * @description Put an archived task back on the board in the column and position it left from, with every dependency edge it had before intact. Restoring a task that is not archived is an idempotent 200 that changes nothing.
         */
        post: operations["postApiTasksByIdRestore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/labels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set task labels
         * @description Replace the full set of labels on a task. All labels must belong to the task’s project; violations return 422 with a plain error body.
         */
        put: operations["putApiTasksByIdLabels"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/assignees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set task assignees
         * @description Replace the full set of assignees on a task. Newly added user ids must reference users with access to the project (422 with a plain error body otherwise); ids already assigned are never re-validated, so echoing the current set always succeeds.
         */
        put: operations["putApiTasksByIdAssignees"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set task cover image
         * @description Choose which of the task’s images is shown on the board card face, or send a null image_id to clear it. The image must belong to the task; violations return 422 with a plain error body. Setting a cover replaces any previous one — a task has at most one cover — and clearing an absent cover is an idempotent 204. The cover is a choice about presentation, not content, so it leaves updated_at untouched.
         */
        put: operations["putApiTasksByIdCover"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/blockers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add a blocker
         * @description Add a dependency: the task in the body blocks the task in the path. The blocker must be a different, unarchived task in the same project (422 with a plain error body otherwise); the task being blocked may itself be archived, which is what lets a restore bring its edges back. Adding an existing blocker is an idempotent 204. A dependency cycle returns 409. On 409 the body also carries `cycle`: the offending loop as `{ id, title }` entries, starting at the task in the path, each entry blocking the next, ending at `blocker_task_id`, and repeating the first entry last. It is empty when no path is recoverable.
         */
        post: operations["postApiTasksByIdBlockers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/blockers/{blockerTaskId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a blocker
         * @description Remove a dependency. Idempotent: removing an absent blocker still returns 204.
         */
        delete: operations["deleteApiTasksByIdBlockersByBlockerTaskId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/bulk-move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move a selection of tasks to a column
         * @description Move any number of a project’s tasks into one of its columns in a single transaction. The tasks are appended after the target column’s existing cards, keeping the order the ids were sent in, so the caller decides where the selection lands. Archived tasks are skipped: an archived card has no board position, and restoring one is contracted to return it to the column it was archived from. A card already in the target column is re-stamped so the selection lands contiguous, but keeps its column_since and records no move in its activity log. A column_id outside the project returns 422, even when every task id was skipped. Emits one bulk_tasks_moved event and no per-task events. Ids that are unknown, in another project, or (where noted) archived are reported in `skipped_task_ids` rather than failing the call, so one card changing underneath the caller never costs them the rest of the batch. Duplicate ids are applied once. Between 1 and 100 ids; anything else is a 422.
         */
        post: operations["postApiTasksBulkMove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/bulk-archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Archive a selection of tasks
         * @description Archive any number of a project’s tasks in a single transaction: a soft delete that keeps the rows and their dependency edges but takes the cards out of the board payload, out of every blocker and dependent list, and out of the project task counts. Already archived ids keep their original archived_at, land in `skipped_task_ids`, and make a repeat call a no-op 200. The batch shares one archived_at, so the archive view breaks the tie on position and then id, which interleaves the columns of a selection that spans several. Emits one bulk_tasks_archived event and no per-task events. Ids that are unknown, in another project, or (where noted) archived are reported in `skipped_task_ids` rather than failing the call, so one card changing underneath the caller never costs them the rest of the batch. Duplicate ids are applied once. Between 1 and 100 ids; anything else is a 422.
         */
        post: operations["postApiTasksBulkArchive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/bulk-labels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add or remove labels across a selection of tasks
         * @description Apply a label delta to any number of a project’s tasks in a single transaction. This is an add/remove delta, never a replace: a selection rarely shares a label set, and replacing one from a client snapshot would strip every label the cards did not have in common. At least one of add_label_ids and remove_label_ids must be non-empty and the two must not overlap; both are 422. Ids in add_label_ids must be labels of the project (422 otherwise); ids in remove_label_ids are not validated, since removing an absent label is a no-op. Archived cards are labelled rather than skipped. A card the call applied to but did not change — it already carried the label — appears in neither list and writes no activity. The response carries the full label, assignee and blocker sets of every card that changed. Emits one bulk_tasks_relations_set event and no per-task events. Ids that are unknown, in another project, or (where noted) archived are reported in `skipped_task_ids` rather than failing the call, so one card changing underneath the caller never costs them the rest of the batch. Duplicate ids are applied once. Between 1 and 100 ids; anything else is a 422.
         */
        post: operations["postApiTasksBulkLabels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/bulk-assignees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add or remove assignees across a selection of tasks
         * @description Apply an assignee delta to any number of a project’s tasks in a single transaction. Like the label delta this is add/remove, never a replace. At least one of add_user_ids and remove_user_ids must be non-empty and the two must not overlap; both are 422. Ids in add_user_ids must be users with access to the project (422 otherwise); ids in remove_user_ids are not validated. A bulk assignment sends no per-card email: each added user instead gets one digest naming how many cards they were handed, once their assigner has stopped for a couple of minutes, gated on their own bulk_task_assigned preference. Assigning yourself notifies nobody, and a copy notifies nobody either. A card the call applied to but did not change appears in neither list and writes no activity. Emits one bulk_tasks_relations_set event and no per-task events. Ids that are unknown, in another project, or (where noted) archived are reported in `skipped_task_ids` rather than failing the call, so one card changing underneath the caller never costs them the rest of the batch. Duplicate ids are applied once. Between 1 and 100 ids; anything else is a 422.
         */
        post: operations["postApiTasksBulkAssignees"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/my-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List my tasks across projects
         * @description List every unarchived, unfinished task assigned to the caller across all accessible, non-archived projects. Each task carries a bucket, fixed by the server: blocked (it has at least one unfinished blocker), blocking (someone else is assigned to a task it holds up), or ready. Tasks are ordered blocking, then ready, then blocked, and within a bucket by how many people are waiting, then project name and board position. Each task also carries its unfinished blockers and dependents with their assignees, plus waiting_user_ids: the other people whose unfinished work it blocks. The companion arrays group the same edges by person — waiting_on_you from the dependents, you_are_waiting_on from the blockers, which alone can carry an unassigned group.
         */
        get: operations["getApiMyTasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search tasks across projects
         * @description Search task titles and description text across every non-archived project the caller can access; projects they cannot access simply do not appear. Archived cards are excluded. q is trimmed and must be 1 to 200 characters. Every word in q must match, and each word matches as a prefix of an indexed word, so typing more of a word narrows the results rather than emptying them; the exception is a partially typed inflection that has outgrown the indexed word, which drops out until it is finished (a card titled "Fix the login test" matches test and testing but not testi). Mentions match on the name they display. Ranked with title matches above description matches, capped at 50 results with truncated set when more matched.
         */
        get: operations["getApiSearch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/labels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create label
         * @description Create a label in a project. The client supplies the label id. Label names are unique per project. Returns 404 when the referenced project is unknown or inaccessible.
         */
        post: operations["postApiLabels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/labels/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete label
         * @description Delete a label. Its task associations are removed by cascade.
         */
        delete: operations["deleteApiLabelsById"];
        options?: never;
        head?: never;
        /**
         * Update label
         * @description Rename or recolor a label. Label names are unique per project.
         */
        patch: operations["patchApiLabelsById"];
        trace?: never;
    };
    "/api/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create comment
         * @description Post a comment on a task. The client supplies the comment id and the body is the same restricted Tiptap document task descriptions use; a body with no text, image, rule, or mention is rejected. Returns 404 when the task is unknown or inaccessible.
         */
        post: operations["postApiComments"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/comments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete comment
         * @description Delete your own comment. A comment written by anyone else answers 404, the same as one that does not exist.
         */
        delete: operations["deleteApiCommentsById"];
        options?: never;
        head?: never;
        /**
         * Update comment
         * @description Replace the body of your own comment. A comment written by anyone else answers 404, the same as one that does not exist.
         */
        patch: operations["patchApiCommentsById"];
        trace?: never;
    };
    "/api/checklist-items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add a checklist item
         * @description Append an item to a task’s checklist. The client supplies the item id and its position; a duplicate id returns 409. An unknown or inaccessible task returns 404 and a viewer returns 403. Items may be added to an archived task, the same as comments. The optional checked flag lets an already-ticked item be imported in one call.
         */
        post: operations["postApiChecklistItems"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/checklist-items/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a checklist item
         * @description Remove one item from a task’s checklist. Deleting it twice returns 404.
         */
        delete: operations["deleteApiChecklistItemsById"];
        options?: never;
        head?: never;
        /**
         * Update a checklist item
         * @description Tick, untick, rename or reposition one item. Every field is optional and an empty body changes nothing. Renaming and ticking advance the item’s updated_at; a reposition leaves it alone and, unlike the other three, records no activity entry — a keyboard drag finalizes once per arrow press and would otherwise write one entry per press. The parent task’s updated_at is never touched by any checklist write, so a checklist edit cannot invalidate an open editor’s optimistic-concurrency precondition. A sort_key already taken on the task ranks the item immediately after the one holding it rather than failing, so the echoed sort_key is not always the one that was sent.
         */
        patch: operations["patchApiChecklistItemsById"];
        trace?: never;
    };
    "/api/checklist-items/{id}/promote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Convert a checklist item into a card
         * @description Turn one item into a bare task in the parent’s column: its text becomes the title and nothing else is carried over — no labels, assignees, due date or dependency edge. The item is removed. The client supplies the new task id and its position; a duplicate id returns 409 and the item survives. Promoting the same item twice returns 404 the second time and creates exactly one card. A project already holding 5000 tasks, archived ones included, returns 422 and keeps the item.
         */
        post: operations["postApiChecklistItemsByIdPromote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/images/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get image
         * @description Serve image bytes with the Content-Type recorded at upload. On a private board this answers only to a member, so a picture stops being readable the moment someone is removed from the project; on a published board it serves anyone, because a public board publishes its pictures. A browser authenticates with the session cookie, since an <img> tag cannot carry an Authorization header.
         */
        get: operations["getApiImagesById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/attachments/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download a file attachment
         * @description Serve the stored bytes. On a private board this route is authenticated and answers 404 to anyone without project access, so a spec or a contract stops being readable the moment someone is removed from the project. On a published board it serves anyone, because a public board publishes its attachments. The response is always application/octet-stream with an attachment Content-Disposition, nosniff and a sandbox CSP, whatever the file is — no user-supplied bytes are ever served with a renderable content type. A link attachment answers 404.
         */
        get: operations["getApiAttachmentsByIdDownload"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/attachments/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a link preview image
         * @description Serve the preview image fetched for a link attachment, re-encoded to WebP at unfurl time. Unauthenticated: the unguessable attachment id acts as a capability URL so <img> tags work without auth headers. 404 when the link has no stored preview.
         */
        get: operations["getApiAttachmentsByIdPreview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/attachments/{id}/favicon": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a link favicon
         * @description Serve the favicon fetched for a link attachment, re-encoded to WebP at unfurl time. Unauthenticated for the same reason as the preview. 404 when the link has no stored favicon.
         */
        get: operations["getApiAttachmentsByIdFavicon"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/attachments/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload a file attachment
         * @description Attach a file of any type to a task. The request body is the file’s raw bytes and nothing else; `task_id`, an optional client-supplied `id`, the `filename` and the declared `content_type` travel as query parameters. The bytes are streamed straight to storage and never assembled in memory, so the per-file cap is enforced as they arrive and an upload that exceeds it is cut off mid-transfer with 413. The declared MIME type is recorded for display only and is never written to a response header: downloads are always served as application/octet-stream with an attachment Content-Disposition. A task holds at most 50 attachments, and the upload is refused with 413 when it would take the project past its storage quota, which counts image bytes too.
         */
        post: operations["postApiAttachmentsFiles"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/attachments/links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Attach a link
         * @description Attach a URL to a task. Answers 201 immediately with unfurl_state "pending"; a background job then fetches the page title, description, preview image and favicon and publishes attachment_updated. Unfurling never blocks the add and never fails it: a target that refuses, times out, or resolves to a private address settles the row at "failed" with the URL intact, and the title can be supplied by hand. Only http and https URLs are stored, and never one carrying credentials.
         */
        post: operations["postApiAttachmentsLinks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/attachments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete an attachment
         * @description Remove one attachment. Stored file, preview and favicon objects are reclaimed after the transaction commits. Deleting it twice returns 404.
         */
        delete: operations["deleteApiAttachmentsById"];
        options?: never;
        head?: never;
        /**
         * Rename an attachment
         * @description Set the display title or description. Both fields are optional and an empty body changes nothing. A file attachment’s filename is immutable and is not touched, so a rename can never change what a download saves as. The parent task’s updated_at is never touched, so an attachment edit cannot invalidate an open editor’s optimistic-concurrency precondition.
         */
        patch: operations["patchApiAttachmentsById"];
        trace?: never;
    };
    "/api/avatars/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get avatar
         * @description Serve avatar image bytes by storage key. Answers any signed-in caller — an avatar is the same key on every board its owner appears on — and an anonymous one only when its owner appears on a published board. A browser authenticates with the session cookie, since an <img> tag cannot carry an Authorization header. Every avatar upload mints a fresh key, so responses are immutable and cacheable forever.
         */
        get: operations["getApiAvatarsById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send feedback
         * @description Store product feedback from the signed-in user and email it to the site owner. The client supplies the feedback id.
         */
        post: operations["postApiFeedback"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List webhooks
         * @description List a project's webhook registrations, oldest first. Each carries its signing secret for an editor; the secret is omitted for a viewer.
         */
        get: operations["getApiWebhooks"];
        put?: never;
        /**
         * Register webhook
         * @description Register an HTTP(S) endpoint that receives a signed POST for every board event in a project. The client supplies the webhook id. A project may hold at most 10 registrations, and a URL may be registered once per project. The generated signing secret is in the response and stays readable by editors of that project; a viewer listing registrations never receives it, since holding it is enough to forge a delivery. Registering, changing, deleting, rotating and re-sending are editors only: a viewer gets 403. Returns 404 when the project is unknown or inaccessible.
         */
        post: operations["postApiWebhooks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/webhooks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete webhook
         * @description Delete a registration. Its delivery log goes with it by cascade.
         */
        delete: operations["deleteApiWebhooksById"];
        options?: never;
        head?: never;
        /**
         * Update webhook
         * @description Change the target URL, or disable and re-enable a registration. Sending a timestamp for `disabled_at` stops delivery and terminates every queued delivery for that webhook; sending null re-enables it and clears its consecutive failure count.
         */
        patch: operations["patchApiWebhooksById"];
        trace?: never;
    };
    "/api/webhooks/{id}/rotate-secret": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate webhook secret
         * @description Replace the signing secret. A delivery a worker has already claimed signs with the secret it read, so a receiver should accept the previous secret briefly after rotating or tolerate one rejected delivery, which then retries under the new secret.
         */
        post: operations["postApiWebhooksByIdRotateSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/webhooks/{id}/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List webhook deliveries
         * @description The delivery log for one registration, newest first, with the sent envelope, the response code and the last error. Terminal entries are kept for seven days.
         */
        get: operations["getApiWebhooksByIdDeliveries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/webhooks/{id}/deliveries/{deliveryId}/redeliver": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Re-send a failed delivery
         * @description Queue a failed delivery for a fresh retry cycle. The delivery id, and therefore the envelope id and the X-Critical-Path-Delivery header, are unchanged, so a receiver idempotency key still matches. Re-sent deliveries never count toward auto-disable.
         */
        post: operations["postApiWebhooksByIdDeliveriesByDeliveryIdRedeliver"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/task-series": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List recurring series
         * @description A series holds the template for a repeating card — title, description, labels, assignees, checklist items, an optional due date and destination column — plus an RFC 5545 RRULE and the calendar day its next occurrence falls on. Nothing is created ahead of time and nothing appears early: a background sweep materialises an ordinary card on the day the occurrence falls, and then advances the schedule. The occurrence decides only when the card comes into existence — a card carries the template’s own `due_date`, never the occurrence date. Cards already created are ordinary cards and never change when the series does. Between occurrences there is no card, so this list is the only place a recurring commitment is visible. Viewers may read it; only editors may change it. Ordered by the next occurrence, soonest first, with paused and finished series last.
         */
        get: operations["getApiTaskSeries"];
        put?: never;
        /**
         * Create a recurring series
         * @description A series holds the template for a repeating card — title, description, labels, assignees, checklist items, an optional due date and destination column — plus an RFC 5545 RRULE and the calendar day its next occurrence falls on. Nothing is created ahead of time and nothing appears early: a background sweep materialises an ordinary card on the day the occurrence falls, and then advances the schedule. The occurrence decides only when the card comes into existence — a card carries the template’s own `due_date`, never the occurrence date. Cards already created are ordinary cards and never change when the series does. Send either `preset` (one of the curated recurrences) or a raw `rrule`, never both. A raw rule must be a single RRULE value carrying no DTSTART, TZID, RDATE, EXDATE or EXRULE — the anchor is `start_date` and the zone is `timezone` — and must repeat daily or less often. The first occurrence is scheduled on or after today in the series timezone, so a past `start_date` backfills nothing. A project holds at most 50 series. Image nodes cannot belong to a template and are stripped from the description; `dropped_image_count` reports how many. The client supplies the id; a duplicate returns 409.
         */
        post: operations["postApiTaskSeries"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/task-series/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * End a recurring series
         * @description Stop a schedule and forget its template. Cards it already created stay exactly as they are, with their comments and history; they simply stop naming the series they came from.
         */
        delete: operations["deleteApiTaskSeriesById"];
        options?: never;
        head?: never;
        /**
         * Update a recurring series
         * @description Change the template, the recurrence, or pause and resume the schedule. Every change applies to future occurrences only: cards this series has already created are ordinary cards and are never read or written here. A `label_ids`, `assignee_ids` or `checklist_items` array replaces that collection wholesale; omitting one leaves it alone. Changing the recurrence, start date or timezone — or resuming — reschedules forward from today, never backwards. `clear_missed` zeroes the missed counter. `status` accepts only active or paused; a series ends by exhausting its rule, or by being deleted.
         */
        patch: operations["patchApiTaskSeriesById"];
        trace?: never;
    };
    "/api/public/projects/{id}/board": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get public board
         * @description Serve a read-only board for a project whose is_public flag is set. Unauthenticated: anyone holding the project id can read it. The payload carries columns, labels, and tasks with their descriptions, due dates, labels, blockers, image counts, comment counts, and assignee ids, plus every comment on those tasks and the name and avatar of each user who is assigned one or wrote one. Comments on archived tasks are not served. Member ids, the creator, task timestamps, and the activity log are never included. Projects that are private, unknown, or deleted are all 404.
         */
        get: operations["getApiPublicProjectsByIdBoard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ValidationOrUnprocessableError: {
            details: {
                message: string;
                path: string;
            }[];
            /** @constant */
            error: "Validation failed";
        } | {
            error: string;
        };
        ValidationError: {
            details: components["schemas"]["ValidationOrUnprocessableErrorDetails"][];
            /** @constant */
            error: "Validation failed";
        };
        ValidationOrUnprocessableErrorDetails: {
            message: string;
            path: string;
        };
        Error: {
            error: string;
        };
        AuthResponse: {
            token: string;
            user: components["schemas"]["Me"];
        };
        Me: {
            avatar_url: string | null;
            email: string;
            email_verified: boolean;
            id: string;
            name: string;
        };
        SignupRequest: {
            email: string;
            /** Format: uuid */
            id: string;
            name: string;
            password: string;
        };
        LoginRequest: {
            email: string;
            password: string;
        };
        ForgotPassword: {
            email: string;
        };
        ResetPassword: {
            new_password: string;
            token: string;
        };
        EmailTokenRequest: {
            token: string;
        };
        UnsubscribeResponse: {
            /** @enum {unknown} */
            kind: "added_to_project" | "bulk_task_assigned" | "mentioned" | "task_assigned";
        };
        PatchMe: {
            email?: string;
            name?: string;
        };
        DeleteAccountConflict: {
            blocking_projects: components["schemas"]["NamedRef"][];
            error: string;
        };
        NamedRef: {
            id: string;
            name: string;
        };
        DeleteAccount: {
            password: string;
        };
        CreatedPersonalAccessToken: {
            personal_access_token: components["schemas"]["PersonalAccessToken"];
            token: string;
        };
        PersonalAccessToken: {
            created_at: string;
            expires_at: string | null;
            id: string;
            last_used_at: string | null;
            name: string;
        };
        CreatePersonalAccessToken: {
            /** Format: uuid */
            id: string;
            name: string;
            expires_at?: string | null;
        };
        PersonalAccessTokensResponse: {
            personal_access_tokens: components["schemas"]["PersonalAccessToken"][];
        };
        SessionsResponse: {
            sessions: components["schemas"]["Session"][];
        };
        Session: {
            created_at: string;
            expires_at: string;
            id: string;
            is_current: boolean;
            user_agent: string | null;
        };
        ChangePassword: {
            current_password: string;
            new_password: string;
        };
        AccountExport: {
            account: {
                avatar_url: string | null;
                created_at: string;
                email: string;
                email_verified_at: string | null;
                id: string;
                name: string;
                notification_settings: components["schemas"]["NotificationSettings"];
            };
            exported_at: string;
            feedback: {
                created_at: string;
                id: string;
                message: string;
                page_path: string | null;
            }[];
            /** @constant */
            format: "critical-path-account-export";
            personal_access_tokens: components["schemas"]["PersonalAccessToken"][];
            projects: {
                id: string;
                joined_at: string;
                name: string;
                /** @enum {unknown} */
                role: "editor" | "owner" | "viewer";
            }[];
            sessions: {
                created_at: string;
                expires_at: string;
                id: string;
                user_agent: string | null;
            }[];
            version: number;
        };
        NotificationSettings: {
            added_to_project: boolean;
            bulk_task_assigned: boolean;
            mentioned: boolean;
            task_assigned: boolean;
        };
        NotificationSettingsUpdate: {
            added_to_project?: boolean;
            bulk_task_assigned?: boolean;
            mentioned?: boolean;
            task_assigned?: boolean;
        };
        UsersResponse: {
            users: components["schemas"]["User"][];
        };
        User: {
            avatar_url: string | null;
            id: string;
            name: string;
        };
        ProjectsListResponse: {
            projects: components["schemas"]["ProjectListItem"][];
        };
        ProjectListItem: {
            archived_at: string | null;
            color: components["schemas"]["NullableProjectAccent"];
            created_at: string;
            created_by: string | null;
            description: string;
            done_task_count: number;
            has_unseen_changes: boolean;
            id: string;
            is_public: boolean;
            last_seen_at: string | null;
            member_ids: string[];
            members: components["schemas"]["ProjectMember"][];
            name: string;
            open_task_count: number;
            sort_key: string | null;
        };
        NullableProjectAccent: "amber" | "emerald" | "fuchsia" | "lime" | "rose" | "sky" | "slate" | "violet" | null;
        ProjectMember: {
            /** @enum {unknown} */
            role: "editor" | "viewer";
            user_id: string;
        };
        BoardResponse: {
            changed_task_ids: string[];
            columns: components["schemas"]["BoardColumn"][];
            labels: components["schemas"]["BoardLabel"][];
            project: components["schemas"]["Project"];
            tasks: components["schemas"]["BoardTask"][];
        };
        BoardColumn: {
            id: string;
            is_done: boolean;
            name: string;
            sort_key: string;
        };
        BoardLabel: {
            color: string;
            id: string;
            name: string;
        };
        Project: {
            archived_at: string | null;
            color: components["schemas"]["NullableProjectAccent"];
            created_at: string;
            created_by: string | null;
            description: string;
            id: string;
            is_public: boolean;
            member_ids: string[];
            members: components["schemas"]["ProjectMember"][];
            name: string;
        };
        BoardTask: {
            assignee_ids: string[];
            attachment_count: number;
            blocker_ids: string[];
            checklist_done_count: number;
            checklist_item_count: number;
            column_id: string;
            column_since: string;
            comment_count: number;
            cover_image_url: string | null;
            created_at: string;
            description: components["schemas"]["NullableTiptapDoc"];
            due_date: string | null;
            id: string;
            label_ids: string[];
            open_cross_project_blocker_count: number;
            sort_key: string;
            title: string;
            updated_at: string;
        };
        NullableTiptapDoc: components["schemas"]["TiptapDoc"] | null;
        TiptapDoc: {
            /** @constant */
            type: "doc";
            content?: unknown[];
        };
        CreateProject: {
            /** Format: uuid */
            id: string;
            name: string;
            description?: string;
            /** Format: uuid */
            source_project_id?: string;
        };
        PatchProject: {
            archived_at?: string | null;
            color?: components["schemas"]["NullableProjectAccent"];
            description?: string;
            is_public?: boolean;
            name?: string;
        };
        ArchivedTasksResponse: {
            tasks: components["schemas"]["ArchivedTask"][];
        };
        ArchivedTask: {
            archived_at: string;
            assignee_ids: string[];
            attachment_count: number;
            blocker_ids: string[];
            checklist_done_count: number;
            checklist_item_count: number;
            column_id: string;
            column_since: string;
            comment_count: number;
            cover_image_url: string | null;
            created_at: string;
            description: components["schemas"]["NullableTiptapDoc"];
            due_date: string | null;
            id: string;
            label_ids: string[];
            open_cross_project_blocker_count: number;
            sort_key: string;
            title: string;
            updated_at: string;
        };
        ProjectExport: {
            columns: components["schemas"]["BoardColumn"][];
            exported_at: string;
            /** @constant */
            format: "critical-path-project-export";
            labels: components["schemas"]["BoardLabel"][];
            project: components["schemas"]["Project"];
            tasks: {
                archived_at: string | null;
                assignee_ids: string[];
                attachment_count: number;
                attachments: {
                    content_type: string | null;
                    created_at: string;
                    description: string | null;
                    filename: string | null;
                    id: string;
                    is_cover: boolean;
                    /** @enum {unknown} */
                    kind: "file" | "image" | "link";
                    path: string | null;
                    size_bytes: number | null;
                    title: string | null;
                    unfurl_state: components["schemas"]["AttachmentsUnfurlstate"];
                    url: string | null;
                }[];
                blocker_ids: string[];
                checklist_done_count: number;
                checklist_item_count: number;
                checklist_items: {
                    checked: boolean;
                    id: string;
                    sort_key: string;
                    text: string;
                }[];
                column_id: string;
                column_since: string;
                comment_count: number;
                cover_image_url: string | null;
                created_at: string;
                description: components["schemas"]["NullableTiptapDoc"];
                due_date: string | null;
                id: string;
                label_ids: string[];
                open_cross_project_blocker_count: number;
                sort_key: string;
                title: string;
                updated_at: string;
            }[];
            users: components["schemas"]["NamedRef"][];
            version: number;
        };
        AttachmentsUnfurlstate: "failed" | "ok" | "pending" | null;
        SetProjectPosition: {
            /** @description a sort key */
            sort_key: string;
        };
        SetProjectMembers: {
            roles?: components["schemas"]["ProjectMemberRoleEntry"][];
            user_ids?: string[];
        };
        ProjectMemberRoleEntry: {
            /** @enum {unknown} */
            role: "editor" | "viewer";
            /** Format: uuid */
            user_id: string;
        };
        AddMemberByEmailResponse: {
            invitation: components["schemas"]["ProjectInvitation"] | null;
            /** @enum {unknown} */
            role: "editor" | "viewer";
            /** @enum {unknown} */
            status: "invited" | "member";
            user: components["schemas"]["User"] | null;
        };
        ProjectInvitation: {
            created_at: string;
            email: string;
            expires_at: string;
            id: string;
            invited_by: string;
            project_id: string;
            /** @enum {unknown} */
            role: "editor" | "viewer";
        };
        AddProjectMemberByEmail: {
            email: string;
            /** @enum {unknown} */
            role?: "editor" | "viewer";
        };
        ProjectInvitationsResponse: {
            invitations: components["schemas"]["ProjectInvitation"][];
        };
        SetProjectOwner: {
            /** Format: uuid */
            user_id: string;
        };
        AcceptedInvitation: {
            project_id: string;
            /** @enum {unknown} */
            role: "editor" | "viewer";
        };
        AcceptInvitation: {
            token: string;
        };
        Column: {
            created_at: string;
            id: string;
            is_done: boolean;
            name: string;
            project_id: string;
            sort_key: string;
        };
        CreateColumn: {
            /** Format: uuid */
            id: string;
            name: string;
            /** Format: uuid */
            project_id: string;
            is_done?: boolean;
            /** @description a sort key */
            sort_key?: string;
        };
        DuplicatedColumnResponse: {
            column: components["schemas"]["Column"];
            tasks: components["schemas"]["BoardTask"][];
        };
        Duplicate: {
            /** Format: uuid */
            id: string;
            /** @description a sort key */
            sort_key?: string;
        };
        PatchColumn: {
            is_done?: boolean;
            name?: string;
            /** @description a sort key */
            sort_key?: string;
        };
        MovedTasksResponse: {
            moved_tasks: components["schemas"]["MovedTask"][];
        };
        MovedTask: {
            column_id: string;
            id: string;
            sort_key: string;
        };
        MoveColumnTasks: {
            /** Format: uuid */
            target_column_id: string;
        };
        ReorderColumnTasks: {
            task_ids: string[];
        };
        CreateTask: {
            /** Format: uuid */
            column_id: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            project_id: string;
            title: string;
            assignee_ids?: string[];
            description?: components["schemas"]["NullableTiptapDoc"];
            due_date?: string | null;
            label_ids?: string[];
            /** @description a sort key */
            sort_key?: string;
        };
        TasksBatchResponse: {
            tasks: components["schemas"]["BoardTask"][];
        };
        CreateTasksBatch: {
            /** Format: uuid */
            column_id: string;
            /** Format: uuid */
            project_id: string;
            tasks: components["schemas"]["CreateTasksBatchItem"][];
        };
        CreateTasksBatchItem: {
            /** Format: uuid */
            id: string;
            title: string;
            /** @description a sort key */
            sort_key?: string;
        };
        TaskDetailResponse: {
            archived_at: string | null;
            assignee_ids: string[];
            attachment_count: number;
            attachments: components["schemas"]["Attachment"][];
            blocker_ids: string[];
            checklist_done_count: number;
            checklist_item_count: number;
            checklist_items: components["schemas"]["ChecklistItem"][];
            column_id: string;
            column_since: string;
            comment_count: number;
            comments: components["schemas"]["Comment"][];
            cover_image_url: string | null;
            created_at: string;
            description: components["schemas"]["NullableTiptapDoc"];
            due_date: string | null;
            id: string;
            label_ids: string[];
            open_cross_project_blocker_count: number;
            project_id: string;
            series_summary: string | null;
            sort_key: string;
            title: string;
            updated_at: string;
        };
        Attachment: {
            content_type: string | null;
            created_at: string;
            description: string | null;
            favicon_url: string | null;
            filename: string | null;
            id: string;
            image_url: string | null;
            is_cover: boolean;
            /** @enum {unknown} */
            kind: "file" | "image" | "link";
            preview_url: string | null;
            size_bytes: number | null;
            task_id: string;
            title: string | null;
            unfurl_state: components["schemas"]["AttachmentsUnfurlstate"];
            updated_at: string;
            url: string | null;
        };
        ChecklistItem: {
            checked: boolean;
            created_at: string;
            id: string;
            sort_key: string;
            task_id: string;
            text: string;
            updated_at: string;
        };
        Comment: {
            body: components["schemas"]["TiptapDoc"];
            created_at: string;
            id: string;
            task_id: string;
            updated_at: string;
            user_id: string;
        };
        PatchTask: {
            /** Format: uuid */
            column_id?: string;
            description?: components["schemas"]["NullableTiptapDoc"];
            due_date?: string | null;
            expected_updated_at?: string;
            /** @description a sort key */
            sort_key?: string;
            title?: string;
        };
        TaskActivityResponse: {
            activity: components["schemas"]["TaskActivity"][];
        };
        TaskActivity: {
            actor_user_id: string;
            created_at: string;
            id: string;
            /** @enum {unknown} */
            kind: "archived" | "assignee_added" | "assignee_removed" | "blocker_added" | "blocker_removed" | "checklist_item_added" | "checklist_item_checked" | "checklist_item_promoted" | "checklist_item_removed" | "checklist_item_renamed" | "checklist_item_unchecked" | "column_changed" | "created" | "description_changed" | "due_date_changed" | "label_added" | "label_removed" | "restored" | "title_changed";
            new_value: components["schemas"]["NullableActivityValue"];
            old_value: components["schemas"]["NullableActivityValue"];
        };
        NullableActivityValue: components["schemas"]["ActivityValue"] | null;
        ActivityValue: {
            doc?: components["schemas"]["NullableTiptapDoc"];
            id?: string;
            name?: string;
            text?: string;
        };
        CrossProjectDependenciesResponse: {
            blocked_by: components["schemas"]["CrossProjectDependency"][];
            blocking: components["schemas"]["CrossProjectDependency"][];
            hidden_blocked_by_count: number;
            hidden_blocking_count: number;
        };
        CrossProjectDependency: {
            is_done: boolean;
            project_id: string;
            project_name: string;
            task_id: string;
            title: string;
        };
        SetTaskLabels: {
            label_ids: string[];
        };
        SetTaskAssignees: {
            user_ids: string[];
        };
        SetTaskCover: {
            image_id: string | null;
        };
        DependencyCycleError: {
            cycle: components["schemas"]["CycleTask"][];
            error: string;
        };
        CycleTask: {
            id: string | null;
            title: string | null;
        };
        AddBlocker: {
            /** Format: uuid */
            blocker_task_id: string;
        };
        BulkMovedTasksResponse: {
            moved_tasks: components["schemas"]["MovedTask"][];
            skipped_task_ids: string[];
        };
        BulkMoveTasks: {
            /** Format: uuid */
            column_id: string;
            /** Format: uuid */
            project_id: string;
            task_ids: string[];
        };
        BulkArchivedTasksResponse: {
            skipped_task_ids: string[];
            tasks: components["schemas"]["ArchivedTask"][];
        };
        BulkTaskIds: {
            /** Format: uuid */
            project_id: string;
            task_ids: string[];
        };
        BulkTaskRelationsResponse: {
            skipped_task_ids: string[];
            tasks: components["schemas"]["BulkTaskRelations"][];
        };
        BulkTaskRelations: {
            assignee_ids: string[];
            blocker_ids: string[];
            label_ids: string[];
            open_cross_project_blocker_count: number;
            task_id: string;
        };
        BulkTaskLabels: {
            /** Format: uuid */
            project_id: string;
            task_ids: string[];
            add_label_ids?: string[];
            remove_label_ids?: string[];
        };
        BulkTaskAssignees: {
            /** Format: uuid */
            project_id: string;
            task_ids: string[];
            add_user_ids?: string[];
            remove_user_ids?: string[];
        };
        MyTasksResponse: {
            tasks: components["schemas"]["MyTask"][];
            waiting_on_you: components["schemas"]["MyTaskPersonGroup"][];
            you_are_waiting_on: components["schemas"]["MyTaskPersonGroup"][];
        };
        MyTask: {
            assignee_ids: string[];
            blocked_by: components["schemas"]["MyTaskLink"][];
            blocking: components["schemas"]["MyTaskLink"][];
            /** @enum {unknown} */
            bucket: "blocked" | "blocking" | "ready";
            column_name: string;
            hidden_blocked_by_count: number;
            hidden_blocking_count: number;
            id: string;
            project_id: string;
            project_name: string;
            title: string;
            waiting_user_ids: string[];
        };
        MyTaskLink: {
            assignee_ids: string[];
            id: string;
            project_id: string;
            title: string;
        };
        MyTaskPersonGroup: {
            tasks: components["schemas"]["MyTaskLink"][];
            user_id: string | null;
        };
        SearchResponse: {
            results: components["schemas"]["SearchResult"][];
            truncated: boolean;
        };
        SearchResult: {
            column_name: string;
            project_id: string;
            project_name: string;
            task_id: string;
            title: string;
        };
        Label: {
            color: string;
            id: string;
            name: string;
            project_id: string;
        };
        CreateLabel: {
            color: string;
            /** Format: uuid */
            id: string;
            name: string;
            /** Format: uuid */
            project_id: string;
        };
        PatchLabel: {
            color?: string;
            name?: string;
        };
        CreateComment: {
            body: components["schemas"]["TiptapDoc"];
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            task_id: string;
        };
        PatchComment: {
            body: components["schemas"]["TiptapDoc"];
        };
        CreateChecklistItem: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            task_id: string;
            text: string;
            checked?: boolean;
            /** @description a sort key */
            sort_key?: string;
        };
        PatchChecklistItem: {
            checked?: boolean;
            /** @description a sort key */
            sort_key?: string;
            text?: string;
        };
        CreateLinkAttachment: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            task_id: string;
            url: string;
            title?: string | null;
        };
        PatchAttachment: {
            description?: string | null;
            title?: string | null;
        };
        FeedbackResponse: {
            created_at: string;
            id: string;
        };
        CreateFeedback: {
            /** Format: uuid */
            id: string;
            message: string;
            page_path?: string | null;
        };
        Webhook: {
            consecutive_failures: number;
            created_at: string;
            disabled_at: string | null;
            id: string;
            project_id: string;
            url: string;
            secret?: string;
        };
        CreateWebhook: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            project_id: string;
            url: string;
        };
        WebhooksListResponse: {
            webhooks: components["schemas"]["Webhook"][];
        };
        PatchWebhook: {
            disabled_at?: string | null;
            url?: string;
        };
        WebhookDeliveriesResponse: {
            deliveries: components["schemas"]["WebhookDelivery"][];
        };
        WebhookDelivery: {
            attempt_count: number;
            created_at: string;
            event_type: string;
            id: string;
            last_attempt_at: string | null;
            last_error: string | null;
            last_status_code: number | null;
            next_attempt_at: string | null;
            payload: unknown;
            redelivery_count: number;
            /** @enum {unknown} */
            status: "delivered" | "failed" | "pending";
            webhook_id: string;
        };
        TaskSeriesListResponse: {
            series: components["schemas"]["TaskSeries"][];
        };
        TaskSeries: {
            assignee_ids: string[];
            checklist_items: components["schemas"]["TaskSeriesChecklistItem"][];
            column_id: string | null;
            created_at: string;
            created_by: string | null;
            description: components["schemas"]["NullableTiptapDoc"];
            due_date: string | null;
            ended_at: string | null;
            id: string;
            label_ids: string[];
            last_error: string | null;
            last_missed_date: string | null;
            last_occurrence_date: string | null;
            missed_occurrence_count: number;
            next_occurrence_date: string | null;
            open_occurrence_count: number;
            preset: components["schemas"]["SeriesPreset"];
            project_id: string;
            rrule: string;
            start_date: string;
            /** @enum {unknown} */
            status: "active" | "ended" | "paused";
            summary: string;
            timezone: string;
            title: string;
            updated_at: string;
        };
        TaskSeriesChecklistItem: {
            id: string;
            text: string;
        };
        SeriesPreset: "daily" | "monthly_date" | "monthly_weekday" | "weekdays" | "weekly" | "yearly" | null;
        TaskSeriesCreateResponse: {
            assignee_ids: string[];
            checklist_items: components["schemas"]["TaskSeriesChecklistItem"][];
            column_id: string | null;
            created_at: string;
            created_by: string | null;
            description: components["schemas"]["NullableTiptapDoc"];
            dropped_image_count: number;
            due_date: string | null;
            ended_at: string | null;
            id: string;
            label_ids: string[];
            last_error: string | null;
            last_missed_date: string | null;
            last_occurrence_date: string | null;
            missed_occurrence_count: number;
            next_occurrence_date: string | null;
            open_occurrence_count: number;
            preset: components["schemas"]["SeriesPreset"];
            project_id: string;
            rrule: string;
            start_date: string;
            /** @enum {unknown} */
            status: "active" | "ended" | "paused";
            summary: string;
            timezone: string;
            title: string;
            updated_at: string;
        };
        CreateTaskSeries: {
            /** Format: uuid */
            column_id: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            project_id: string;
            start_date: string;
            timezone: string;
            title: string;
            assignee_ids?: string[];
            checklist_items?: components["schemas"]["RequestBodyChecklistitems"][];
            description?: components["schemas"]["NullableTiptapDoc"];
            due_date?: string | null;
            label_ids?: string[];
            /** @enum {unknown} */
            preset?: "daily" | "monthly_date" | "monthly_weekday" | "weekdays" | "weekly" | "yearly";
            rrule?: string;
        };
        RequestBodyChecklistitems: {
            text: string;
        };
        PatchTaskSeries: {
            assignee_ids?: string[];
            checklist_items?: components["schemas"]["RequestBodyChecklistitems"][];
            clear_missed?: boolean;
            /** Format: uuid */
            column_id?: string;
            description?: components["schemas"]["NullableTiptapDoc"];
            due_date?: string | null;
            label_ids?: string[];
            /** @enum {unknown} */
            preset?: "daily" | "monthly_date" | "monthly_weekday" | "weekdays" | "weekly" | "yearly";
            rrule?: string;
            start_date?: string;
            /** @enum {unknown} */
            status?: "active" | "paused";
            timezone?: string;
            title?: string;
        };
        PublicBoard: {
            attachments: components["schemas"]["Attachment"][];
            checklist_items: components["schemas"]["PublicBoardChecklistItem"][];
            columns: components["schemas"]["BoardColumn"][];
            comments: components["schemas"]["Comment"][];
            labels: components["schemas"]["BoardLabel"][];
            project: components["schemas"]["PublicBoardProject"];
            tasks: components["schemas"]["PublicBoardTask"][];
            users: components["schemas"]["User"][];
        };
        PublicBoardChecklistItem: {
            checked: boolean;
            id: string;
            sort_key: string;
            task_id: string;
            text: string;
        };
        PublicBoardProject: {
            description: string;
            id: string;
            name: string;
        };
        PublicBoardTask: {
            assignee_ids: string[];
            attachment_count: number;
            blocker_ids: string[];
            checklist_done_count: number;
            checklist_item_count: number;
            column_id: string;
            comment_count: number;
            cover_image_url: string | null;
            description: components["schemas"]["NullableTiptapDoc"];
            due_date: string | null;
            id: string;
            label_ids: string[];
            sort_key: string;
            title: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    postApiAuthSignup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SignupRequest"];
            };
        };
        responses: {
            /** @description Account created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthResponse"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthLogin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Logged in */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthResponse"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthForgotPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForgotPassword"];
            };
        };
        responses: {
            /** @description Reset email sent */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthResetPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResetPassword"];
            };
        };
        responses: {
            /** @description Password reset */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthResponse"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthVerifyEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmailTokenRequest"];
            };
        };
        responses: {
            /** @description Address verified */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthUnsubscribe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmailTokenRequest"];
            };
        };
        responses: {
            /** @description The notification kind that was switched off */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnsubscribeResponse"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthUnsubscribeAll: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmailTokenRequest"];
            };
        };
        responses: {
            /** @description All notification email switched off */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthUnsubscribeOneClick: {
        parameters: {
            query: {
                /** @description The unsubscribe token from the mailed link */
                token: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Notification kind switched off */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unprocessable request */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthLogout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Session deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiAuthMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authenticated user */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiAuthMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeleteAccount"];
            };
        };
        responses: {
            /** @description Account deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description The caller still owns projects that have other members */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteAccountConflict"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchApiAuthMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchMe"];
            };
        };
        responses: {
            /** @description Updated user */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiAuthTokens: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Personal access tokens */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonalAccessTokensResponse"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthTokens: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePersonalAccessToken"];
            };
        };
        responses: {
            /** @description Token created; the secret is in this response only */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedPersonalAccessToken"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiAuthTokensById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Token revoked */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiAuthSessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Live sessions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionsResponse"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiAuthSessionsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Session revoked */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthChangePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePassword"];
            };
        };
        responses: {
            /** @description Password changed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthVerifyEmailResend: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Verification email sent, or already verified */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiAuthMeExport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Account export manifest */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountExport"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiAuthMeNotificationSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current notification settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationSettings"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putApiAuthMeNotificationSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationSettingsUpdate"];
            };
        };
        responses: {
            /** @description Updated notification settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationSettings"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAuthMeAvatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                };
            };
        };
        responses: {
            /** @description Updated user */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Payload Too Large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable request */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiAuthMeAvatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Updated user */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiUsers: {
        parameters: {
            query?: {
                email?: string;
                project_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Visible users */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UsersResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiProjects: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Accessible projects with task counts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectsListResponse"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiProjects: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateProject"];
            };
        };
        responses: {
            /** @description Created project as a full board payload */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BoardResponse"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiProjectsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Board payload */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BoardResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiProjectsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Project deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchApiProjectsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchProject"];
            };
        };
        responses: {
            /** @description Updated project */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiProjectsByIdArchivedTasks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived tasks, newest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArchivedTasksResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiProjectsByIdExport: {
        parameters: {
            query?: {
                format?: "json" | "zip";
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Project export archive, or the manifest alone with format=json */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectExport"];
                    "application/zip": string;
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Payload Too Large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putApiProjectsByIdPosition: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetProjectPosition"];
            };
        };
        responses: {
            /** @description Position set */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - the position was taken while the move was in flight */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putApiProjectsByIdSeen: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Marker moved */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putApiProjectsByIdMembers: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetProjectMembers"];
            };
        };
        responses: {
            /** @description Members set */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiProjectsByIdMembersByEmail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddProjectMemberByEmail"];
            };
        };
        responses: {
            /** @description The added member, or the pending invitation that was created */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AddMemberByEmailResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiProjectsByIdInvitations: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The project’s pending invitations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectInvitationsResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiProjectsByIdInvitationsByInvitationId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                invitationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Invitation revoked */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiProjectsByIdInvitationsByInvitationIdResend: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                invitationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Invitation resent */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putApiProjectsByIdOwner: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetProjectOwner"];
            };
        };
        responses: {
            /** @description The project with its new owner */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiInvitationsAccept: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AcceptInvitation"];
            };
        };
        responses: {
            /** @description The board that was joined, and the role held on it */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AcceptedInvitation"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiColumns: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateColumn"];
            };
        };
        responses: {
            /** @description Column created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Column"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiColumnsByIdDuplicate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Duplicate"];
            };
        };
        responses: {
            /** @description The new column and its copied cards in board-payload shape */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DuplicatedColumnResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiColumnsById: {
        parameters: {
            query?: {
                move_tasks_to?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Column deleted; its tasks, archived ones included, were moved to the target column */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MovedTasksResponse"];
                };
            };
            /** @description Empty column deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable request */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchApiColumnsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchColumn"];
            };
        };
        responses: {
            /** @description Updated column */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Column"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - the position was taken while the move was in flight */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiColumnsByIdMoveTasks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MoveColumnTasks"];
            };
        };
        responses: {
            /** @description Moved tasks with their new positions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MovedTasksResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiColumnsByIdReorder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReorderColumnTasks"];
            };
        };
        responses: {
            /** @description Reordered tasks with their new positions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MovedTasksResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiColumnsByIdArchiveTasks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Newly archived tasks in board-payload shape plus archived_at */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArchivedTasksResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTasks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTask"];
            };
        };
        responses: {
            /** @description Created task in board-payload shape */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BoardTask"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTasksByIdDuplicate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Duplicate"];
            };
        };
        responses: {
            /** @description The copy, in board-payload shape */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BoardTask"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTasksBatch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTasksBatch"];
            };
        };
        responses: {
            /** @description Created tasks in board-payload shape, in request order */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TasksBatchResponse"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiTasksById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Task detail */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskDetailResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiTasksById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Task deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable request */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchApiTasksById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchTask"];
            };
        };
        responses: {
            /** @description Updated task in board-payload shape */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BoardTask"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - the task changed since it was loaded */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiTasksByIdActivity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Activity entries, oldest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskActivityResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiTasksByIdCrossProjectDependencies: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cross-project dependencies in both directions, plus the hidden counts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CrossProjectDependenciesResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTasksByIdArchive: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived task in board-payload shape plus archived_at */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArchivedTask"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTasksByIdRestore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Restored task in board-payload shape */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BoardTask"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putApiTasksByIdLabels: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetTaskLabels"];
            };
        };
        responses: {
            /** @description Labels set */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putApiTasksByIdAssignees: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetTaskAssignees"];
            };
        };
        responses: {
            /** @description Assignees set */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putApiTasksByIdCover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetTaskCover"];
            };
        };
        responses: {
            /** @description Cover set or cleared */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTasksByIdBlockers: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddBlocker"];
            };
        };
        responses: {
            /** @description Blocker added (or already present) */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - the blocker would close a dependency cycle */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DependencyCycleError"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiTasksByIdBlockersByBlockerTaskId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                blockerTaskId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Blocker removed (or already absent) */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTasksBulkMove: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkMoveTasks"];
            };
        };
        responses: {
            /** @description The tasks that moved, with their new positions, plus what was skipped */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkMovedTasksResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTasksBulkArchive: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkTaskIds"];
            };
        };
        responses: {
            /** @description Newly archived tasks in board-payload shape, plus what was skipped */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkArchivedTasksResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTasksBulkLabels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkTaskLabels"];
            };
        };
        responses: {
            /** @description The relations of every card that changed, plus what was skipped */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkTaskRelationsResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTasksBulkAssignees: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkTaskAssignees"];
            };
        };
        responses: {
            /** @description The relations of every card that changed, plus what was skipped */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkTaskRelationsResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiMyTasks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Assigned tasks with buckets and person-level dependency groups */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyTasksResponse"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiSearch: {
        parameters: {
            query: {
                q: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Matching tasks, most relevant first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiLabels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateLabel"];
            };
        };
        responses: {
            /** @description Label created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Label"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiLabelsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Label deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchApiLabelsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchLabel"];
            };
        };
        responses: {
            /** @description Updated label */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Label"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiComments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateComment"];
            };
        };
        responses: {
            /** @description Comment created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Comment"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiCommentsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Comment deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchApiCommentsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchComment"];
            };
        };
        responses: {
            /** @description Updated comment */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Comment"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiChecklistItems: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateChecklistItem"];
            };
        };
        responses: {
            /** @description Checklist item created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChecklistItem"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiChecklistItemsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Checklist item deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchApiChecklistItemsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchChecklistItem"];
            };
        };
        responses: {
            /** @description Updated checklist item */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChecklistItem"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - the position was taken while the move was in flight */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiChecklistItemsByIdPromote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Duplicate"];
            };
        };
        responses: {
            /** @description The new task, in board-payload shape */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BoardTask"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiImagesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Image bytes (Content-Type reflects the stored image format) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiAttachmentsByIdDownload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Attachment bytes, always application/octet-stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiAttachmentsByIdPreview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description WebP image bytes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/webp": string;
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiAttachmentsByIdFavicon: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description WebP image bytes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/webp": string;
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAttachmentsFiles: {
        parameters: {
            query: {
                task_id: string;
                content_type?: string;
                filename?: string;
                id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Attachment created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Attachment"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Payload Too Large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable request */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiAttachmentsLinks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateLinkAttachment"];
            };
        };
        responses: {
            /** @description Attachment created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Attachment"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiAttachmentsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Attachment deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchApiAttachmentsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchAttachment"];
            };
        };
        responses: {
            /** @description Updated attachment */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Attachment"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiAvatarsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Avatar bytes (Content-Type reflects the stored image format) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiFeedback: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateFeedback"];
            };
        };
        responses: {
            /** @description Feedback stored */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FeedbackResponse"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiWebhooks: {
        parameters: {
            query: {
                project_id: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Webhook registrations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhooksListResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiWebhooks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateWebhook"];
            };
        };
        responses: {
            /** @description Webhook registered */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Webhook"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiWebhooksById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Webhook deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchApiWebhooksById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchWebhook"];
            };
        };
        responses: {
            /** @description Updated webhook */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Webhook"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiWebhooksByIdRotateSecret: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Webhook with its new secret */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Webhook"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiWebhooksByIdDeliveries: {
        parameters: {
            query?: {
                limit?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Delivery log */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookDeliveriesResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiWebhooksByIdDeliveriesByDeliveryIdRedeliver: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deliveryId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Delivery queued for another attempt */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiTaskSeries: {
        parameters: {
            query: {
                project_id: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Recurring series for the project */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskSeriesListResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postApiTaskSeries: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTaskSeries"];
            };
        };
        responses: {
            /** @description Created series */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskSeriesCreateResponse"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict - resource already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiTaskSeriesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Series ended */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchApiTaskSeriesById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchTaskSeries"];
            };
        };
        responses: {
            /** @description Updated series */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskSeries"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required or failed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden - insufficient permissions */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation error or domain-rule violation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOrUnprocessableError"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApiPublicProjectsByIdBoard: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Public board payload */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicBoard"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}
