"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icons } from "@/components/icons";
import { Metric, Status } from "@/components/ui";
import type { PersonSummary } from "@/lib/models";
import { filterPeople, paginateItems, type PeopleLivingFilter, type PeoplePrivacyFilter, type PeoplePublicationFilter, type PeopleSortKey } from "@/lib/people-search";

type Props = {
  people: PersonSummary[];
};

const pageSizeOptions = [25, 50, 100, 250];

export function PeopleWorkspace({ people }: Props) {
  const [query, setQuery] = useState("");
  const [publication, setPublication] = useState<PeoplePublicationFilter>("all");
  const [privacy, setPrivacy] = useState<PeoplePrivacyFilter>("all");
  const [livingStatus, setLivingStatus] = useState<PeopleLivingFilter>("all");
  const [sort, setSort] = useState<PeopleSortKey>("name");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const filteredPeople = useMemo(
    () =>
      filterPeople(people, {
        query,
        publication,
        privacy,
        livingStatus,
        sort
      }),
    [people, query, publication, privacy, livingStatus, sort]
  );
  const pagination = useMemo(() => paginateItems(filteredPeople, { page, pageSize }), [filteredPeople, page, pageSize]);
  const publishedCount = useMemo(() => people.filter((person) => person.published).length, [people]);
  const privateCount = useMemo(() => people.filter((person) => person.privacy !== "public").length, [people]);
  const livingCount = useMemo(() => people.filter((person) => person.livingStatus === "living").length, [people]);

  function resetPaging() {
    setPage(1);
  }

  return (
    <div className="people-workspace">
      <div className="metric-row">
        <Metric label="People" value={people.length.toLocaleString()} detail="in workspace" />
        <Metric label="Current set" value={filteredPeople.length.toLocaleString()} detail={`${pagination.start}-${pagination.end} shown`} />
        <Metric label="Published" value={publishedCount.toLocaleString()} detail="public profiles" />
        <Metric label="Protected" value={privateCount.toLocaleString()} detail={`${livingCount.toLocaleString()} living`} />
      </div>

      <div className="app-card people-search-card">
        <div className="people-search-header">
          <div>
            <h2>Find people</h2>
            <p className="muted">Search names, places, dates, notes, facts, and GEDCOM identifiers.</p>
          </div>
          <button
            className="button-secondary"
            onClick={() => {
              setQuery("");
              setPublication("all");
              setPrivacy("all");
              setLivingStatus("all");
              setSort("name");
              setPageSize(50);
              setPage(1);
            }}
            type="button"
          >
            Reset
          </button>
        </div>

        <div className="people-filter-grid">
          <label className="field people-search-field">
            <span>Search</span>
            <span className="input-with-icon">
              <Icons.Search size={16} aria-hidden />
              <input
                aria-label="Search people"
                placeholder="Riemer, Zajicek, Chicago, 1884..."
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  resetPaging();
                }}
              />
            </span>
          </label>
          <SelectField
            label="Publication"
            value={publication}
            options={[
              ["all", "All"],
              ["published", "Published"],
              ["unpublished", "Unpublished"]
            ]}
            onChange={(value) => {
              setPublication(value as PeoplePublicationFilter);
              resetPaging();
            }}
          />
          <SelectField
            label="Privacy"
            value={privacy}
            options={[
              ["all", "All"],
              ["public", "Public"],
              ["private", "Private"],
              ["sensitive", "Sensitive"]
            ]}
            onChange={(value) => {
              setPrivacy(value as PeoplePrivacyFilter);
              resetPaging();
            }}
          />
          <SelectField
            label="Life status"
            value={livingStatus}
            options={[
              ["all", "All"],
              ["living", "Living"],
              ["deceased", "Deceased"],
              ["unknown", "Unknown"]
            ]}
            onChange={(value) => {
              setLivingStatus(value as PeopleLivingFilter);
              resetPaging();
            }}
          />
          <SelectField
            label="Sort"
            value={sort}
            options={[
              ["name", "Name"],
              ["birth", "Birth date"],
              ["death", "Death date"],
              ["facts", "Fact count"]
            ]}
            onChange={(value) => {
              setSort(value as PeopleSortKey);
              resetPaging();
            }}
          />
          <SelectField
            label="Rows"
            value={String(pageSize)}
            options={pageSizeOptions.map((option) => [String(option), String(option)] as [string, string])}
            onChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
          />
        </div>
      </div>

      <div className="app-card">
        <div className="table-heading-row">
          <div>
            <h2>Imported and curated people</h2>
            <p className="muted">
              Showing {pagination.start.toLocaleString()}-{pagination.end.toLocaleString()} of {pagination.total.toLocaleString()}
            </p>
          </div>
          <PaginationControls page={pagination.page} pageCount={pagination.pageCount} onPageChange={setPage} />
        </div>

        <table className="data-table people-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Birth</th>
              <th>Death</th>
              <th>Privacy</th>
              <th>Facts</th>
            </tr>
          </thead>
          <tbody>
            {pagination.items.map((person) => (
              <tr key={person.id}>
                <td>
                  <Link href={`/app/people/${person.id}`}>{person.displayName}</Link>
                  <div className="muted">{person.surname || person.slug}</div>
                </td>
                <td>{formatVital(person.birthDate, person.birthPlace)}</td>
                <td>{formatVital(person.deathDate, person.deathPlace)}</td>
                <td>
                  <div className="status-stack">
                    <Status tone={person.published ? "ok" : "private"}>{person.published ? "published" : "private"}</Status>
                    <Status tone={privacyTone(person.privacy)}>{person.privacy}</Status>
                    {person.livingStatus === "living" ? <Status tone="warning">living</Status> : null}
                  </div>
                </td>
                <td>{person.facts.length}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {pagination.items.length === 0 ? <p className="muted empty-state">No people match these filters.</p> : null}

        <div className="table-footer-row">
          <p className="muted">
            Page {pagination.page.toLocaleString()} of {pagination.pageCount.toLocaleString()}
          </p>
          <PaginationControls page={pagination.page} pageCount={pagination.pageCount} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
}

function PaginationControls({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  return (
    <div className="pagination-controls" aria-label="People pages">
      <button className="button-secondary icon-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} type="button" aria-label="Previous page">
        <Icons.ChevronLeft size={16} aria-hidden />
      </button>
      <span className="tag">{page.toLocaleString()}</span>
      <button className="button-secondary icon-button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} type="button" aria-label="Next page">
        <Icons.ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatVital(date?: string, place?: string): string {
  return [date, place].filter(Boolean).join(" · ") || "Unknown";
}

function privacyTone(privacy: PersonSummary["privacy"]): "ok" | "private" | "warning" | "danger" {
  if (privacy === "public") return "ok";
  if (privacy === "sensitive") return "danger";
  return "private";
}
