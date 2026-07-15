import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() })
}));

import { ArchiveBrandingForm } from "@/components/archive-branding-form";

describe("archive branding capability UI", () => {
  it("uses private-workspace language when the public archive is disabled", () => {
    const html = renderToStaticMarkup(createElement(ArchiveBrandingForm, {
      initialName: "Private archive",
      initialTagline: "",
      publicArchiveEnabled: false
    }));

    expect(html).toMatch(/Private family research/i);
    expect(html).not.toMatch(/Openly shared/i);
  });

  it("preserves public-archive language when the capability is enabled", () => {
    const html = renderToStaticMarkup(createElement(ArchiveBrandingForm, {
      initialName: "Public archive",
      initialTagline: "",
      publicArchiveEnabled: true
    }));

    expect(html).toMatch(/Openly shared/i);
  });
});
