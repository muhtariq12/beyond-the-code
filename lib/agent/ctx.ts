import type { LlmProvider } from "./llm/provider";
import type { BlobStore, Store } from "./store/store";
import type { FetchLike } from "./connectors/types";
import type { SubmissionAdapter } from "./apply/adapters";

export interface Ctx {
  store: Store;
  blobs: BlobStore;
  llm: LlmProvider;
  fetch: FetchLike;
  now: () => Date;
  env: Record<string, string | undefined>;
  /** override submission adapters (tests, sandbox) */
  adapters?: Record<string, SubmissionAdapter>;
}
