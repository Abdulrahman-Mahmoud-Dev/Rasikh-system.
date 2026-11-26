import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const indexUrl = new URL("../../../index.html", import.meta.url);
const appCssUrl = new URL("../../../assets/css/app.css", import.meta.url);

describe("Rasikh frontend shell boundaries", () => {
  it("keeps the mobile bottom navigation inside the authenticated app shell", async () => {
    const [html, css] = await Promise.all([
      readFile(indexUrl, "utf8"),
      readFile(appCssUrl, "utf8"),
    ]);

    const loginStart = html.indexOf('<section id="loginView"');
    const onboardingStart = html.indexOf('<section id="onboardingView"');
    const assignmentStart = html.indexOf('<section id="assignmentSelectView"');
    const appStart = html.indexOf('<div id="appView" class="app-view hidden">');
    const bottomNavStart = html.indexOf('<nav class="mobile-bottom-nav"');
    const appEnd = html.indexOf('\n</div>\n<div class="modal hidden"', bottomNavStart);

    expect(loginStart).toBeGreaterThanOrEqual(0);
    expect(onboardingStart).toBeGreaterThan(loginStart);
    expect(assignmentStart).toBeGreaterThan(onboardingStart);
    expect(appStart).toBeGreaterThan(assignmentStart);
    expect(bottomNavStart).toBeGreaterThan(appStart);
    expect(appEnd).toBeGreaterThan(bottomNavStart);
    expect(css).toContain(".hidden{display:none!important}");
  });

  it("provides attendance access in the mobile navigation and excludes OTP login inputs", async () => {
    const html = await readFile(indexUrl, "utf8");
    const appStart = html.indexOf('<div id="appView" class="app-view hidden">');
    const bottomNavStart = html.indexOf('<nav class="mobile-bottom-nav"', appStart);
    const bottomNavEnd = html.indexOf("</nav>", bottomNavStart);
    const bottomNav = html.slice(bottomNavStart, bottomNavEnd);

    expect(bottomNav).toContain('data-view="attendance"');
    expect(html).not.toContain('id="otpCode"');
    expect(html).not.toContain('id="otpArea"');
  });

  it("keeps the login card brand rendered once rather than adding a duplicate pseudo heading", async () => {
    const css = await readFile(appCssUrl, "utf8");
    expect(css).not.toContain(".login-card:before");
  });
});
