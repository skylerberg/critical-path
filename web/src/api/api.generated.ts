// AUTO-GENERATED FROM /Users/skylerberg/Code/critical-path-api/.claude/worktrees/account-export/openapi.json
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
         * @description List the caller's personal access tokens, newest first. Secrets are never returned. Expired tokens stay listed until they are revoked.
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
         * @description Change the password of the authenticated user. Requires the current password; on success every existing session is revoked and a fresh session token is returned, keeping this client logged in.
         */
        post: operations["postApiAuthChangePassword"];
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
         * @description Email a password-reset link if an account with that address exists. Always responds 204 so the response never reveals whether the email is registered.
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
         * @description Set a new password using a token from a password-reset email. On success every session is revoked and outstanding reset tokens are invalidated.
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
         * @description Return which notification emails the authenticated user has switched on. Both default to true. They are read here rather than on the user record because that record is published to everyone sharing a project and a preference is private.
         */
        get: operations["getApiAuthMeNotificationSettings"];
        /**
         * Set notification settings
         * @description Replace the full set of notification preferences for the authenticated user. A preference stays meaningful while the address is unverified — no mail is sent then either way — so the toggles are never forced off.
         */
        put: operations["putApiAuthMeNotificationSettings"];
        post?: never;
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
         * @description List projects the caller can access (created by them or shared with them as a member) with member ids, member roles, open and done task counts, and the caller's personal sort position (null when never set). Archived tasks count toward neither total. Ordered by position (nulls last), then created_at, then id.
         */
        get: operations["getApiProjects"];
        put?: never;
        /**
         * Create project
         * @description Create a project with the default Backlog / To Do / In Progress / Done columns, or deep-copy an existing project by passing source_project_id (copies columns, labels, tasks, task labels, dependencies, and images — not comments, assignees, members, archived cards, or the archived state of the project itself; copies start personal). Returns 422 when source_project_id does not reference an existing project and 404 when it references a project the caller cannot access.
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
         * @description Get a project with its columns, tasks (including label, assignee, and blocker ids plus image counts), and labels in one payload. Archived tasks are excluded, as are archived tasks appearing as blockers of the tasks that are included.
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
         * @description Update project fields. Set archived_at to an ISO timestamp to archive or null to unarchive. Set is_public to true to publish the board read-only at GET /api/public/projects/:id/board, which serves card titles, descriptions and their embedded images, labels, blockers, and assignee names and avatars to anyone with the project id and no account. Set it back to false to stop serving it. Editors only: a viewer gets 403 and non-accessors 404.
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
         * @description Download everything in a project. The default zip holds project.json (the manifest below), tasks.csv (one row per task, for spreadsheets), and images/ with the real bytes of every attached image, so the archive survives losing the account. Archived cards are exported too, after the live ones, each carrying the archived_at that marks it and the column_id it was archived from; a live card has archived_at null. Pass format=json for the manifest alone. The manifest is the documented, stable interchange format the importer reads back: format identifies it, version is bumped only on a breaking shape change, and ids are the original server ids — created_by, member_ids and assignee_ids resolve against users[], label_ids against labels[], column_id against columns[], and blocker_ids against tasks[]. Task descriptions are stored verbatim, so their embedded /api/images/<uuid> sources resolve by id against the flattened tasks[].images[]. Each image entry carries the archive-relative path of its file. Every project member may export; the export is free and never gated. A project whose images would exceed the 4 GiB zip ceiling answers 413 and must be exported with format=json, which carries no image bytes — fetch those from GET /api/images/{id}, one per tasks[].images[].id.
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
         * @description Set the caller's personal sort position for a project. Positions are per user and order the project list for the caller only; other members are unaffected.
         */
        put: operations["putApiProjectsByIdPosition"];
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
         * @description Copy a column and every live card in it into the same project. The new column keeps the source’s name and done flag; each copied card keeps its title, description, due date, labels, assignees, images, cover image and its position, so the cards land in the same relative order. A dependency edge is copied only when both of its ends are inside the copied set, so edges between two cards in the column survive and edges leaving it do not. Archived cards are not copied, and neither are comments or activity history — each copy’s log starts with its own created entry. The client supplies the new column id and its position; a duplicate id returns 409. One column_created event is published plus one task_created per copied card.
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
         * @description Update the name, position, or done flag of a column.
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
         * @description Create a task in a column. The client supplies the task id. An unknown or inaccessible project returns 404. The column must belong to the project, labels must belong to the project, and assignees must be users with access to the project; those violations return 422 with a plain error body. due_date is an optional calendar day (YYYY-MM-DD, no time and no timezone); anything else returns 422.
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
         * @description Copy a task into the same column. The copy carries the title, description, due date, labels, assignees, images and cover image of the original, each image copied to its own stored object so deleting one leaves the other intact. It carries no dependency edges: a copy keeps an edge only when both of its ends are copied too, which one card never is. It carries no comments and no activity history either — the copy’s log starts with its own created entry. Duplicating an archived task produces a live card. The client supplies the new id and its position; a duplicate id returns 409.
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
         * @description Create between 1 and 100 tasks in one column of one project in a single request, for pasting a list. The client supplies every task id, so a retry after a dropped response cannot double-create. Each item carries only a title and a position: descriptions, due dates, labels and assignees are set afterwards with the single-task endpoints. The batch is all or nothing — a duplicate id, whether it already exists or is repeated inside the batch, returns 409 and creates none of them. An unknown or inaccessible project returns 404 and a column_id outside the project returns 422. Each created task gets its own created activity entry and its own task_created event.
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
         * @description Get a task in board-payload shape plus its project id, archived_at (null unless the task is archived), images, and its full comment stream oldest first. Archived tasks are readable here even though they are absent from every board payload.
         */
        get: operations["getApiTasksById"];
        put?: never;
        post?: never;
        /**
         * Delete a task
         * @description Delete a task. Dependencies, labels, assignees, and images cascade; stored image objects are removed after commit.
         */
        delete: operations["deleteApiTasksById"];
        options?: never;
        head?: never;
        /**
         * Update a task
         * @description Update title, description (a Tiptap doc, or null to clear it), due_date (a calendar day YYYY-MM-DD, or null to clear it; omit it to leave it alone), or move the task by sending column_id and position together. The new column must belong to the task’s project and due_date must be a real calendar day; violations return 422 with a plain error body. updated_at is bumped only when the patch changes title or description — a pure move or due-date change leaves it untouched. expected_updated_at is an optimistic-concurrency precondition on the task’s content: it is honored only when the patch includes title or description, a patch that only moves the task or sets its due date is always last-write-wins and ignores it, and a precondition that does not match the stored updated_at returns 409 and writes nothing.
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
    "/api/tasks/{id}/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload task image
         * @description Attach an image to a task via multipart form data. The stored content type is determined solely by magic-byte sniffing (PNG, JPEG, GIF, or WebP); the client-declared MIME type is ignored. Maximum file size 10 MB. An optional `id` field supplies the image id (server-generated when omitted).
         */
        post: operations["postApiTasksByIdImages"];
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
    "/api/images/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get image
         * @description Serve image bytes with the Content-Type recorded at upload. Unauthenticated: the unguessable image id acts as a capability URL so <img> tags work without auth headers.
         */
        get: operations["getApiImagesById"];
        put?: never;
        post?: never;
        /**
         * Delete image
         * @description Delete an image row; the stored object is removed after the transaction commits.
         */
        delete: operations["deleteApiImagesById"];
        options?: never;
        head?: never;
        patch?: never;
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
         * @description Serve avatar image bytes by storage key. Unauthenticated: the unguessable key acts as a capability URL so <img> tags work without auth headers. Every avatar upload mints a fresh key, so responses are immutable and cacheable forever.
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
         * @description List a project's webhook registrations, oldest first, including their signing secrets.
         */
        get: operations["getApiWebhooks"];
        put?: never;
        /**
         * Register webhook
         * @description Register an HTTP(S) endpoint that receives a signed POST for every board event in a project. The client supplies the webhook id. A project may hold at most 10 registrations, and a URL may be registered once per project. The generated signing secret is in the response and stays readable by everyone who can access the project, viewers included. Registering, changing, deleting, rotating and re-sending are editors only: a viewer gets 403. Returns 404 when the project is unknown or inaccessible.
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
            avatar_url: components["schemas"]["UserAvatarurl"];
            email: string;
            email_verified: boolean;
            id: string;
            name: string;
        };
        UserAvatarurl: string | null;
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
            expires_at: components["schemas"]["UserAvatarurl"];
            id: string;
            name: string;
        };
        CreatePersonalAccessToken: {
            /** Format: uuid */
            id: string;
            name: string;
            expires_at?: components["schemas"]["UserAvatarurl"];
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
            user_agent: components["schemas"]["UserAvatarurl"];
        };
        ChangePassword: {
            current_password: string;
            new_password: string;
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
        AccountExport: {
            account: {
                avatar_url: components["schemas"]["UserAvatarurl"];
                created_at: string;
                email: string;
                email_verified_at: components["schemas"]["UserAvatarurl"];
                id: string;
                name: string;
                notification_settings: components["schemas"]["NotificationSettings"];
            };
            exported_at: string;
            feedback: {
                created_at: string;
                id: string;
                message: string;
                page_path: components["schemas"]["UserAvatarurl"];
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
                user_agent: components["schemas"]["UserAvatarurl"];
            }[];
            version: number;
        };
        NotificationSettings: {
            added_to_project: boolean;
            task_assigned: boolean;
        };
        UnsubscribeResponse: {
            /** @enum {unknown} */
            kind: "added_to_project" | "task_assigned";
        };
        UsersResponse: {
            users: components["schemas"]["User"][];
        };
        User: {
            avatar_url: components["schemas"]["UserAvatarurl"];
            id: string;
            name: string;
        };
        ProjectsListResponse: {
            projects: components["schemas"]["ProjectListItem"][];
        };
        ProjectListItem: {
            archived_at: components["schemas"]["UserAvatarurl"];
            created_at: string;
            created_by: components["schemas"]["UserAvatarurl"];
            description: string;
            done_task_count: number;
            id: string;
            is_public: boolean;
            member_ids: string[];
            members: components["schemas"]["ProjectMember"][];
            name: string;
            open_task_count: number;
            position: number | null;
        };
        ProjectMember: {
            /** @enum {unknown} */
            role: "editor" | "viewer";
            user_id: string;
        };
        BoardPayload: {
            columns: components["schemas"]["BoardColumn"][];
            labels: components["schemas"]["BoardLabel"][];
            project: components["schemas"]["Project"];
            tasks: components["schemas"]["BoardTask"][];
        };
        BoardColumn: {
            id: string;
            is_done: boolean;
            name: string;
            /** @description a finite number */
            position: number;
        };
        BoardLabel: {
            color: string;
            id: string;
            name: string;
        };
        Project: {
            archived_at: components["schemas"]["UserAvatarurl"];
            created_at: string;
            created_by: components["schemas"]["UserAvatarurl"];
            description: string;
            id: string;
            is_public: boolean;
            member_ids: string[];
            members: components["schemas"]["ProjectMember"][];
            name: string;
        };
        BoardTask: {
            assignee_ids: string[];
            blocker_ids: string[];
            column_id: string;
            column_since: string;
            comment_count: number;
            cover_image_url: components["schemas"]["UserAvatarurl"];
            created_at: string;
            description: components["schemas"]["NullableTiptapDoc"];
            due_date: components["schemas"]["UserAvatarurl"];
            id: string;
            image_count: number;
            label_ids: string[];
            /** @description a finite number */
            position: number;
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
            archived_at?: components["schemas"]["UserAvatarurl"];
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
            blocker_ids: string[];
            column_id: string;
            column_since: string;
            comment_count: number;
            cover_image_url: components["schemas"]["UserAvatarurl"];
            created_at: string;
            description: components["schemas"]["NullableTiptapDoc"];
            due_date: components["schemas"]["UserAvatarurl"];
            id: string;
            image_count: number;
            label_ids: string[];
            /** @description a finite number */
            position: number;
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
                archived_at: components["schemas"]["UserAvatarurl"];
                assignee_ids: string[];
                blocker_ids: string[];
                column_id: string;
                column_since: string;
                comment_count: number;
                cover_image_url: components["schemas"]["UserAvatarurl"];
                created_at: string;
                description: components["schemas"]["NullableTiptapDoc"];
                due_date: components["schemas"]["UserAvatarurl"];
                id: string;
                images: {
                    content_type: string;
                    created_at: string;
                    filename: string;
                    id: string;
                    path: string;
                    size_bytes: number;
                }[];
                label_ids: string[];
                /** @description a finite number */
                position: number;
                title: string;
                updated_at: string;
            }[];
            users: components["schemas"]["NamedRef"][];
            version: number;
        };
        SetProjectPosition: {
            /** @description a finite number */
            position: number;
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
            /** @description a finite number */
            position: number;
            project_id: string;
        };
        CreateColumn: {
            /** Format: uuid */
            id: string;
            name: string;
            /** @description a finite number */
            position: number;
            /** Format: uuid */
            project_id: string;
            is_done?: boolean;
        };
        DuplicatedColumnResponse: {
            column: components["schemas"]["Column"];
            tasks: components["schemas"]["BoardTask"][];
        };
        Duplicate: {
            /** Format: uuid */
            id: string;
            /** @description a finite number */
            position: number;
        };
        PatchColumn: {
            is_done?: boolean;
            name?: string;
            /** @description a finite number */
            position?: number;
        };
        MovedTasksResponse: {
            moved_tasks: components["schemas"]["MovedTask"][];
        };
        MovedTask: {
            column_id: string;
            id: string;
            /** @description a finite number */
            position: number;
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
            /** @description a finite number */
            position: number;
            /** Format: uuid */
            project_id: string;
            title: string;
            assignee_ids?: string[];
            description?: components["schemas"]["NullableTiptapDoc"];
            due_date?: components["schemas"]["UserAvatarurl"];
            label_ids?: string[];
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
            /** @description a finite number */
            position: number;
            title: string;
        };
        TaskDetailResponse: {
            archived_at: components["schemas"]["UserAvatarurl"];
            assignee_ids: string[];
            blocker_ids: string[];
            column_id: string;
            column_since: string;
            comment_count: number;
            comments: components["schemas"]["Comment"][];
            cover_image_url: components["schemas"]["UserAvatarurl"];
            created_at: string;
            description: components["schemas"]["NullableTiptapDoc"];
            due_date: components["schemas"]["UserAvatarurl"];
            id: string;
            image_count: number;
            images: components["schemas"]["ImageResponse"][];
            label_ids: string[];
            /** @description a finite number */
            position: number;
            project_id: string;
            title: string;
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
        ImageResponse: {
            content_type: string;
            created_at: string;
            filename: string;
            id: string;
            size_bytes: number;
            url: string;
        };
        PatchTask: {
            /** Format: uuid */
            column_id?: string;
            description?: components["schemas"]["NullableTiptapDoc"];
            due_date?: components["schemas"]["UserAvatarurl"];
            expected_updated_at?: string;
            /** @description a finite number */
            position?: number;
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
            kind: "archived" | "assignee_added" | "assignee_removed" | "blocker_added" | "blocker_removed" | "column_changed" | "created" | "description_changed" | "due_date_changed" | "label_added" | "label_removed" | "restored" | "title_changed";
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
            id: string;
            title: string;
        };
        AddBlocker: {
            /** Format: uuid */
            blocker_task_id: string;
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
            user_id: components["schemas"]["UserAvatarurl"];
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
        FeedbackResponse: {
            created_at: string;
            id: string;
        };
        CreateFeedback: {
            /** Format: uuid */
            id: string;
            message: string;
            page_path?: components["schemas"]["UserAvatarurl"];
        };
        Webhook: {
            consecutive_failures: number;
            created_at: string;
            disabled_at: components["schemas"]["UserAvatarurl"];
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
            disabled_at?: components["schemas"]["UserAvatarurl"];
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
            last_attempt_at: components["schemas"]["UserAvatarurl"];
            last_error: components["schemas"]["UserAvatarurl"];
            last_status_code: number | null;
            next_attempt_at: components["schemas"]["UserAvatarurl"];
            payload: unknown;
            redelivery_count: number;
            status: string;
            webhook_id: string;
        };
        PublicBoard: {
            columns: components["schemas"]["BoardColumn"][];
            comments: components["schemas"]["Comment"][];
            labels: components["schemas"]["BoardLabel"][];
            project: components["schemas"]["PublicBoardProject"];
            tasks: components["schemas"]["PublicBoardTask"][];
            users: components["schemas"]["User"][];
        };
        PublicBoardProject: {
            description: string;
            id: string;
            name: string;
        };
        PublicBoardTask: {
            assignee_ids: string[];
            blocker_ids: string[];
            column_id: string;
            comment_count: number;
            cover_image_url: components["schemas"]["UserAvatarurl"];
            description: components["schemas"]["NullableTiptapDoc"];
            due_date: components["schemas"]["UserAvatarurl"];
            id: string;
            image_count: number;
            label_ids: string[];
            /** @description a finite number */
            position: number;
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
            /** @description Password changed, all prior sessions revoked, new session issued */
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
            /** @description Accepted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
            /** @description Password reset and all sessions revoked */
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
                "application/json": components["schemas"]["NotificationSettings"];
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
                    "application/json": components["schemas"]["BoardPayload"];
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
                    "application/json": components["schemas"]["BoardPayload"];
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
    postApiTasksByIdImages: {
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
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                    /**
                     * Format: uuid
                     * @description Optional client-supplied image id
                     */
                    id?: string;
                };
            };
        };
        responses: {
            /** @description Image uploaded */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImageResponse"];
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
    deleteApiImagesById: {
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
            /** @description Image deleted */
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
