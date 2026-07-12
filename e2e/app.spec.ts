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

test("renders an accessible connection status", async ({ page }) => {
  const topBar = page.locator(".top-app-bar");
  const brand = topBar.locator(".brand strong");
  const status = topBar.locator(".status-pill");

  await expect(brand).toHaveText("CFOP Trainer");
  await expect(status).toContainText("未连接");
  await expect(status).toBeVisible();
  await expect(topBar.getByRole("button", { name: "未连接" })).toBeVisible();
  await expect(page.locator(".connection-banner")).toHaveCount(0);

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
  expect(contrastRatio(colors.status, colors.background)).toBeGreaterThanOrEqual(4.5);
});

test("generates one scramble and controls its demo from the sequence player", async ({ page }) => {
  const primary = page.locator(".primary-button");
  await expect(primary).toContainText("生成打乱");
  await primary.click();
  await expect(primary).toContainText("生成新打乱");

  const algorithm = page.getByLabel("打乱公式");
  await expect(algorithm.locator("span")).toHaveCount(20);
  const player = page.getByLabel("打乱演示播放器");
  const next = player.getByRole("button", { name: "下一步" });
  const previous = player.getByRole("button", { name: "上一步" });

  await expect(previous).toBeDisabled();
  await next.click();
  await expect(algorithm.locator("span.completed")).toHaveCount(1);
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(algorithm.locator("span.completed")).toHaveCount(0);

  await player.getByRole("button", { name: "播放演示" }).click();
  await expect(player.getByRole("button", { name: "暂停演示" })).toBeVisible();
  await expect(algorithm.locator("span.completed")).not.toHaveCount(0, { timeout: 2_000 });
  await player.getByRole("button", { name: "暂停演示" }).click();
  await player.getByRole("button", { name: "复位" }).click();
  await expect(algorithm.locator("span.completed")).toHaveCount(0);
});

test("opens device selection in a modal dialog", async ({ page }) => {
  await page.locator(".top-app-bar").getByRole("button", { name: "未连接" }).click();
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
  const cube3d = page.getByRole("button", { name: /当前魔方 3D 视图/ });
  await expect(cube3d).toBeVisible();
  await expect(page.getByRole("button", { name: "快速校准魔方" })).toBeDisabled();
  const overlayToggle = page.getByRole("button", { name: "切换 2D 辅助视图" });
  await expect(overlayToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("3D 视图的 2D 辅助图")).toBeVisible();
  await overlayToggle.click();
  await expect(page.getByLabel("3D 视图的 2D 辅助图")).not.toBeVisible();
  await overlayToggle.click();

  const initialView = await cube3d.getAttribute("data-view-quaternion");
  expect(initialView).toBeTruthy();
  await cube3d.focus();
  await cube3d.press("ArrowRight");
  await expect
    .poll(() => cube3d.getAttribute("data-view-quaternion"))
    .not.toBe(initialView);

  for (let index = 0; index < 5; index += 1) await cube3d.press("ArrowDown");
  const whiteFaceUpView = await cube3d.getAttribute("data-view-quaternion");
  await cube3d.press("ArrowRight");
  await expect
    .poll(() => cube3d.getAttribute("data-view-quaternion"))
    .not.toBe(whiteFaceUpView);

  await cube3d.dblclick();
  await expect
    .poll(() => cube3d.getAttribute("data-view-quaternion"))
    .toBe(initialView);
});

test("uses and customizes the full-bright sticker palette", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";
  const navigation = isMobile
    ? page.locator(".bottom-navigation")
    : page.locator(".navigation-rail");
  await navigation.getByRole("button", { name: "设置" }).click();

  await expect(page.getByRole("button", { name: "同步当前六面" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "实体已还原" })).toBeDisabled();
  const white = page.getByLabel("白色贴纸");
  await expect(white).toHaveValue("#ffffff");
  await white.fill("#f0f0f0");
  await expect(white).toHaveValue("#f0f0f0");
  await expect
    .poll(() =>
      page.locator(".app-shell").evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--cube-white").trim(),
      ),
    )
    .toBe("#f0f0f0");

  await page.getByRole("button", { name: "恢复全亮默认" }).click();
  await expect(white).toHaveValue("#ffffff");
});

test("opens signal calibration as a dedicated page", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";
  const navigation = isMobile
    ? page.locator(".bottom-navigation")
    : page.locator(".navigation-rail");
  await navigation.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "开始采集" }).click();

  await expect(page).toHaveURL(/\/signal-lab$/);
  await expect(page.getByRole("heading", { name: "先连接蓝牙魔方" })).toBeVisible();
  await page.getByRole("button", { name: "扫描并连接魔方" }).click();
  await expect(page.getByRole("dialog", { name: "选择蓝牙魔方" })).toBeVisible();
});

test("browses, filters and prepares an OLL or PLL case", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";
  const navigation = isMobile ? page.locator(".bottom-navigation") : page.locator(".navigation-rail");
  await navigation.getByRole("button", { name: "Case" }).click();

  await expect(page.getByRole("heading", { name: "OLL / PLL 定向训练" })).toBeVisible();
  if (isMobile) await page.getByRole("button", { name: "查看 OLL 27 Sune" }).click();
  await expect(page.getByRole("heading", { name: "Sune" })).toBeVisible();
  await expect(page.getByLabel("Sune 标准图案，黄色顶面朝上，绿色面朝前")).toBeVisible();
  if (isMobile) await page.getByRole("button", { name: "返回 Case 列表" }).click();

  const search = page.getByPlaceholder("搜索名称、别名、识别特征或公式");
  await search.fill("逆小鱼");
  await expect(page.getByRole("button", { name: "查看 OLL 26 Anti-Sune" })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看 OLL 27 Sune" })).toHaveCount(0);

  await search.fill("");
  await page.getByLabel("Case 分类").getByRole("button", { name: "PLL" }).click();
  await page.getByRole("button", { name: "查看 PLL 4 T Perm" }).click();
  await expect(page.getByRole("heading", { name: "T Perm" })).toBeVisible();
  await page.getByRole("button", { name: "开始练习" }).click();
  await expect(page.getByText("T Perm 练习准备中")).toBeVisible();
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasOverflow).toBe(false);
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
