#!/usr/bin/env node
import axeCore from "axe-core";
import { chromium } from "playwright";

import { runPublicDemoMonitor } from "./public-demo-monitor.mjs";

const canonicalOrigin = "https://demo.kinresolve.com";
const guidedPath = "/app/cases/case-mercer-march-identity?guide=1";
const sessionCookieName = "__Host-kinresolve-demo";
const timeoutMs = 30_000;

export async function runPublicDemoBrowserCanary(
  environment = process.env,
  dependencies = { browserType: chromium, shallowMonitor: runPublicDemoMonitor, axeSource: axeCore.source }
) {
  const configuration = resolveConfiguration(environment);
  await dependencies.shallowMonitor("shallow", environment);

  const browserInstance = await dependencies.browserType.launch({ headless: true });
  let desktopContext;
  let mobileContext;
  let staleContext;
  try {
    desktopContext = await browserInstance.newContext({
      baseURL: configuration.origin,
      viewport: { width: 1280, height: 900 }
    });
    mobileContext = await browserInstance.newContext({
      baseURL: configuration.origin,
      isMobile: true,
      viewport: { width: 390, height: 844 }
    });
    for (const context of [desktopContext, mobileContext]) {
      context.setDefaultTimeout(timeoutMs);
      context.setDefaultNavigationTimeout(timeoutMs);
      await installProtectedCandidateRoute(context, configuration);
    }

    const desktopPage = await desktopContext.newPage();
    const mobilePage = await mobileContext.newPage();
    await Promise.all([
      startGuidedDemo(desktopPage, dependencies.axeSource, false),
      startGuidedDemo(mobilePage, dependencies.axeSource, true)
    ]);

    await Promise.all([
      chooseOutcome(desktopPage, "Likely the same writer"),
      chooseOutcome(mobilePage, "Not enough to decide")
    ]);
    await Promise.all([
      auditAccessibility(desktopPage, dependencies.axeSource),
      auditAccessibility(mobilePage, dependencies.axeSource)
    ]);
    await assertNoMobileOverflow(mobilePage);

    await assertGuidedOutcome(desktopContext, configuration, "found");
    await assertGuidedOutcome(mobileContext, configuration, "inconclusive");

    await runOptionalAiAndAudit(desktopPage, dependencies.axeSource);
    await openFeedbackAndAudit(desktopPage, dependencies.axeSource);

    const staleCookie = await requireSessionCookie(desktopContext, configuration.origin);
    await activateByKeyboard(desktopPage, "Reset demo");
    await desktopPage.getByRole("group", { name: "Confirm demo reset" }).waitFor();
    await auditAccessibility(desktopPage, dependencies.axeSource);
    const resetResponse = desktopPage.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/demo/session/reset"
    ));
    const navigation = desktopPage.waitForNavigation({ waitUntil: "domcontentloaded" });
    await activateByKeyboard(desktopPage, "Yes, reset");
    const [response] = await Promise.all([resetResponse, navigation]);
    if (response.status() !== 200) throw new Error("The browser reset contract failed.");
    const rotatedCookie = await requireSessionCookie(desktopContext, configuration.origin);
    if (rotatedCookie.value === staleCookie.value) {
      throw new Error("The browser reset did not rotate its credential.");
    }

    staleContext = await browserInstance.newContext({ baseURL: configuration.origin });
    await staleContext.addCookies([{
      name: sessionCookieName,
      value: staleCookie.value,
      url: configuration.origin
    }]);
    const stale = await staleContext.request.post(
      new URL("/api/demo/cases/case-mercer-march-identity/guide", configuration.origin).href,
      {
        data: { command: "record_outcome", outcome: "not_found" },
        failOnStatusCode: false,
        headers: requestHeaders(configuration, true),
        maxRedirects: 0,
        timeout: timeoutMs
      }
    );
    if (stale.status() !== 401 && stale.status() !== 403) {
      throw new Error("The stale browser credential remained authorized; expected 401 or 403.");
    }
    await assertGuidedOutcome(mobileContext, configuration, "inconclusive");
  } finally {
    const cleanup = await Promise.allSettled([
      endContextSession(desktopContext, configuration),
      endContextSession(mobileContext, configuration)
    ]);
    await staleContext?.close().catch(() => undefined);
    await desktopContext?.close().catch(() => undefined);
    await mobileContext?.close().catch(() => undefined);
    await browserInstance.close().catch(() => undefined);
    if (cleanup.some(({ status }) => status === "rejected")) {
      throw new Error("The browser canary could not clean up every disposable session.");
    }
  }
}

async function startGuidedDemo(page, axeSource, mobile) {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  if (response?.status() !== 200) throw new Error("The demo landing page was unavailable.");
  await page.getByRole("button", { name: "Start guided demo" }).waitFor();
  await auditAccessibility(page, axeSource);
  if (mobile) await assertNoMobileOverflow(page);

  const navigation = page.waitForURL((url) => (
    url.pathname === "/app/cases/case-mercer-march-identity"
      && url.searchParams.get("guide") === "1"
  ));
  await activateByKeyboard(page, "Start guided demo");
  await navigation;
  await page.getByRole("heading", {
    name: "Do these signatures point to the same fictional person?"
  }).waitFor();
  await auditAccessibility(page, axeSource);
}

async function chooseOutcome(page, label) {
  await activateByKeyboard(page, label);
  await page.getByText("Outcome saved. Your next assignment is ready.").waitFor();
}

async function runOptionalAiAndAudit(page, axeSource) {
  await activateByKeyboard(page, "Suggest the next three checks");
  await page.locator(".demo-ai-result").waitFor();
  await auditAccessibility(page, axeSource);
}

async function openFeedbackAndAudit(page, axeSource) {
  await activateByKeyboard(page, "Share feedback");
  await page.getByRole("radiogroup", { name: "Usefulness rating" }).waitFor();
  await auditAccessibility(page, axeSource);
}

async function activateByKeyboard(page, accessibleName) {
  const target = page.getByRole("button", { name: accessibleName }).or(
    page.getByText(accessibleName, { exact: true })
  ).first();
  await target.waitFor();
  for (let index = 0; index < 100; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("The demo journey was not keyboard operable.");
}

async function auditAccessibility(page, axeSource) {
  if (await page.locator("html").getAttribute("lang") !== "en") {
    throw new Error("The demo page language contract failed.");
  }
  if (await page.getByRole("main").count() !== 1) {
    throw new Error("The demo main-landmark contract failed.");
  }
  if (await page.getByRole("heading", { level: 1 }).count() !== 1) {
    throw new Error("The demo heading contract failed.");
  }
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]
      }
    });
    return result.violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id, nodes }) => ({ id, count: nodes.length }));
  });
  if (violations.length > 0) {
    throw new Error(`The demo accessibility contract failed (${violations.map(({ id, count }) => `${id}:${count}`).join(",")}).`);
  }
}

async function assertNoMobileOverflow(page) {
  const fits = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ));
  if (!fits) throw new Error("The 390-pixel demo viewport has horizontal overflow.");
}

async function assertGuidedOutcome(context, configuration, expected) {
  const response = await context.request.get("/api/demo/session", {
    headers: requestHeaders(configuration, false),
    maxRedirects: 0,
    timeout: timeoutMs
  });
  if (response.status() !== 200) throw new Error("The browser session state was unavailable.");
  const document = await response.json();
  if (document?.progress?.guidedOutcome !== expected) {
    throw new Error("The browser contexts did not preserve isolated guidedOutcome state.");
  }
}

async function endContextSession(context, configuration) {
  if (!context) return;
  const cookies = await context.cookies(configuration.origin).catch(() => []);
  if (!cookies.some(({ name }) => name === sessionCookieName)) return;
  const response = await context.request.post("/api/demo/session/end", {
    data: {},
    failOnStatusCode: false,
    headers: requestHeaders(configuration, true),
    maxRedirects: 0,
    timeout: timeoutMs
  });
  if (response.status() !== 200 && response.status() !== 204) {
    throw new Error("The browser canary could not end its disposable session.");
  }
}

async function requireSessionCookie(context, origin) {
  const cookies = (await context.cookies(origin)).filter(({ name }) => name === sessionCookieName);
  if (cookies.length !== 1 || !/^[A-Za-z0-9_-]{43,256}$/.test(cookies[0].value)) {
    throw new Error("The browser session cookie contract failed.");
  }
  return cookies[0];
}

async function installProtectedCandidateRoute(context, configuration) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== configuration.origin) {
      await route.continue();
      return;
    }
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method());
    await route.continue({
      headers: {
        ...request.headers(),
        "x-kinresolve-demo-canary": configuration.canarySecret,
        ...(configuration.bypassSecret
          ? { "x-vercel-protection-bypass": configuration.bypassSecret }
          : {}),
        ...(mutation ? {
          origin: "https://demo.kinresolve.com",
          "sec-fetch-site": "same-origin"
        } : {})
      }
    });
  });
}

function requestHeaders(configuration, mutation) {
  return {
    accept: "application/json",
    "x-kinresolve-demo-canary": configuration.canarySecret,
    ...(configuration.bypassSecret
      ? { "x-vercel-protection-bypass": configuration.bypassSecret }
      : {}),
    ...(mutation ? {
      origin: "https://demo.kinresolve.com",
      "sec-fetch-site": "same-origin"
    } : {})
  };
}

function resolveConfiguration(environment) {
  const origin = exactDemoOrigin(environment.PUBLIC_DEMO_ORIGIN);
  const generatedCandidate = new URL(origin).hostname.endsWith(".vercel.app");
  const bypassSecret = optionalSecret(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
  if (origin !== canonicalOrigin && (!generatedCandidate || !bypassSecret)) {
    throw new Error("The browser canary origin is not an approved public demo deployment.");
  }
  return Object.freeze({
    origin,
    bypassSecret,
    canarySecret: requiredSecret(environment.KINRESOLVE_DEMO_CANARY_SECRET)
  });
}

function exactDemoOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error("PUBLIC_DEMO_ORIGIN is invalid.");
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password || url.port) {
    throw new Error("PUBLIC_DEMO_ORIGIN is invalid.");
  }
  return url.origin;
}

function requiredSecret(value) {
  const secret = optionalSecret(value);
  if (!secret) throw new Error("The public demo canary credential is required.");
  return secret;
}

function optionalSecret(value) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || value.trim() !== value || !/^[A-Za-z0-9_-]{20,256}$/.test(value)) {
    throw new Error("A public demo canary credential is invalid.");
  }
  return value;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runPublicDemoBrowserCanary().then(() => {
    console.log("Disposable public demo browser canary passed.");
  }).catch(() => {
    console.error("Disposable public demo browser canary failed.");
    process.exitCode = 1;
  });
}
