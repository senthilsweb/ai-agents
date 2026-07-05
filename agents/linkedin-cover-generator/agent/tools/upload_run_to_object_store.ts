// Durable end-of-run upload to S3-compatible object storage. Implementation
// lives in the shared Agent Runtime Kit (see openspec change
// `store-run-artifacts-in-object-storage`). No-op unless OBJECT_STORE_BUCKET
// is configured.
export { default } from "shared/tools/upload_run_to_object_store.js";
