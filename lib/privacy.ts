import type { PersonFact, PersonSummary, PrivacyLevel } from "./models";

const yearPattern = /(\d{4})/;

export function extractYear(dateText?: string): number | undefined {
  if (!dateText) {
    return undefined;
  }
  const match = dateText.match(yearPattern);
  return match ? Number(match[1]) : undefined;
}

export function inferLivingStatus(
  facts: Pick<PersonFact, "type" | "date">[],
  currentYear = new Date().getFullYear(),
  hasRecentRelative = false
): "living" | "deceased" | "unknown" {
  const hasDeath = facts.some((fact) => ["DEAT", "Death", "death"].includes(fact.type));
  if (hasDeath) {
    return "deceased";
  }

  const birthFact = facts.find((fact) => ["BIRT", "Birth", "birth"].includes(fact.type));
  const birthYear = extractYear(birthFact?.date);

  if (birthYear !== undefined) {
    return currentYear - birthYear < 100 ? "living" : "deceased";
  }

  return hasRecentRelative ? "living" : "unknown";
}

export function canPublishPerson(person: PersonSummary): boolean {
  return person.livingStatus === "deceased" && person.privacy === "public";
}

export function publicFactFilter(fact: PersonFact): boolean {
  return fact.privacy === "public" || fact.privacy === undefined;
}

export function privacyLabel(level: PrivacyLevel): string {
  if (level === "public") {
    return "Published";
  }
  if (level === "sensitive") {
    return "Sensitive";
  }
  return "Private";
}

