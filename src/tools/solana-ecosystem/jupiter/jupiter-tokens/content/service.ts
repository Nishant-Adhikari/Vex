/**
 * High-level Jupiter Token Content service.
 * Returns the full upstream payloads without dropping metadata.
 */

import {
  jupiterTokenContentByMints,
  jupiterTokenContentCooking,
  jupiterTokenContentFeed,
  jupiterTokenContentSummaries,
} from "./client.js";
import type {
  JupiterTokenContentFeedParams,
  JupiterTokenContentFeedResponse,
  JupiterTokenContentMultipleMintsResponse,
  JupiterTokenContentSummariesResponse,
} from "./types.js";

export async function getJupiterTokenContent(
  mints: string[],
): Promise<JupiterTokenContentMultipleMintsResponse> {
  return jupiterTokenContentByMints(mints);
}

export async function getJupiterCookingTokenContent(): Promise<JupiterTokenContentMultipleMintsResponse> {
  return jupiterTokenContentCooking();
}

export async function getJupiterTokenContentFeed(
  params: JupiterTokenContentFeedParams,
): Promise<JupiterTokenContentFeedResponse> {
  return jupiterTokenContentFeed(params);
}

export async function getJupiterTokenContentSummaries(
  mints: string[],
): Promise<JupiterTokenContentSummariesResponse> {
  return jupiterTokenContentSummaries(mints);
}
