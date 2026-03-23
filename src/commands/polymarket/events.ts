/**
 * `echoclaw polymarket events/event/search` — market discovery.
 */

import { Command } from "commander";
import { getPolyGammaClient } from "../../polymarket/gamma/client.js";
import { parseOutcomePrices, formatUsd, formatProbability } from "./helpers.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, infoBox, colors } from "../../utils/ui.js";
import { parseIntSafe } from "../../utils/validation.js";

export function createEventsSubcommand(): Command {
  const events = new Command("events")
    .description("Browse Polymarket prediction events")
    .option("--featured", "Only featured events")
    .option("--active", "Only active events")
    .option("--closed", "Only closed events")
    .option("--category <cat>", "Filter by category")
    .option("--tag-slug <slug>", "Filter by tag slug")
    .option("--limit <n>", "Max results", "10")
    .exitOverride()
    .action(async (options: { featured?: boolean; active?: boolean; closed?: boolean; category?: string; tagSlug?: string; limit: string }) => {
      const limit = parseIntSafe(options.limit, "limit");
      const client = getPolyGammaClient();

      const spin = spinner("Fetching events...");
      spin.start();

      const events = await client.listEvents({
        featured: options.featured,
        active: options.active ?? true,
        closed: options.closed,
        tag_slug: options.tagSlug,
        limit,
      });

      spin.succeed(`Found ${events.length} event(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ events: events.map(e => ({ id: e.id, title: e.title, slug: e.slug, category: e.category, volume: e.volume, liquidity: e.liquidity, markets: e.markets.length })) });
        return;
      }

      if (events.length === 0) {
        infoBox("Polymarket Events", "No events found.");
        return;
      }

      const lines = events.map((e) => {
        const vol = e.volume ? formatUsd(e.volume) : "—";
        const marketsCount = e.markets.length;
        return `${colors.info(e.title ?? "Untitled")} ${colors.muted(`[${e.id}]`)}\n  ${e.category ?? "—"} | ${marketsCount} market(s) | Vol: ${vol}`;
      });

      infoBox("Polymarket Events", lines.join("\n\n"));
    });

  return events;
}

export function createEventSubcommand(): Command {
  return new Command("event")
    .description("Get Polymarket event details")
    .argument("<id-or-slug>", "Event ID or slug")
    .exitOverride()
    .action(async (idOrSlug: string) => {
      const client = getPolyGammaClient();
      const spin = spinner("Fetching event...");
      spin.start();

      const isNumeric = /^\d+$/.test(idOrSlug);
      const event = isNumeric ? await client.getEvent(idOrSlug) : await client.getEventBySlug(idOrSlug);
      spin.succeed("Event loaded");

      if (isHeadless()) {
        writeJsonSuccess({ event });
        return;
      }

      const lines = [
        `${colors.info(event.title ?? "Untitled")}`,
        event.description ? `${event.description.slice(0, 200)}` : "",
        `Category: ${event.category ?? "—"} | Vol: ${formatUsd(event.volume)} | Liq: ${formatUsd(event.liquidity)}`,
        "",
        ...event.markets.map((m) => {
          const prices = parseOutcomePrices(m.outcomePrices);
          return `  ${m.question ?? "?"}\n    YES: ${formatProbability(prices.yes)} | NO: ${formatProbability(prices.no)} | Vol: ${formatUsd(m.volumeNum)}`;
        }),
      ];

      infoBox(`Event: ${event.title ?? idOrSlug}`, lines.join("\n"));
    });
}

export function createSearchSubcommand(): Command {
  return new Command("search")
    .description("Search Polymarket markets and events")
    .argument("<query>", "Search query")
    .option("--limit <n>", "Max results per type", "5")
    .exitOverride()
    .action(async (query: string, options: { limit: string }) => {
      const client = getPolyGammaClient();
      const spin = spinner("Searching...");
      spin.start();

      const result = await client.search(query, { limit_per_type: parseIntSafe(options.limit, "limit") });
      spin.succeed("Search complete");

      if (isHeadless()) {
        writeJsonSuccess({ events: result.events, tags: result.tags, profiles: result.profiles, pagination: result.pagination });
        return;
      }

      const lines: string[] = [];
      if (result.events && result.events.length > 0) {
        lines.push(colors.info("Events:"));
        for (const e of result.events) {
          lines.push(`  ${e.title ?? "Untitled"} ${colors.muted(`[${e.slug ?? e.id}]`)}`);
        }
      }
      if (result.tags && result.tags.length > 0) {
        lines.push(colors.info("\nTags:"));
        for (const t of result.tags) {
          lines.push(`  ${t.label} (${t.event_count} events)`);
        }
      }
      if (result.profiles && result.profiles.length > 0) {
        lines.push(colors.info("\nProfiles:"));
        for (const p of result.profiles) {
          lines.push(`  ${p.name ?? p.pseudonym ?? "Anonymous"} ${colors.muted(p.proxyWallet ?? "")}`);
        }
      }

      infoBox(`Search: "${query}"`, lines.length > 0 ? lines.join("\n") : "No results found.");
    });
}
