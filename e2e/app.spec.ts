import { expect, test } from "@playwright/test";

function parseRgb(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported CSS color: ${value}`);
  return channels as [number, number, number];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseRgb(foreground));
  const backgroundLuminance = relativeLuminance(parseRgb(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("renders an accessible connection status", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";
  const topBar = page.locator(".top-app-bar");
  const brand = topBar.locator(".brand strong");
  const status = topBar.locator(".status-pill");

  await expect(brand).toHaveText("CFOP Trainer");
  await expect(status).toContainText("未连接");
  await expect(status).toBeVisible({ visible: !isMobile });
  await expect(page.locator(".connection-banner strong")).toHaveText("未连接");
  await expect(page.locator(".connection-banner strong")).toBeVisible();

  const colors = await page.evaluate(() => {
    const topBarElement = document.querySelector<HTMLElement>(".top-app-bar");
    const brandElement = document.querySelector<HTMLElement>(".top-app-bar .brand strong");
    const statusElement = document.querySelector<HTMLElement>(".top-app-bar .status-pill");
    if (!topBarElement || !brandElement || !statusElement) throw new Error("Top app bar missing");
    return {
      background: getComputedStyle(topBarElement).backgroundColor,
      brand: getComputedStyle(brandElement).color,
      status: getComputedStyle(statusElement).color,
    };
  });

  expect(contrastRatio(colors.brand, colors.background)).toBeGreaterThanOrEqual(4.5);
  if (!isMobile) {
    expect(contrastRatio(colors.status, colors.background)).toBeGreaterThanOrEqual(4.5);
  }
});

test("supports the complete demo training flow", async ({ page }) => {
  await page.getByRole("button", { name: "演示连接" }).click();
  await expect(page.locator(".connection-banner strong")).toHaveText("已连接并同步");

  const primary = page.locator(".primary-button");
  await expect(primary).toContainText("准备演示打乱");
  await primary.click();

  for (let index = 0; index < 8; index += 1) {
    await expect(primary).toContainText("执行");
    await primary.click();
  }
  await expect(page.locator(".timer-wrap .eyebrow")).toHaveText("等待第一步");

  for (let index = 0; index < 8; index += 1) {
    await expect(primary).toContainText("还原");
    await primary.click();
  }
  await expect(page.locator(".timer-wrap .eyebrow")).toHaveText("本次完成");
  await expect(page.getByText("0 moves")).not.toBeVisible();
});

test("opens device selection in a modal dialog", async ({ page }) => {
  await page.getByRole("button", { name: "扫描真机" }).click();
  const dialog = page.getByRole("dialog", { name: "选择蓝牙魔方" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "选择蓝牙魔方" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "重新扫描" })).toBeVisible();

  const close = dialog.getByRole("button", { name: "关闭设备选择" });
  await expect(close).toBeEnabled();
  await close.click();
  await expect(dialog).not.toBeVisible();
});

test("switches to an interactive 3D cube", async ({ page }) => {
  const viewControl = page.getByLabel("魔方视图");
  await viewControl.getByRole("button", { name: "3D" }).click();

  const cube3d = page.getByRole("button", { name: /当前魔方 3D 视图/ });
  await expect(cube3d).toBeVisible();
  await expect(viewControl.getByRole("button", { name: "3D" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await cube3d.focus();
  await cube3d.press("ArrowRight");
  await expect(cube3d.locator(".cube-object")).toHaveAttribute(
    "style",
    /--rotation-y:\s*46deg/,
  );
});

test("uses the correct responsive navigation without horizontal overflow", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";
  await expect(page.locator(".navigation-rail")).toBeVisible({ visible: !isMobile });
  await expect(page.locator(".bottom-navigation")).toBeVisible({ visible: isMobile });

  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasOverflow).toBe(false);

  const navigation = isMobile ? page.locator(".bottom-navigation") : page.locator(".navigation-rail");
  await navigation.getByRole("button", { name: "Case" }).click();
  await expect(page.getByRole("heading", { name: "OLL / PLL 定向训练" })).toBeVisible();
  await navigation.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "训练设置" })).toBeVisible();
});
