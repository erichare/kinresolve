import type { DnaMatch, DnaSide, DnaTreeStatus } from "./models";

export type ScoredDnaMatch = DnaMatch & { helpfulnessScore: number };

export type DnaStatusFilter = "all" | DnaMatch["triageStatus"];
export type DnaSideFilter = "all" | DnaSide;
export type DnaTreeFilter = "all" | DnaTreeStatus;
export type DnaHelpfulnessFilter = "all" | "high" | "medium" | "low";
export type DnaSortKey = "helpfulness" | "cm" | "name";

export type DnaMatchFilters = {
  query?: string;
  status?: DnaStatusFilter;
  side?: DnaSideFilter;
  treeStatus?: DnaTreeFilter;
  helpfulness?: DnaHelpfulnessFilter;
  sort?: DnaSortKey;
};

export type DnaPaginationResult = {
  items: ScoredDnaMatch[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
};

export function filterDnaMatches(matches: ScoredDnaMatch[], filters: DnaMatchFilters = {}): ScoredDnaMatch[] {
  const terms = normalizeSearchTerms(filters.query);
  const status = filters.status ?? "all";
  const side = filters.side ?? "all";
  const treeStatus = filters.treeStatus ?? "all";
  const helpfulness = filters.helpfulness ?? "all";
  const sort = filters.sort ?? "helpfulness";

  return matches
    .filter((match) => {
      if (status !== "all" && match.triageStatus !== status) return false;
      if (side !== "all" && match.side !== side) return false;
      if (treeStatus !== "all" && match.treeStatus !== treeStatus) return false;
      if (helpfulness !== "all" && helpfulnessBucket(match.helpfulnessScore) !== helpfulness) return false;

      if (terms.length === 0) {
        return true;
      }

      const searchText = buildDnaSearchText(match);
      return terms.every((term) => searchText.includes(term));
    })
    .sort((left, right) => compareDnaMatches(left, right, sort));
}

export function paginateDnaMatches(matches: ScoredDnaMatch[], page: number, pageSize: number): DnaPaginationResult {
  const safePageSize = clampInteger(pageSize, 1, 250);
  const pageCount = Math.max(1, Math.ceil(matches.length / safePageSize));
  const safePage = clampInteger(page, 1, pageCount);
  const startIndex = (safePage - 1) * safePageSize;
  const items = matches.slice(startIndex, startIndex + safePageSize);

  return {
    items,
    page: safePage,
    pageSize: safePageSize,
    pageCount,
    total: matches.length,
    start: items.length === 0 ? 0 : startIndex + 1,
    end: startIndex + items.length
  };
}

export function helpfulnessBucket(score: number): "high" | "medium" | "low" {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function buildDnaSearchText(match: DnaMatch): string {
  return normalizeSearchValue(
    [
      match.id,
      match.displayName,
      match.totalCm,
      match.longestSegmentCm,
      match.sharedDnaPercent,
      match.predictedRelationship,
      match.side,
      match.treeStatus,
      match.triageStatus,
      match.surnames.join(" "),
      match.places.join(" "),
      match.sharedMatches.join(" "),
      match.notes,
      match.ancestryUrl
    ]
      .filter((value) => value !== undefined && value !== null)
      .join(" ")
  );
}

function normalizeSearchTerms(query?: string): string[] {
  return normalizeSearchValue(query ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function compareDnaMatches(left: ScoredDnaMatch, right: ScoredDnaMatch, sort: DnaSortKey): number {
  if (sort === "cm") {
    return right.totalCm - left.totalCm || compareNames(left, right);
  }

  if (sort === "name") {
    return compareNames(left, right);
  }

  return right.helpfulnessScore - left.helpfulnessScore || right.totalCm - left.totalCm || compareNames(left, right);
}

function compareNames(left: DnaMatch, right: DnaMatch): number {
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}
