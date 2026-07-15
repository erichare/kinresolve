import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PersonCurationPanel } from "@/components/person-curation-panel";
import { demoPeople } from "@/lib/demo-data";

describe("person curation publishing capability", () => {
  it("does not offer publication for an unpublished profile when publishing is disabled", () => {
    const html = render(false, false);

    expect(html).not.toMatch(/<input\b[^>]*type="checkbox"/i);
    expect(html).not.toMatch(/>Published</i);
    expect(html).toMatch(/publishing is disabled/i);
  });

  it("keeps a one-way unpublish recovery action for an already-published profile", () => {
    const html = render(false, true);

    expect(html).toMatch(/remove from public archive/i);
    expect(html).not.toMatch(/<input\b[^>]*type="checkbox"/i);
  });

  it("preserves the publication checkbox when publishing is enabled", () => {
    const html = render(true, false);

    expect(html).toMatch(/<input\b[^>]*type="checkbox"/i);
    expect(html).toMatch(/Published/i);
  });
});

function render(publicPublishingEnabled: boolean, published: boolean): string {
  return renderToStaticMarkup(createElement(PersonCurationPanel, {
    person: { ...demoPeople[0], published },
    publicPublishingEnabled
  }));
}
