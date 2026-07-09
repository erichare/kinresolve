import type { PersonSummary, PrivacyLevel } from "./models";

export type PeoplePublicationFilter = "all" | "published" | "unpublished";
export type PeoplePrivacyFilter = "all" | PrivacyLevel;
export type PeopleLivingFilter = "all" | PersonSummary["livingStatus"];
export type PeopleSortKey = "name" | "birth" | "death" | "facts";

export type PeopleSearchFilters = {
  query?: string;
  publication?: PeoplePublicationFilter;
  privacy?: PeoplePrivacyFilter;
  livingStatus?: PeopleLivingFilter;
  sort?: PeopleSortKey;
};

export type PeopleListItem = {
  id: string;
  slug: string;
  displayName: string;
  surname?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  livingStatus: PersonSummary["livingStatus"];
  privacy: PrivacyLevel;
  published: boolean;
  factCount: number;
};

export type PeopleSearchStats = {
  total: number;
  published: number;
  protectedCount: number;
  living: number;
};

export type PeopleSearchResult = PaginationResult<PeopleListItem> & {
  stats: PeopleSearchStats;
};

export type PaginationInput = {
  page: number;
  pageSize: number;
};

export type PaginationResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
};

export function filterPeople(people: PersonSummary[], filters: PeopleSearchFilters = {}): PersonSummary[] {
  const terms = normalizeSearchTerms(filters.query);
  const publication = filters.publication ?? "all";
  const privacy = filters.privacy ?? "all";
  const livingStatus = filters.livingStatus ?? "all";
  const sort = filters.sort ?? "name";

  return people
    .filter((person) => {
      if (publication === "published" && !person.published) return false;
      if (publication === "unpublished" && person.published) return false;
      if (privacy !== "all" && person.privacy !== privacy) return false;
      if (livingStatus !== "all" && person.livingStatus !== livingStatus) return false;

      if (terms.length === 0) {
        return true;
      }

      const searchText = buildPersonSearchText(person);
      return terms.every((term) => searchText.includes(term));
    })
    .sort((left, right) => comparePeople(left, right, sort));
}

export function searchPeoplePage(people: PersonSummary[], filters: PeopleSearchFilters = {}, pagination: PaginationInput = { page: 1, pageSize: 50 }): PeopleSearchResult {
  const filteredPeople = filterPeople(people, filters);
  const page = paginateItems(filteredPeople, pagination);

  return {
    ...page,
    items: page.items.map(toPeopleListItem),
    stats: summarizePeople(people)
  };
}

export function summarizePeople(people: PersonSummary[]): PeopleSearchStats {
  return {
    total: people.length,
    published: people.filter((person) => person.published).length,
    protectedCount: people.filter((person) => person.privacy !== "public").length,
    living: people.filter((person) => person.livingStatus === "living").length
  };
}

export function toPeopleListItem(person: PersonSummary): PeopleListItem {
  return {
    id: person.id,
    slug: person.slug,
    displayName: person.displayName,
    surname: person.surname,
    birthDate: person.birthDate,
    birthPlace: person.birthPlace,
    deathDate: person.deathDate,
    deathPlace: person.deathPlace,
    livingStatus: person.livingStatus,
    privacy: person.privacy,
    published: person.published,
    factCount: person.facts.length
  };
}

export function paginateItems<T>(items: T[], input: PaginationInput): PaginationResult<T> {
  const pageSize = clampInteger(input.pageSize, 1, 500);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = clampInteger(input.page, 1, pageCount);
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);

  return {
    items: pageItems,
    page,
    pageSize,
    pageCount,
    total: items.length,
    start: pageItems.length === 0 ? 0 : startIndex + 1,
    end: startIndex + pageItems.length
  };
}

export function buildPersonSearchText(person: PersonSummary): string {
  return normalizeSearchValue(
    [
      person.id,
      person.slug,
      person.displayName,
      person.givenName,
      person.surname,
      person.birthDate,
      person.birthPlace,
      person.deathDate,
      person.deathPlace,
      person.sex,
      person.livingStatus,
      person.privacy,
      person.notes,
      person.relatives.join(" "),
      person.facts
        .map((fact) => [fact.type, fact.date, fact.place, fact.value, fact.source].filter(Boolean).join(" "))
        .join(" ")
    ].join(" ")
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

function comparePeople(left: PersonSummary, right: PersonSummary, sort: PeopleSortKey): number {
  if (sort === "facts") {
    return right.facts.length - left.facts.length || compareNames(left, right);
  }

  if (sort === "birth") {
    return compareNullableStrings(left.birthDate, right.birthDate) || compareNames(left, right);
  }

  if (sort === "death") {
    return compareNullableStrings(left.deathDate, right.deathDate) || compareNames(left, right);
  }

  return compareNames(left, right);
}

function compareNames(left: PersonSummary, right: PersonSummary): number {
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
}

function compareNullableStrings(left?: string, right?: string): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}
