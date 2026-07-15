// `data` is untyped JSON off the wire, narrowed by `type` at each apply site.
export interface RealtimeEvent {
  type: string;
  project_id: string | null;
  data: unknown;
}
