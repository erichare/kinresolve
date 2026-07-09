import { describe, expect, it } from "vitest";
import type { PersonSummary } from "@/lib/models";
import { filterPeople, paginateItems } from "@/lib/people-search";

const people: PersonSummary[] = [
  person({
    id: "p-elizabeth-riemer",
    displayName: "Elizabeth Katherine Riemer",
    surname: "Riemer",
    birthDate: "1884",
    birthPlace: "Chicago, Illinois",
    privacy: "public",
    published: true,
    livingStatus: "deceased"
  }),
  person({
    id: "p-mary-zajicek",
    displayName: "Mary Zajicek",
    surname: "Zajicek",
    birthDate: "1901",
    birthPlace: "Cedar Rapids, Iowa",
    privacy: "private",
    published: false,
    livingStatus: "unknown",
    notes: "Family story mentions Bohemia."
  }),
  person({
    id: "p-living",
    displayName: "Living Relative",
    surname: "Riemer",
    privacy: "sensitive",
    published: false,
    livingStatus: "living"
  })
];

describe("people search", () => {
  it("searches across names, places, dates, and notes", () => {
    expect(filterPeople(people, { query: "riemer chicago" }).map((item) => item.id)).toEqual(["p-elizabeth-riemer"]);
    expect(filterPeople(people, { query: "bohemia" }).map((item) => item.id)).toEqual(["p-mary-zajicek"]);
  });

  it("filters publication, privacy, and living status", () => {
    expect(filterPeople(people, { publication: "published" }).map((item) => item.id)).toEqual(["p-elizabeth-riemer"]);
    expect(filterPeople(people, { privacy: "sensitive" }).map((item) => item.id)).toEqual(["p-living"]);
    expect(filterPeople(people, { livingStatus: "living" }).map((item) => item.id)).toEqual(["p-living"]);
  });

  it("paginates with clamped page bounds", () => {
    const result = paginateItems(people, { page: 3, pageSize: 2 });

    expect(result.page).toBe(2);
    expect(result.pageCount).toBe(2);
    expect(result.start).toBe(3);
    expect(result.end).toBe(3);
    expect(result.items).toHaveLength(1);
  });
});

function person(input: Partial<PersonSummary> & Pick<PersonSummary, "id" | "displayName">): PersonSummary {
  return {
    slug: input.id,
    givenName: "",
    surname: "",
    birthDate: "",
    birthPlace: "",
    deathDate: "",
    deathPlace: "",
    sex: "U",
    livingStatus: "unknown",
    privacy: "private",
    published: false,
    facts: [],
    relatives: [],
    ...input
  };
}
