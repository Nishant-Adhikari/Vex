/**
 * Jupiter Token Content API wire-first contracts.
 * Verified from official Jupiter docs and API reference on 2026-03-30.
 *
 * Note: /content/summaries is documented in official guides and llms-full.txt,
 * but not exposed as a dedicated OpenAPI page in the docs index. Its response
 * shape below is inferred from sibling content schemas and the guide wording.
 */

export interface JupiterTokenContentUser {
  id: string | null;
  username: string | null;
  role: string | null;
  [key: string]: unknown;
}

export interface JupiterTokenContentSummary {
  summaryFull: string | null;
  summaryShort: string | null;
  updatedAt: string;
  citations: string[];
  [key: string]: unknown;
}

export interface JupiterTokenContentItem {
  contentId: string;
  content: string;
  contentType: "text" | "tweet";
  status: "pending" | "approved";
  source: string | null;
  submittedAt: string;
  submittedBy: JupiterTokenContentUser;
  updatedAt: string | null;
  updatedBy: JupiterTokenContentUser;
  postedAt: string | null;
  [key: string]: unknown;
}

export interface JupiterTokenContentByMint {
  mint: string;
  contents: JupiterTokenContentItem[];
  tokenSummary: JupiterTokenContentSummary | null;
  newsSummary: JupiterTokenContentSummary | null;
  [key: string]: unknown;
}

export interface JupiterTokenContentMultipleMintsResponse {
  data: JupiterTokenContentByMint[];
  [key: string]: unknown;
}

export interface JupiterTokenContentPagination {
  limit: number;
  total: number;
  page: number;
  totalPages: number;
  [key: string]: unknown;
}

export interface JupiterTokenContentFeedData {
  contents: JupiterTokenContentItem[];
  tokenSummary: JupiterTokenContentSummary | null;
  newsSummary: JupiterTokenContentSummary | null;
  pagination: JupiterTokenContentPagination;
  [key: string]: unknown;
}

export interface JupiterTokenContentFeedResponse {
  data: JupiterTokenContentFeedData;
  [key: string]: unknown;
}

export interface JupiterTokenContentSummariesByMint {
  mint: string;
  tokenSummary: JupiterTokenContentSummary | null;
  newsSummary: JupiterTokenContentSummary | null;
  [key: string]: unknown;
}

export interface JupiterTokenContentSummariesResponse {
  data: JupiterTokenContentSummariesByMint[];
  [key: string]: unknown;
}

export interface JupiterTokenContentFeedParams {
  mint: string;
  page?: number;
  limit?: number;
}
