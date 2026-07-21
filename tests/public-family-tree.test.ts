import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { calculateTreeResetScale, PublicFamilyTree } from "@/components/public-family-tree";
import { buildFamilyTreeLayout } from "@/lib/family-tree";
import { readPublicFamilyProjection } from "@/lib/public-family";

describe("public family tree", () => {
  it("builds deterministic connectors for every typed family unit", async () => {
    const family = await readPublicFamilyProjection();
    const layout = buildFamilyTreeLayout(family.tree);

    expect(layout.nodes).toHaveLength(31);
    expect(layout.connectors).toHaveLength(13);
    expect(new Set(layout.nodes.map((node) => node.personId)).size).toBe(31);
    expect(layout.nodes.find((node) => node.personId === "p-orson-hartwell")?.generationLabel).toBe("Great-grandparents");
    expect(layout.nodes.find((node) => node.personId === "p-clara-mercer")?.generationLabel).toBe("Children and partners");
    expect(layout.connectors.find((connector) => connector.familyId === "family-nora-samuel")?.descendantPath).toContain(" V ");
    expect(layout.nodes.find((node) => node.personId === "p-june-vale")?.generationLabel).toBe("Grandchildren");
    expect(layout.connectors.find((connector) => connector.familyId === "family-clara-henry")?.descendantPath).toContain(" V ");
    expect(layout.connectors.find((connector) => connector.familyId === "family-ada-owen")?.descendantPath).toBe("");
    expect(layout.connectors.find((connector) => connector.familyId === "family-clara-arthur")?.descendantPath).toBe("");
    const adaPartnerPaths = layout.connectors
      .filter((connector) => connector.familyId.startsWith("family-ada-"))
      .map((connector) => connector.partnerPath);
    const claraPartnerPaths = layout.connectors
      .filter((connector) => connector.familyId.startsWith("family-clara-"))
      .map((connector) => connector.partnerPath);
    expect(adaPartnerPaths).toHaveLength(3);
    expect(adaPartnerPaths.every((path) => path.includes(" V "))).toBe(true);
    expect(new Set(adaPartnerPaths).size).toBe(3);
    expect(claraPartnerPaths).toHaveLength(2);
    expect(claraPartnerPaths.every((path) => path.includes(" V "))).toBe(true);
    expect(new Set(claraPartnerPaths).size).toBe(2);

    const minimumCardGap = Math.min(...family.tree.generations.flatMap((generation) => {
      const row = layout.nodes
        .filter((node) => node.generationId === generation.id)
        .sort((left, right) => left.x - right.x);
      return row.slice(1).map((node, index) => node.x - (row[index].x + layout.nodeWidth));
    }));
    expect(layout.width).toBe(1_440);
    expect(minimumCardGap).toBeGreaterThanOrEqual(14);
  });

  it("renders all profiles as linked nodes in a labelled, keyboard-scrollable tree region", async () => {
    const family = await readPublicFamilyProjection();
    const html = renderToStaticMarkup(createElement(PublicFamilyTree, {
      people: family.people,
      tree: family.tree
    }));
    const renderedPeople = [...html.matchAll(/data-tree-person="([^"]+)"/g)].map((match) => match[1]);

    expect(renderedPeople).toHaveLength(31);
    expect(new Set(renderedPeople).size).toBe(31);
    expect(html).toContain("data-public-family-tree");
    expect(html).toMatch(/role="region"[^>]*tabindex="0"/);
    expect(html).toContain("Complete family tree");
    expect(html).toContain("Reset view");
    expect(html).toContain('href="/people/nora-elise-hartwell"');
    expect(html).toContain('href="/people/eileen-grace-pike"');
    expect(html).toContain('href="/people/june-hartwell-vale"');
    expect(html).toContain('href="/people/celia-rowan-mercer"');
    expect(html).toContain("unmarried co-parents");
    expect(html).toContain("no children recorded");
    expect(html.match(/data-family-unit=/g)).toHaveLength(13);
  });

  it("keeps reset views readable when the whole canvas cannot fit", () => {
    expect(calculateTreeResetScale(1_180, 1_280)).toBe(0.9);
    expect(calculateTreeResetScale(390, 1_280)).toBe(0.9);
    expect(calculateTreeResetScale(1_400, 1_280)).toBe(1);
  });
});
