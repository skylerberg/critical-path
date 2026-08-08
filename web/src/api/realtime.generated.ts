// AUTO-GENERATED FROM /Users/skylerberg/.worktrees/critical-path-api/cross-project-deps/realtime-events.json
// DO NOT EDIT. Regenerate with: npm run generate:realtime

export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    RealtimeEvent:
      | components['schemas']['AccountUpdatedEvent']
      | components['schemas']['AttachmentCreatedEvent']
      | components['schemas']['AttachmentDeletedEvent']
      | components['schemas']['AttachmentUpdatedEvent']
      | components['schemas']['BulkTasksArchivedEvent']
      | components['schemas']['BulkTasksMovedEvent']
      | components['schemas']['BulkTasksRelationsSetEvent']
      | components['schemas']['ChecklistItemCreatedEvent']
      | components['schemas']['ChecklistItemDeletedEvent']
      | components['schemas']['ChecklistItemUpdatedEvent']
      | components['schemas']['ColumnCreatedEvent']
      | components['schemas']['ColumnDeletedEvent']
      | components['schemas']['ColumnTasksArchivedEvent']
      | components['schemas']['ColumnTasksMovedEvent']
      | components['schemas']['ColumnTasksReorderedEvent']
      | components['schemas']['ColumnUpdatedEvent']
      | components['schemas']['CommentCreatedEvent']
      | components['schemas']['CommentDeletedEvent']
      | components['schemas']['CommentUpdatedEvent']
      | components['schemas']['CrossProjectBlockersChangedEvent']
      | components['schemas']['InvitationsChangedEvent']
      | components['schemas']['LabelCreatedEvent']
      | components['schemas']['LabelDeletedEvent']
      | components['schemas']['LabelUpdatedEvent']
      | components['schemas']['ProjectChangedEvent']
      | components['schemas']['ProjectCreatedEvent']
      | components['schemas']['ProjectDeletedEvent']
      | components['schemas']['ProjectPositionUpdatedEvent']
      | components['schemas']['ProjectSeenEvent']
      | components['schemas']['ProjectUpdatedEvent']
      | components['schemas']['SeriesCreatedEvent']
      | components['schemas']['SeriesDeletedEvent']
      | components['schemas']['SeriesUpdatedEvent']
      | components['schemas']['SessionsRevokedEvent']
      | components['schemas']['TaskArchivedEvent']
      | components['schemas']['TaskCreatedEvent']
      | components['schemas']['TaskDeletedEvent']
      | components['schemas']['TaskRelationsSetEvent']
      | components['schemas']['TaskRestoredEvent']
      | components['schemas']['TaskUpdatedEvent']
      | components['schemas']['UserUpdatedEvent'];
    WebhookEvent:
      | components['schemas']['AttachmentCreatedWebhookEvent']
      | components['schemas']['AttachmentDeletedWebhookEvent']
      | components['schemas']['AttachmentUpdatedWebhookEvent']
      | components['schemas']['ChecklistItemCreatedWebhookEvent']
      | components['schemas']['ChecklistItemDeletedWebhookEvent']
      | components['schemas']['ChecklistItemUpdatedWebhookEvent']
      | components['schemas']['ColumnCreatedWebhookEvent']
      | components['schemas']['ColumnDeletedWebhookEvent']
      | components['schemas']['ColumnUpdatedWebhookEvent']
      | components['schemas']['CommentCreatedWebhookEvent']
      | components['schemas']['CommentDeletedWebhookEvent']
      | components['schemas']['CommentUpdatedWebhookEvent']
      | components['schemas']['LabelCreatedWebhookEvent']
      | components['schemas']['LabelDeletedWebhookEvent']
      | components['schemas']['LabelUpdatedWebhookEvent']
      | components['schemas']['ProjectUpdatedWebhookEvent']
      | components['schemas']['TaskArchivedWebhookEvent']
      | components['schemas']['TaskCreatedWebhookEvent']
      | components['schemas']['TaskDeletedWebhookEvent']
      | components['schemas']['TaskRelationsSetWebhookEvent']
      | components['schemas']['TaskRestoredWebhookEvent']
      | components['schemas']['TaskUpdatedWebhookEvent'];
    AccountUpdatedEvent: {
      /** @constant */
      type: 'account_updated';
      project_id: null;
      data: {
        avatar_url: string | null;
        email: string;
        email_verified: boolean;
        id: string;
        name: string;
      };
    };
    AttachmentCreatedEvent: {
      /** @constant */
      type: 'attachment_created';
      project_id: string;
      data: {
        attachment_count: number;
        content_type: string | null;
        created_at: string;
        description: string | null;
        favicon_url: string | null;
        filename: string | null;
        id: string;
        image_url: string | null;
        is_cover: boolean;
        /** @enum {unknown} */
        kind: 'file' | 'image' | 'link';
        preview_url: string | null;
        size_bytes: number | null;
        task_id: string;
        title: string | null;
        unfurl_state: 'failed' | 'ok' | 'pending' | null;
        updated_at: string;
        url: string | null;
      };
    };
    AttachmentCreatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'attachment_created';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        attachment_count: number;
        content_type: string | null;
        created_at: string;
        description: string | null;
        favicon_url: string | null;
        filename: string | null;
        id: string;
        image_url: string | null;
        is_cover: boolean;
        /** @enum {unknown} */
        kind: 'file' | 'image' | 'link';
        preview_url: string | null;
        size_bytes: number | null;
        task_id: string;
        title: string | null;
        unfurl_state: 'failed' | 'ok' | 'pending' | null;
        updated_at: string;
        url: string | null;
      };
    };
    AttachmentDeletedEvent: {
      /** @constant */
      type: 'attachment_deleted';
      project_id: string;
      data: {
        attachment_count: number;
        cover_image_url: string | null;
        id: string;
        task_id: string;
      };
    };
    AttachmentDeletedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'attachment_deleted';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        attachment_count: number;
        cover_image_url: string | null;
        id: string;
        task_id: string;
      };
    };
    AttachmentUpdatedEvent: {
      /** @constant */
      type: 'attachment_updated';
      project_id: string;
      data: {
        content_type: string | null;
        created_at: string;
        description: string | null;
        favicon_url: string | null;
        filename: string | null;
        id: string;
        image_url: string | null;
        is_cover: boolean;
        /** @enum {unknown} */
        kind: 'file' | 'image' | 'link';
        preview_url: string | null;
        size_bytes: number | null;
        task_id: string;
        title: string | null;
        unfurl_state: 'failed' | 'ok' | 'pending' | null;
        updated_at: string;
        url: string | null;
      };
    };
    AttachmentUpdatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'attachment_updated';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        content_type: string | null;
        created_at: string;
        description: string | null;
        favicon_url: string | null;
        filename: string | null;
        id: string;
        image_url: string | null;
        is_cover: boolean;
        /** @enum {unknown} */
        kind: 'file' | 'image' | 'link';
        preview_url: string | null;
        size_bytes: number | null;
        task_id: string;
        title: string | null;
        unfurl_state: 'failed' | 'ok' | 'pending' | null;
        updated_at: string;
        url: string | null;
      };
    };
    BulkTasksArchivedEvent: {
      /** @constant */
      type: 'bulk_tasks_archived';
      project_id: string;
      data: {
        tasks: {
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
          description: {
            /** @constant */
            type: 'doc';
            content?: unknown[];
          } | null;
          due_date: string | null;
          id: string;
          label_ids: string[];
          open_cross_project_blocker_count: number;
          sort_key: string;
          title: string;
          updated_at: string;
        }[];
      };
    };
    BulkTasksMovedEvent: {
      /** @constant */
      type: 'bulk_tasks_moved';
      project_id: string;
      data: {
        moved_tasks: {
          column_id: string;
          id: string;
          sort_key: string;
        }[];
      };
    };
    BulkTasksRelationsSetEvent: {
      /** @constant */
      type: 'bulk_tasks_relations_set';
      project_id: string;
      data: {
        tasks: {
          assignee_ids: string[];
          blocker_ids: string[];
          label_ids: string[];
          open_cross_project_blocker_count: number;
          task_id: string;
        }[];
      };
    };
    ChecklistItemCreatedEvent: {
      /** @constant */
      type: 'checklist_item_created';
      project_id: string;
      data: {
        checked: boolean;
        checklist_done_count: number;
        checklist_item_count: number;
        created_at: string;
        id: string;
        sort_key: string;
        task_id: string;
        text: string;
        updated_at: string;
      };
    };
    ChecklistItemCreatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'checklist_item_created';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        checked: boolean;
        checklist_done_count: number;
        checklist_item_count: number;
        created_at: string;
        id: string;
        sort_key: string;
        task_id: string;
        text: string;
        updated_at: string;
      };
    };
    ChecklistItemDeletedEvent: {
      /** @constant */
      type: 'checklist_item_deleted';
      project_id: string;
      data: {
        checklist_done_count: number;
        checklist_item_count: number;
        id: string;
        task_id: string;
      };
    };
    ChecklistItemDeletedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'checklist_item_deleted';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        checklist_done_count: number;
        checklist_item_count: number;
        id: string;
        task_id: string;
      };
    };
    ChecklistItemUpdatedEvent: {
      /** @constant */
      type: 'checklist_item_updated';
      project_id: string;
      data: {
        checked: boolean;
        checklist_done_count: number;
        checklist_item_count: number;
        created_at: string;
        id: string;
        sort_key: string;
        task_id: string;
        text: string;
        updated_at: string;
      };
    };
    ChecklistItemUpdatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'checklist_item_updated';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        checked: boolean;
        checklist_done_count: number;
        checklist_item_count: number;
        created_at: string;
        id: string;
        sort_key: string;
        task_id: string;
        text: string;
        updated_at: string;
      };
    };
    ColumnCreatedEvent: {
      /** @constant */
      type: 'column_created';
      project_id: string;
      data: {
        created_at: string;
        id: string;
        is_done: boolean;
        name: string;
        project_id: string;
        sort_key: string;
      };
    };
    ColumnCreatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'column_created';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        created_at: string;
        id: string;
        is_done: boolean;
        name: string;
        project_id: string;
        sort_key: string;
      };
    };
    ColumnDeletedEvent: {
      /** @constant */
      type: 'column_deleted';
      project_id: string;
      data: {
        id: string;
        moved_tasks: {
          column_id: string;
          id: string;
          sort_key: string;
        }[];
      };
    };
    ColumnDeletedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'column_deleted';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        id: string;
        moved_tasks: {
          column_id: string;
          id: string;
          sort_key: string;
        }[];
      };
    };
    ColumnTasksArchivedEvent: {
      /** @constant */
      type: 'column_tasks_archived';
      project_id: string;
      data: {
        column_id: string;
        tasks: {
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
          description: {
            /** @constant */
            type: 'doc';
            content?: unknown[];
          } | null;
          due_date: string | null;
          id: string;
          label_ids: string[];
          open_cross_project_blocker_count: number;
          sort_key: string;
          title: string;
          updated_at: string;
        }[];
      };
    };
    ColumnTasksMovedEvent: {
      /** @constant */
      type: 'column_tasks_moved';
      project_id: string;
      data: {
        column_id: string;
        moved_tasks: {
          column_id: string;
          id: string;
          sort_key: string;
        }[];
        target_column_id: string;
      };
    };
    ColumnTasksReorderedEvent: {
      /** @constant */
      type: 'column_tasks_reordered';
      project_id: string;
      data: {
        column_id: string;
        moved_tasks: {
          column_id: string;
          id: string;
          sort_key: string;
        }[];
      };
    };
    ColumnUpdatedEvent: {
      /** @constant */
      type: 'column_updated';
      project_id: string;
      data: {
        created_at: string;
        id: string;
        is_done: boolean;
        name: string;
        project_id: string;
        sort_key: string;
      };
    };
    ColumnUpdatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'column_updated';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        created_at: string;
        id: string;
        is_done: boolean;
        name: string;
        project_id: string;
        sort_key: string;
      };
    };
    CommentCreatedEvent: {
      /** @constant */
      type: 'comment_created';
      project_id: string;
      data: {
        body: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        };
        comment_count: number;
        created_at: string;
        id: string;
        task_id: string;
        updated_at: string;
        user_id: string;
      };
    };
    CommentCreatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'comment_created';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        body: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        };
        comment_count: number;
        created_at: string;
        id: string;
        task_id: string;
        updated_at: string;
        user_id: string;
      };
    };
    CommentDeletedEvent: {
      /** @constant */
      type: 'comment_deleted';
      project_id: string;
      data: {
        comment_count: number;
        id: string;
        task_id: string;
      };
    };
    CommentDeletedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'comment_deleted';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        comment_count: number;
        id: string;
        task_id: string;
      };
    };
    CommentUpdatedEvent: {
      /** @constant */
      type: 'comment_updated';
      project_id: string;
      data: {
        body: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        };
        created_at: string;
        id: string;
        task_id: string;
        updated_at: string;
        user_id: string;
      };
    };
    CommentUpdatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'comment_updated';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        body: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        };
        created_at: string;
        id: string;
        task_id: string;
        updated_at: string;
        user_id: string;
      };
    };
    CrossProjectBlockersChangedEvent: {
      /** @constant */
      type: 'cross_project_blockers_changed';
      project_id: string;
      data: {
        tasks: {
          open_cross_project_blocker_count: number;
          task_id: string;
        }[];
      };
    };
    InvitationsChangedEvent: {
      /** @constant */
      type: 'invitations_changed';
      project_id: string;
      data: {
        project_id: string;
      };
    };
    LabelCreatedEvent: {
      /** @constant */
      type: 'label_created';
      project_id: string;
      data: {
        color: string;
        id: string;
        name: string;
        project_id: string;
      };
    };
    LabelCreatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'label_created';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        color: string;
        id: string;
        name: string;
        project_id: string;
      };
    };
    LabelDeletedEvent: {
      /** @constant */
      type: 'label_deleted';
      project_id: string;
      data: {
        id: string;
      };
    };
    LabelDeletedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'label_deleted';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        id: string;
      };
    };
    LabelUpdatedEvent: {
      /** @constant */
      type: 'label_updated';
      project_id: string;
      data: {
        color: string;
        id: string;
        name: string;
        project_id: string;
      };
    };
    LabelUpdatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'label_updated';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        color: string;
        id: string;
        name: string;
        project_id: string;
      };
    };
    ProjectChangedEvent: {
      /** @constant */
      type: 'project_changed';
      project_id: string;
      data: {
        actor_user_id: string | null;
        id: string;
      };
    };
    ProjectCreatedEvent: {
      /** @constant */
      type: 'project_created';
      project_id: string;
      data: {
        archived_at: string | null;
        color:
          | 'amber'
          | 'emerald'
          | 'fuchsia'
          | 'lime'
          | 'rose'
          | 'sky'
          | 'slate'
          | 'violet'
          | null;
        created_at: string;
        created_by: string | null;
        description: string;
        done_task_count: number;
        id: string;
        is_public: boolean;
        member_ids: string[];
        members: {
          /** @enum {unknown} */
          role: 'editor' | 'viewer';
          user_id: string;
        }[];
        name: string;
        open_task_count: number;
      };
    };
    ProjectDeletedEvent: {
      /** @constant */
      type: 'project_deleted';
      project_id: string;
      data: {
        id: string;
      };
    };
    ProjectPositionUpdatedEvent: {
      /** @constant */
      type: 'project_position_updated';
      project_id: string;
      data: {
        id: string;
        sort_key: string;
      };
    };
    ProjectSeenEvent: {
      /** @constant */
      type: 'project_seen';
      project_id: string;
      data: {
        id: string;
      };
    };
    ProjectUpdatedEvent: {
      /** @constant */
      type: 'project_updated';
      project_id: string;
      data: {
        archived_at: string | null;
        color:
          | 'amber'
          | 'emerald'
          | 'fuchsia'
          | 'lime'
          | 'rose'
          | 'sky'
          | 'slate'
          | 'violet'
          | null;
        created_at: string;
        created_by: string | null;
        description: string;
        done_task_count: number;
        id: string;
        is_public: boolean;
        member_ids: string[];
        members: {
          /** @enum {unknown} */
          role: 'editor' | 'viewer';
          user_id: string;
        }[];
        name: string;
        open_task_count: number;
      };
    };
    ProjectUpdatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'project_updated';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        archived_at: string | null;
        color:
          | 'amber'
          | 'emerald'
          | 'fuchsia'
          | 'lime'
          | 'rose'
          | 'sky'
          | 'slate'
          | 'violet'
          | null;
        created_at: string;
        created_by: string | null;
        description: string;
        done_task_count: number;
        id: string;
        is_public: boolean;
        member_ids: string[];
        members: {
          /** @enum {unknown} */
          role: 'editor' | 'viewer';
          user_id: string;
        }[];
        name: string;
        open_task_count: number;
      };
    };
    SeriesCreatedEvent: {
      /** @constant */
      type: 'series_created';
      project_id: string;
      data: {
        assignee_ids: string[];
        checklist_items: {
          id: string;
          text: string;
        }[];
        column_id: string | null;
        created_at: string;
        created_by: string | null;
        description: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        } | null;
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
        preset: string | null;
        project_id: string;
        rrule: string;
        start_date: string;
        status: string;
        summary: string;
        timezone: string;
        title: string;
        updated_at: string;
      };
    };
    SeriesDeletedEvent: {
      /** @constant */
      type: 'series_deleted';
      project_id: string;
      data: {
        id: string;
      };
    };
    SeriesUpdatedEvent: {
      /** @constant */
      type: 'series_updated';
      project_id: string;
      data: {
        assignee_ids: string[];
        checklist_items: {
          id: string;
          text: string;
        }[];
        column_id: string | null;
        created_at: string;
        created_by: string | null;
        description: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        } | null;
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
        preset: string | null;
        project_id: string;
        rrule: string;
        start_date: string;
        status: string;
        summary: string;
        timezone: string;
        title: string;
        updated_at: string;
      };
    };
    SessionsRevokedEvent: {
      /** @constant */
      type: 'sessions_revoked';
      project_id: null;
      data: {
        user_id: string;
        personal_access_token_id?: string;
        session_id?: string;
      };
    };
    TaskArchivedEvent: {
      /** @constant */
      type: 'task_archived';
      project_id: string;
      data: {
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
        description: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        } | null;
        due_date: string | null;
        id: string;
        label_ids: string[];
        open_cross_project_blocker_count: number;
        sort_key: string;
        title: string;
        updated_at: string;
      };
    };
    TaskArchivedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'task_archived';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
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
        description: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        } | null;
        due_date: string | null;
        id: string;
        label_ids: string[];
        open_cross_project_blocker_count: number;
        sort_key: string;
        title: string;
        updated_at: string;
      };
    };
    TaskCreatedEvent: {
      /** @constant */
      type: 'task_created';
      project_id: string;
      data: {
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
        description: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        } | null;
        due_date: string | null;
        id: string;
        label_ids: string[];
        open_cross_project_blocker_count: number;
        sort_key: string;
        title: string;
        updated_at: string;
      };
    };
    TaskCreatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'task_created';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
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
        description: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        } | null;
        due_date: string | null;
        id: string;
        label_ids: string[];
        open_cross_project_blocker_count: number;
        sort_key: string;
        title: string;
        updated_at: string;
      };
    };
    TaskDeletedEvent: {
      /** @constant */
      type: 'task_deleted';
      project_id: string;
      data: {
        id: string;
      };
    };
    TaskDeletedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'task_deleted';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        id: string;
      };
    };
    TaskRelationsSetEvent: {
      /** @constant */
      type: 'task_relations_set';
      project_id: string;
      data: {
        assignee_ids: string[];
        blocker_ids: string[];
        label_ids: string[];
        open_cross_project_blocker_count: number;
        task_id: string;
      };
    };
    TaskRelationsSetWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'task_relations_set';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
        assignee_ids: string[];
        blocker_ids: string[];
        label_ids: string[];
        open_cross_project_blocker_count: number;
        task_id: string;
      };
    };
    TaskRestoredEvent: {
      /** @constant */
      type: 'task_restored';
      project_id: string;
      data: {
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
        description: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        } | null;
        due_date: string | null;
        id: string;
        label_ids: string[];
        open_cross_project_blocker_count: number;
        sort_key: string;
        title: string;
        updated_at: string;
      };
    };
    TaskRestoredWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'task_restored';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
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
        description: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        } | null;
        due_date: string | null;
        id: string;
        label_ids: string[];
        open_cross_project_blocker_count: number;
        sort_key: string;
        title: string;
        updated_at: string;
      };
    };
    TaskUpdatedEvent: {
      /** @constant */
      type: 'task_updated';
      project_id: string;
      data: {
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
        description: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        } | null;
        due_date: string | null;
        id: string;
        label_ids: string[];
        open_cross_project_blocker_count: number;
        sort_key: string;
        title: string;
        updated_at: string;
      };
    };
    TaskUpdatedWebhookEvent: {
      /** @description Delivery id, unique per receiver per event */
      id: string;
      /** @constant */
      version: 1;
      /** @constant */
      type: 'task_updated';
      project_id: string;
      /** Format: date-time */
      created_at: string;
      data: {
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
        description: {
          /** @constant */
          type: 'doc';
          content?: unknown[];
        } | null;
        due_date: string | null;
        id: string;
        label_ids: string[];
        open_cross_project_blocker_count: number;
        sort_key: string;
        title: string;
        updated_at: string;
      };
    };
    UserUpdatedEvent: {
      /** @constant */
      type: 'user_updated';
      project_id: null;
      data: {
        avatar_url: string | null;
        id: string;
        name: string;
      };
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
