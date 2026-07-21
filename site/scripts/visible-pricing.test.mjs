import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { containsVisiblePrice } from "./visible-pricing.mjs";

describe("containsVisiblePrice", () => {
  it("detects visible pricing after a browser-valid malformed script closer", () => {
    const markup = `
      <script>self.__next_f.push(["$0"])</script\t\n data-junk>
      <main><p>$42/month</p></main>
      <script>self.__next_f.push(["release metadata"])</script>
    `;

    assert.equal(containsVisiblePrice(markup), true);
  });

  it("ignores framework script payloads while retaining ordinary visible copy", () => {
    const markup = `
      <script>self.__next_f.push(["$99/month"])</script>
      <main><p>Hosted pricing will be announced before billing begins.</p></main>
    `;

    assert.equal(containsVisiblePrice(markup), false);
  });

  it("detects ordinary visible per-seat pricing", () => {
    assert.equal(containsVisiblePrice("<p>10 per seat</p>"), true);
  });
});
