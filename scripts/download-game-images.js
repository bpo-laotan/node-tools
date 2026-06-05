#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_URLS = [
  "https://jvliang.myfunmax.com/games/Soccer_Free_Kick/index.html",
  "https://threehey.myfunmax.com/2312/Shots/index.html",
];

const DEFAULT_OUT_DIR = "./downloads";
const DEFAULT_WAIT_MS = 15000;
const DEFAULT_MODE = "strict";
const DEFAULT_MOBILE_DEVICE = "iPhone 13";
const DEFAULT_AUTO_START_DELAY_MS = 3000;
const VALID_MODES = new Set(["strict", "smart", "review"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"]);

const BLOCKED_KEYWORDS = [
  "googleads",
  "googlesyndication",
  "doubleclick",
  "adservice",
  "analytics",
  "gtag",
  "gstatic",
  "adsbygoogle",
  "pagead",
  "adtraffic",
  "tracking",
  "tracker",
  "collect",
  "beacon",
  "pixel",
  "facebook",
  "fbcdn",
  "tiktok",
  "bytedance",
  "adjust",
  "applovin",
  "unityads",
  "ironsource",
  "mintegral",
  "chartboost",
  "vungle",
];

const STATIC_DOMAIN_HINTS = ["cdn", "static", "assets", "asset", "res", "img", "image", "media"];
const GAME_ASSET_HINTS = [
  "assets",
  "asset",
  "images",
  "image",
  "img",
  "media",
  "sprites",
  "sprite",
  "textures",
  "texture",
  "game",
  "games",
  "data",
  "res",
  "static",
];
const SUSPICIOUS_PATH_HINTS = ["ad", "ads", "banner", "track", "pixel", "collect", "beacon"];
const START_TEXT_HINTS = ["start", "play", "tap to start", "click to start", "continue", "begin", "go", "launch", "enter"];
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function printHelp() {
  console.log(`Usage:
  node scripts/download-game-images.js [options]

Options:
  --url="<url1>,<url2>"           one or more page urls
  --out="./downloads"             output root directory
  --wait=30000                    extra wait time in milliseconds
  --headless                      run browser in headless mode
  --mobile                        emulate a mobile device (default: ${DEFAULT_MOBILE_DEVICE})
  --device="iPhone 13"            use a specific Playwright device profile
  --no-auto-start                 disable generic start/play click attempts
  --auto-start-delay=3000         wait before start/play click attempts
  --mode=strict|smart|review      crawl mode, default strict
  --include-cdn                   allow downloading cdnCandidate in smart/review
  --include-uncertain             allow downloading uncertain in smart/review
  --allow-domain=a.com,b.com      allowed CDN domains
  --block-domain=a.com,b.com      blocked domains
  --force                         overwrite existing files
  --help                          show this help
`);
}

function parseArgs(argv) {
  const options = {
    urls: [...DEFAULT_URLS],
    outDir: DEFAULT_OUT_DIR,
    waitMs: DEFAULT_WAIT_MS,
    headless: false,
    mobile: false,
    deviceName: "",
    autoStart: true,
    autoStartDelayMs: DEFAULT_AUTO_START_DELAY_MS,
    mode: DEFAULT_MODE,
    includeCdn: false,
    includeUncertain: false,
    allowDomains: [],
    blockDomains: [],
    force: false,
    help: false,
  };

  for (const rawArg of argv) {
    if (rawArg === "--help" || rawArg === "-h") {
      options.help = true;
      continue;
    }

    if (rawArg === "--headless") {
      options.headless = true;
      continue;
    }

    if (rawArg === "--mobile") {
      options.mobile = true;
      continue;
    }

    if (rawArg === "--include-cdn") {
      options.includeCdn = true;
      continue;
    }

    if (rawArg === "--include-uncertain") {
      options.includeUncertain = true;
      continue;
    }

    if (rawArg === "--force") {
      options.force = true;
      continue;
    }

    if (rawArg === "--no-auto-start") {
      options.autoStart = false;
      continue;
    }

    const [flag, ...valueParts] = rawArg.split("=");
    const value = valueParts.join("=");

    switch (flag) {
      case "--url":
        options.urls = value.split(",").map((item) => item.trim()).filter(Boolean);
        break;
      case "--out":
        options.outDir = value || DEFAULT_OUT_DIR;
        break;
      case "--wait":
        if (!/^\d+$/.test(value || "")) {
          throw new Error(`--wait must be a non-negative integer: ${value}`);
        }
        options.waitMs = Number(value);
        break;
      case "--auto-start-delay":
        if (!/^\d+$/.test(value || "")) {
          throw new Error(`--auto-start-delay must be a non-negative integer: ${value}`);
        }
        options.autoStartDelayMs = Number(value);
        break;
      case "--mode":
        if (!VALID_MODES.has(value)) {
          throw new Error(`--mode must be one of: strict, smart, review. Received: ${value}`);
        }
        options.mode = value;
        break;
      case "--device":
        if (!value) {
          throw new Error("--device must specify a Playwright device name");
        }
        options.deviceName = value;
        options.mobile = true;
        break;
      case "--allow-domain":
        options.allowDomains = splitCsvValue(value);
        break;
      case "--block-domain":
        options.blockDomains = splitCsvValue(value);
        break;
      default:
        throw new Error(`Unsupported argument: ${rawArg}`);
    }
  }

  options.urls = normalizeUrlList(options.urls);
  return options;
}

function splitCsvValue(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeUrlList(urls) {
  const seen = new Set();
  const normalized = [];

  for (const rawUrl of urls) {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error(`Only http/https urls are supported: ${rawUrl}`);
    }

    const href = url.toString();
    if (seen.has(href)) {
      continue;
    }

    seen.add(href);
    normalized.push(href);
  }

  if (normalized.length === 0) {
    throw new Error("At least one valid url is required");
  }

  return normalized;
}

function resolveMobileDeviceName(options) {
  if (!options.mobile && !options.deviceName) {
    return "";
  }

  return options.deviceName || DEFAULT_MOBILE_DEVICE;
}

function buildContextOptions(options, playwrightDevices) {
  const deviceName = resolveMobileDeviceName(options);
  if (!deviceName) {
    return {};
  }

  const descriptor = playwrightDevices[deviceName];
  if (!descriptor) {
    const examples = Object.keys(playwrightDevices || {}).slice(0, 8).join(", ");
    throw new Error(`Unknown Playwright device: ${deviceName}. Examples: ${examples}`);
  }

  return { ...descriptor };
}

function ensureLeadingTrailingSlash(inputPath) {
  let value = inputPath || "/";
  if (!value.startsWith("/")) {
    value = `/${value}`;
  }
  if (!value.endsWith("/")) {
    value = `${value}/`;
  }
  return value;
}

function getBasePathFromPageUrl(pageUrl) {
  const url = new URL(pageUrl);
  const pathname = url.pathname || "/";
  if (pathname.endsWith("/")) {
    return ensureLeadingTrailingSlash(pathname);
  }

  const lastSlashIndex = pathname.lastIndexOf("/");
  const basePath = lastSlashIndex >= 0 ? pathname.slice(0, lastSlashIndex + 1) : "/";
  return ensureLeadingTrailingSlash(basePath);
}

function sanitizePathSegment(input) {
  let safe = String(input || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/[.\s]+$/g, "");

  if (!safe || safe === ".") {
    safe = "_";
  }

  if (WINDOWS_RESERVED_NAMES.has(safe.toLowerCase())) {
    safe = `_${safe}`;
  }

  return safe;
}

function getGameOutputName(pageUrl) {
  const url = new URL(pageUrl);
  const segments = getBasePathFromPageUrl(pageUrl).split("/").filter(Boolean);
  const lastSegment = sanitizePathSegment(segments[segments.length - 1] || "");
  if (lastSegment && lastSegment !== "_") {
    return lastSegment;
  }

  return sanitizePathSegment(`${url.hostname}_${Date.now()}`);
}

function inferGameConfigFromUrl(pageUrl, outDir) {
  const url = new URL(pageUrl);
  const allowedBasePath = getBasePathFromPageUrl(pageUrl);
  const gameName = getGameOutputName(pageUrl);
  return {
    pageUrl: url.toString(),
    allowedOrigin: url.origin,
    allowedBasePath,
    gameName,
    gameKey: sanitizePathSegment(path.posix.basename(allowedBasePath.slice(0, -1)) || gameName).toLowerCase(),
    outputDir: path.resolve(outDir, gameName),
  };
}

function normalizeResourceUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.hash = "";
  return url.toString();
}

function getUrlWithoutQueryAndHash(rawUrl) {
  const url = new URL(rawUrl);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function getUrlExtension(rawUrl) {
  return path.posix.extname(new URL(rawUrl).pathname.toLowerCase());
}

function isImageResource({ url, contentType, resourceType }) {
  if (resourceType === "image") {
    return true;
  }
  if (String(contentType || "").toLowerCase().startsWith("image/")) {
    return true;
  }
  return IMAGE_EXTENSIONS.has(getUrlExtension(url));
}

function domainMatches(hostname, rules) {
  const lowerHostname = String(hostname || "").toLowerCase();
  return rules.some((rule) => lowerHostname === rule || lowerHostname.endsWith(`.${rule}`));
}

function containsBlockedKeyword(value) {
  const lower = String(value || "").toLowerCase();
  return BLOCKED_KEYWORDS.find((keyword) => lower.includes(keyword)) || "";
}

function containsSuspiciousPathHint(value) {
  const lower = String(value || "").toLowerCase();
  return SUSPICIOUS_PATH_HINTS.find((hint) => lower.includes(hint)) || "";
}

function isBlockedUrl(rawUrl, blockDomains) {
  const parsedUrl = new URL(rawUrl);
  const blockedKeyword = containsBlockedKeyword(rawUrl);
  if (blockedKeyword) {
    return {
      blocked: true,
      reason: `blocked keyword: ${blockedKeyword}`,
    };
  }

  if (domainMatches(parsedUrl.hostname, blockDomains)) {
    return {
      blocked: true,
      reason: `blocked domain: ${parsedUrl.hostname}`,
    };
  }

  return {
    blocked: false,
    reason: "",
  };
}

function isStrictAllowedImage(candidate, gameConfig, blockDomains) {
  if (!isImageResource(candidate)) {
    return false;
  }

  const blockedInfo = isBlockedUrl(candidate.url, blockDomains);
  if (blockedInfo.blocked) {
    return false;
  }

  const parsedUrl = new URL(candidate.url);
  return parsedUrl.origin === gameConfig.allowedOrigin && parsedUrl.pathname.startsWith(gameConfig.allowedBasePath);
}

function scoreCandidateImage(candidate, gameConfig, options) {
  const reasons = [];
  let score = 0;
  let blockedReason = "";

  const parsedUrl = new URL(candidate.url);
  const lowerUrl = candidate.url.toLowerCase();
  const lowerPathname = parsedUrl.pathname.toLowerCase();
  const lowerHostname = parsedUrl.hostname.toLowerCase();
  const lowerFrameUrl = String(candidate.frameUrl || "").toLowerCase();

  const blockedInfo = isBlockedUrl(candidate.url, options.blockDomains);
  if (blockedInfo.blocked) {
    return {
      score: 0,
      reasons: [blockedInfo.reason],
      blockedReason: blockedInfo.reason,
    };
  }

  if (candidate.frameUrl) {
    const frameBlocked = isBlockedUrl(candidate.frameUrl, options.blockDomains);
    if (frameBlocked.blocked) {
      return {
        score: 0,
        reasons: [`suspicious frame: ${frameBlocked.reason}`],
        blockedReason: `suspicious frame: ${frameBlocked.reason}`,
      };
    }
  }

  if (isImageResource(candidate)) {
    score += 25;
    reasons.push("recognized as image");
  }

  if (String(candidate.contentType || "").toLowerCase().startsWith("image/")) {
    score += 20;
    reasons.push(`content-type=${candidate.contentType}`);
  }

  if (candidate.resourceType === "image") {
    score += 15;
    reasons.push("request.resourceType=image");
  }

  if (GAME_ASSET_HINTS.some((hint) => lowerPathname.includes(hint))) {
    score += 12;
    reasons.push("path contains asset hint");
  }

  if ([lowerUrl, lowerPathname, path.posix.basename(lowerPathname)].some((value) => value.includes(gameConfig.gameKey))) {
    score += 12;
    reasons.push(`url/path contains game key: ${gameConfig.gameKey}`);
  }

  if (STATIC_DOMAIN_HINTS.some((hint) => lowerHostname.includes(hint))) {
    score += 10;
    reasons.push("hostname looks like static asset domain");
  }

  if (candidate.frameUrl) {
    try {
      const frameUrl = new URL(candidate.frameUrl);
      if (frameUrl.origin === gameConfig.allowedOrigin) {
        score += 10;
        reasons.push("frame is same-origin");
      }
      if (frameUrl.pathname.startsWith(gameConfig.allowedBasePath)) {
        score += 8;
        reasons.push("frame is inside game directory");
      }
    } catch (error) {
      reasons.push("frame url parse failed");
    }
  }

  if (candidate.fromMainFrame) {
    score += 8;
    reasons.push("request comes from main frame");
  }

  if (domainMatches(parsedUrl.hostname, options.allowDomains)) {
    score += 20;
    reasons.push(`matches allow-domain: ${parsedUrl.hostname}`);
  }

  const suspiciousHint = containsSuspiciousPathHint(lowerPathname);
  if (suspiciousHint) {
    score -= 30;
    reasons.push(`path contains suspicious hint: ${suspiciousHint}`);
  }

  if (
    candidate.frameUrl &&
    !candidate.fromMainFrame &&
    !candidate.frameUrl.startsWith(gameConfig.allowedOrigin) &&
    !candidate.frameUrl.includes(gameConfig.allowedBasePath)
  ) {
    score -= 25;
    reasons.push("asset comes from cross-frame context");
  }

  if (
    [lowerHostname, lowerUrl, lowerFrameUrl].some((value) =>
      ["facebook", "fbcdn", "google", "analytics", "doubleclick", "tiktok", "bytedance"].some((hint) =>
        value.includes(hint),
      ),
    )
  ) {
    score -= 40;
    reasons.push("ad/tracking/social platform hint");
  }

  score = Math.max(0, Math.min(100, score));
  if (score < 40) {
    blockedReason = "score below 40";
  }

  return {
    score,
    reasons,
    blockedReason,
  };
}

function classifyImageCandidate(candidate, gameConfig, options) {
  if (!isImageResource(candidate)) {
    return {
      category: "blocked",
      score: 0,
      reasons: ["not an image resource"],
      blockedReason: "not an image resource",
    };
  }

  const blockedInfo = isBlockedUrl(candidate.url, options.blockDomains);
  if (blockedInfo.blocked) {
    return {
      category: "blocked",
      score: 0,
      reasons: [blockedInfo.reason],
      blockedReason: blockedInfo.reason,
    };
  }

  if (isStrictAllowedImage(candidate, gameConfig, options.blockDomains)) {
    return {
      category: "allowed",
      score: 100,
      reasons: ["passes strict same-origin same-directory rules"],
      blockedReason: "",
    };
  }

  const scored = scoreCandidateImage(candidate, gameConfig, options);
  if (scored.score >= 70) {
    return {
      category: "cdnCandidate",
      score: scored.score,
      reasons: scored.reasons,
      blockedReason: "",
    };
  }

  if (scored.score >= 40) {
    return {
      category: "uncertain",
      score: scored.score,
      reasons: scored.reasons,
      blockedReason: "",
    };
  }

  return {
    category: "blocked",
    score: scored.score,
    reasons: scored.reasons,
    blockedReason: scored.blockedReason || "score too low",
  };
}

function getStableFallbackName(urlObject) {
  const digest = crypto.createHash("sha1").update(urlObject.toString()).digest("hex").slice(0, 12);
  const extension = getUrlExtension(urlObject.toString()) || ".img";
  return `asset-${digest}${extension}`;
}

function sanitizeRelativePath(relativePath) {
  return String(relativePath || "")
    .split("/")
    .filter(Boolean)
    .map(sanitizePathSegment)
    .filter(Boolean)
    .join(path.sep);
}

function getRelativeAssetPath(url, category, gameConfig) {
  const urlObject = new URL(getUrlWithoutQueryAndHash(url));
  const pathname = urlObject.pathname;

  if (category === "allowed") {
    const relative = sanitizeRelativePath(pathname.slice(gameConfig.allowedBasePath.length));
    return relative || getStableFallbackName(urlObject);
  }

  const prefix = category === "cdnCandidate" ? "__cdn__" : "__uncertain__";
  const safeDomain = sanitizePathSegment(urlObject.hostname);
  const safePath = sanitizeRelativePath(pathname);
  return safePath ? path.join(prefix, safeDomain, safePath) : path.join(prefix, safeDomain, getStableFallbackName(urlObject));
}

function getLocalFilePath(url, category, gameConfig) {
  let targetPath = path.resolve(gameConfig.outputDir, getRelativeAssetPath(url, category, gameConfig));
  const cleanedUrl = new URL(getUrlWithoutQueryAndHash(url));
  const extension = getUrlExtension(cleanedUrl.toString());

  if (!path.basename(targetPath).includes(".")) {
    targetPath = path.join(targetPath, getStableFallbackName(cleanedUrl));
  } else if (!IMAGE_EXTENSIONS.has(path.extname(targetPath).toLowerCase()) && extension) {
    targetPath = path.join(path.dirname(targetPath), `${path.basename(targetPath, path.extname(targetPath))}${extension}`);
  }

  return targetPath;
}

async function collectDomImageUrls(page) {
  return page.evaluate(() => {
    const result = new Set();
    const selectors = [
      "img[src]",
      "source[src]",
      "source[srcset]",
      "picture source",
      "link[rel~='icon']",
      "link[rel='preload'][as='image']",
      "[style*='background-image']",
    ];

    const addCssUrls = (value) => {
      const matches = String(value || "").match(/url\((['"]?)(.*?)\1\)/gi) || [];
      for (const match of matches) {
        const nested = match.match(/url\((['"]?)(.*?)\1\)/i);
        if (nested && nested[2]) {
          result.add(nested[2]);
        }
      }
    };

    const addSrcsetUrls = (srcset) => {
      for (const item of String(srcset || "").split(",")) {
        const [url] = item.trim().split(/\s+/);
        if (url) {
          result.add(url);
        }
      }
    };

    for (const node of document.querySelectorAll(selectors.join(","))) {
      if (node instanceof HTMLImageElement && node.currentSrc) {
        result.add(node.currentSrc);
      }

      for (const attr of ["src", "href"]) {
        const value = node.getAttribute(attr);
        if (value) {
          result.add(value);
        }
      }

      const srcset = node.getAttribute("srcset");
      if (srcset) {
        addSrcsetUrls(srcset);
      }

      const inlineStyle = node.getAttribute("style");
      if (inlineStyle) {
        addCssUrls(inlineStyle);
      }
    }

    for (const element of document.querySelectorAll("*")) {
      const style = window.getComputedStyle(element);
      addCssUrls(style.backgroundImage);
      addCssUrls(style.background);
      addCssUrls(style.maskImage);
      addCssUrls(style.borderImageSource);
      addCssUrls(style.content);
    }

    return Array.from(result);
  });
}

function shouldDownloadCategory(category, options) {
  if (category === "allowed") {
    return true;
  }
  if (category === "cdnCandidate") {
    return Boolean(options.includeCdn && (options.mode === "smart" || options.mode === "review"));
  }
  if (category === "uncertain") {
    return Boolean(options.includeUncertain && (options.mode === "smart" || options.mode === "review"));
  }
  return false;
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function downloadFile(resource, options) {
  if (fs.existsSync(resource.localPath) && !options.force) {
    return {
      downloaded: false,
      skipped: true,
      error: "",
    };
  }

  await ensureDir(path.dirname(resource.localPath));

  const response = await fetch(resource.url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(resource.localPath, buffer);

  return {
    downloaded: true,
    skipped: false,
    error: "",
  };
}

async function writeReport(gameResult) {
  await ensureDir(gameResult.gameConfig.outputDir);

  const reportPath = path.join(gameResult.gameConfig.outputDir, "report.json");
  const candidatesPath = path.join(gameResult.gameConfig.outputDir, "candidates.txt");

  await fs.promises.writeFile(
    reportPath,
    JSON.stringify(
      {
        gameName: gameResult.gameConfig.gameName,
        pageUrl: gameResult.gameConfig.pageUrl,
        allowedOrigin: gameResult.gameConfig.allowedOrigin,
        allowedBasePath: gameResult.gameConfig.allowedBasePath,
        mode: gameResult.options.mode,
        mobileDevice: resolveMobileDeviceName(gameResult.options) || "",
        generatedAt: new Date().toISOString(),
        summary: gameResult.summary,
        resources: gameResult.resources.map((resource) => ({
          url: resource.url,
          normalizedUrl: resource.normalizedUrl,
          localPath: resource.localPath,
          origin: resource.origin,
          hostname: resource.hostname,
          pathname: resource.pathname,
          contentType: resource.contentType,
          resourceType: resource.resourceType,
          frameUrl: resource.frameUrl,
          category: resource.category,
          score: resource.score,
          reasons: resource.reasons,
          blockedReason: resource.blockedReason,
          downloaded: resource.downloaded,
          downloadError: resource.downloadError,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  const grouped = {
    allowed: [],
    cdnCandidate: [],
    uncertain: [],
    blocked: [],
  };

  for (const resource of gameResult.resources) {
    grouped[resource.category].push(resource);
  }

  const lines = [];
  for (const category of ["allowed", "cdnCandidate", "uncertain", "blocked"]) {
    lines.push(`[${category}]`);
    if (grouped[category].length === 0) {
      lines.push("(empty)");
      lines.push("");
      continue;
    }

    for (const resource of grouped[category]) {
      lines.push(`score=${resource.score} url=${resource.url}`);
      lines.push(`reasons=${resource.reasons.join("; ") || "-"}`);
      if (resource.blockedReason) {
        lines.push(`blockedReason=${resource.blockedReason}`);
      }
      lines.push("");
    }
  }

  await fs.promises.writeFile(candidatesPath, `${lines.join("\n")}\n`, "utf8");

  return {
    reportPath,
    candidatesPath,
  };
}

function createResourceRecord(rawCandidate, gameConfig, options) {
  const normalizedUrl = normalizeResourceUrl(rawCandidate.url);
  const parsedUrl = new URL(normalizedUrl);
  const classification = classifyImageCandidate(rawCandidate, gameConfig, options);

  return {
    url: rawCandidate.url,
    normalizedUrl,
    localPath: getLocalFilePath(rawCandidate.url, classification.category, gameConfig),
    origin: parsedUrl.origin,
    hostname: parsedUrl.hostname,
    pathname: parsedUrl.pathname,
    contentType: rawCandidate.contentType || "",
    resourceType: rawCandidate.resourceType || "",
    frameUrl: rawCandidate.frameUrl || "",
    fromMainFrame: Boolean(rawCandidate.fromMainFrame),
    category: classification.category,
    score: classification.score,
    reasons: classification.reasons,
    blockedReason: classification.blockedReason,
    downloaded: false,
    skipped: false,
    downloadError: "",
  };
}

function mergeResourceMetadata(existing, incoming, gameConfig, options) {
  const refreshed = createResourceRecord(
    {
      url: incoming.url || existing.url,
      contentType: incoming.contentType || existing.contentType,
      resourceType: incoming.resourceType || existing.resourceType,
      frameUrl: incoming.frameUrl || existing.frameUrl,
      fromMainFrame: incoming.fromMainFrame || existing.fromMainFrame,
    },
    gameConfig,
    options,
  );

  return {
    ...existing,
    ...refreshed,
    downloaded: existing.downloaded,
    skipped: existing.skipped,
    downloadError: existing.downloadError,
  };
}

function summarizeResources(resources) {
  const summary = {
    totalDiscovered: resources.length,
    allowed: 0,
    cdnCandidate: 0,
    uncertain: 0,
    blocked: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
  };

  for (const resource of resources) {
    summary[resource.category] += 1;
    if (resource.downloaded) {
      summary.downloaded += 1;
    }
    if (resource.skipped) {
      summary.skipped += 1;
    }
    if (resource.downloadError) {
      summary.failed += 1;
    }
  }

  return summary;
}

function escapeForRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function tryClickLocator(locator) {
  const count = await locator.count();
  if (count === 0) {
    return false;
  }

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    try {
      await item.scrollIntoViewIfNeeded({ timeout: 1500 });
    } catch (error) {
      // 保持继续，某些遮罩按钮即使无法滚动也可以强制点击。
    }

    try {
      await item.click({ timeout: 2000, force: true });
      return true;
    } catch (error) {
      // 当前候选点击失败时继续尝试其他元素。
    }
  }

  return false;
}

async function attemptAutoStart(page, options, warnings) {
  if (!options.autoStart) {
    return {
      attempted: false,
      clicked: false,
      strategy: "disabled",
    };
  }

  try {
    await page.waitForTimeout(options.autoStartDelayMs);
  } catch (error) {
    warnings.push(`auto-start delay failed: ${error.message}`);
  }

  const startPattern = new RegExp(START_TEXT_HINTS.map(escapeForRegex).join("|"), "i");

  const strategies = [
    {
      name: "start text",
      run: () => tryClickLocator(page.locator("button, [role='button'], a, div, span").filter({ hasText: startPattern })),
    },
    {
      name: "button element",
      run: () => tryClickLocator(page.locator("button, [role='button'], input[type='button'], input[type='submit']")),
    },
    {
      name: "canvas center",
      run: async () => {
        const canvas = page.locator("canvas").first();
        if ((await canvas.count()) === 0) {
          return false;
        }

        const box = await canvas.boundingBox();
        if (!box) {
          return false;
        }

        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
      },
    },
    {
      name: "page center",
      run: async () => {
        const viewport = page.viewportSize();
        if (!viewport) {
          return false;
        }

        await page.mouse.click(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
        return true;
      },
    },
  ];

  for (const strategy of strategies) {
    try {
      const clicked = await strategy.run();
      if (clicked) {
        return {
          attempted: true,
          clicked: true,
          strategy: strategy.name,
        };
      }
    } catch (error) {
      warnings.push(`auto-start strategy failed (${strategy.name}): ${error.message}`);
    }
  }

  return {
    attempted: true,
    clicked: false,
    strategy: "none",
  };
}

async function crawlGameImages(browser, gameConfig, options, playwrightDevices) {
  const context = await browser.newContext(buildContextOptions(options, playwrightDevices));
  const page = await context.newPage();
  const resourceMap = new Map();
  const seenLocalPathSet = new Set();
  const warnings = [];

  /**
   * 网络事件和 DOM 补扫都走同一套入库逻辑，保证分类、路径和去重规则完全一致。
   */
  const registerCandidate = (candidate) => {
    let normalizedUrl;
    try {
      normalizedUrl = normalizeResourceUrl(candidate.url);
    } catch (error) {
      warnings.push(`ignore invalid resource url: ${candidate.url}`);
      return;
    }

    const existing = resourceMap.get(normalizedUrl);
    if (existing) {
      resourceMap.set(normalizedUrl, mergeResourceMetadata(existing, candidate, gameConfig, options));
      return;
    }

    const resource = createResourceRecord(candidate, gameConfig, options);
    if (seenLocalPathSet.has(resource.localPath)) {
      warnings.push(`skip duplicate local path: ${resource.localPath}`);
      return;
    }

    seenLocalPathSet.add(resource.localPath);
    resourceMap.set(normalizedUrl, resource);
  };

  page.on("response", async (response) => {
    try {
      const request = response.request();
      const frame = request.frame();
      const candidate = {
        url: response.url(),
        contentType: response.headers()["content-type"] || "",
        resourceType: request.resourceType(),
        frameUrl: frame ? frame.url() : "",
        fromMainFrame: frame ? frame === page.mainFrame() : false,
      };

      if (isImageResource(candidate)) {
        registerCandidate(candidate);
      }
    } catch (error) {
      warnings.push(`response handler failed: ${error.message}`);
    }
  });

  let pageError = "";
  try {
    await page.goto(gameConfig.pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  } catch (error) {
    pageError = error.message;
    warnings.push(`page load failed: ${error.message}`);
  }

  /**
   * H5 游戏常见“先等一次用户手势再真正进入游戏”的场景。
   * 这里做通用自动点击，尽量把启动后懒加载的图片也纳入抓取窗口。
   */
  const autoStartResult = await attemptAutoStart(page, options, warnings);
  if (autoStartResult.clicked) {
    warnings.push(`auto-start clicked with strategy: ${autoStartResult.strategy}`);
  } else if (autoStartResult.attempted) {
    warnings.push("auto-start did not find a clickable game entry");
  }

  try {
    await page.waitForTimeout(options.waitMs);
  } catch (error) {
    warnings.push(`wait stage failed: ${error.message}`);
  }

  try {
    const domUrls = await collectDomImageUrls(page);
    for (const domUrl of domUrls) {
      try {
        registerCandidate({
          url: new URL(domUrl, gameConfig.pageUrl).toString(),
          contentType: "",
          resourceType: "dom",
          frameUrl: gameConfig.pageUrl,
          fromMainFrame: true,
        });
      } catch (error) {
        warnings.push(`dom url parse failed: ${domUrl}`);
      }
    }
  } catch (error) {
    warnings.push(`dom scan failed: ${error.message}`);
  }

  const resources = Array.from(resourceMap.values()).sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));

  for (const resource of resources) {
    if (!shouldDownloadCategory(resource.category, options)) {
      continue;
    }

    try {
      const result = await downloadFile(resource, options);
      resource.downloaded = result.downloaded;
      resource.skipped = result.skipped;
    } catch (error) {
      resource.downloadError = error.message;
      warnings.push(`download failed: ${resource.url} -> ${error.message}`);
    }
  }

  await context.close();

  return {
    gameConfig,
    options,
    resources,
    summary: summarizeResources(resources),
    warnings,
    pageError,
  };
}

function isLinuxRuntime() {
  return process.platform === "linux";
}

function getMissingLinuxLibrary(errorMessage) {
  const match = String(errorMessage || "").match(/error while loading shared libraries:\s+([^:\s]+)\s*:/i);
  return match ? match[1] : "";
}

function printBrowserLaunchGuidance(error) {
  const message = String(error && (error.stack || error.message) ? error.stack || error.message : error);
  const missingLibrary = getMissingLinuxLibrary(message);

  console.error("Browser launch failed.");
  if (missingLibrary) {
    console.error(`Missing Linux library: ${missingLibrary}`);
  }

  if (isLinuxRuntime()) {
    console.error("This looks like a Linux/WSL runtime. Playwright browsers need extra system dependencies.");
    console.error("Try:");
    console.error("1. sudo npx playwright install-deps chromium");
    console.error("2. npx playwright install chromium");
    console.error("3. Or set PLAYWRIGHT_EXECUTABLE_PATH to an existing Chrome/Chromium binary");
  } else {
    console.error("Try running: npx playwright install chromium");
  }
}

async function launchBrowser(chromium, options) {
  const launchOptions = {
    headless: options.headless,
  };

  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  }

  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    printBrowserLaunchGuidance(error);
    throw error;
  }
}

function printGameSummary(gameResult, reportPaths) {
  const summary = gameResult.summary;
  console.log("");
  console.log(`Game: ${gameResult.gameConfig.gameName}`);
  console.log(`Page: ${gameResult.gameConfig.pageUrl}`);
  console.log(`allowedOrigin: ${gameResult.gameConfig.allowedOrigin}`);
  console.log(`allowedBasePath: ${gameResult.gameConfig.allowedBasePath}`);
  console.log(`Output: ${gameResult.gameConfig.outputDir}`);
  console.log(`Mode: ${gameResult.options.mode}`);
  if (resolveMobileDeviceName(gameResult.options)) {
    console.log(`Mobile device: ${resolveMobileDeviceName(gameResult.options)}`);
  }
  console.log(`Discovered: ${summary.totalDiscovered}`);
  console.log(`Allowed: ${summary.allowed}`);
  console.log(`cdnCandidate: ${summary.cdnCandidate}`);
  console.log(`Uncertain: ${summary.uncertain}`);
  console.log(`Blocked: ${summary.blocked}`);
  console.log(`Downloaded: ${summary.downloaded}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`report.json: ${reportPaths.reportPath}`);
  console.log(`candidates.txt: ${reportPaths.candidatesPath}`);

  if (gameResult.warnings.length > 0) {
    console.warn(`Warnings: ${gameResult.warnings.length}`);
  }
}

function printFinalSummary(results, outDir) {
  const total = {
    games: results.length,
    images: 0,
    downloaded: 0,
    failed: 0,
  };

  for (const result of results) {
    total.images += result.summary.totalDiscovered;
    total.downloaded += result.summary.downloaded;
    total.failed += result.summary.failed;
  }

  console.log("");
  console.log("Done");
  console.log(`Total games: ${total.games}`);
  console.log(`Total discovered images: ${total.images}`);
  console.log(`Total downloaded: ${total.downloaded}`);
  console.log(`Total failed: ${total.failed}`);
  console.log(`Output root: ${path.resolve(outDir)}`);
}

async function runSelfChecks() {
  const assert = (condition, message) => {
    if (!condition) {
      throw new Error(message);
    }
  };

  const args = parseArgs([
    "--url=https://example.com/game/index.html,https://example.com/game/index.html,https://example.com/game2/index.html",
    "--out=./downloads",
    "--wait=30000",
    "--headless",
    "--mobile",
    "--device=Pixel 7",
    "--mode=smart",
    "--include-cdn",
    "--include-uncertain",
    "--allow-domain=cdn.example.com,static.example.com",
    "--block-domain=ads.example.com,tracker.example.com",
    "--auto-start-delay=2500",
    "--force",
  ]);

  assert(args.urls.length === 2, "parseArgs failed: urls");
  assert(args.waitMs === 30000, "parseArgs failed: waitMs");
  assert(args.headless === true, "parseArgs failed: headless");
  assert(args.mobile === true, "parseArgs failed: mobile");
  assert(args.deviceName === "Pixel 7", "parseArgs failed: device");
  assert(args.autoStart === true, "parseArgs failed: autoStart");
  assert(args.autoStartDelayMs === 2500, "parseArgs failed: autoStartDelayMs");
  assert(args.mode === "smart", "parseArgs failed: mode");

  assert(getBasePathFromPageUrl("https://jvliang.myfunmax.com/games/Soccer_Free_Kick/index.html") === "/games/Soccer_Free_Kick/", "basePath failed #1");
  assert(getBasePathFromPageUrl("https://threehey.myfunmax.com/2312/Shots/index.html") === "/2312/Shots/", "basePath failed #2");
  assert(getBasePathFromPageUrl("https://example.com/a/b/c/index.html") === "/a/b/c/", "basePath failed #3");
  assert(getBasePathFromPageUrl("https://example.com/a/b/c/") === "/a/b/c/", "basePath failed #4");

  const gameConfig = inferGameConfigFromUrl("https://example.com/games/TestGame/index.html", "./downloads");
  const commonOptions = {
    mode: "smart",
    includeCdn: false,
    includeUncertain: false,
    allowDomains: ["cdn.example.com"],
    blockDomains: ["ads.example.com", "tracker.example.com"],
    force: false,
    autoStart: true,
    autoStartDelayMs: 1000,
    mobile: false,
    deviceName: "",
  };

  const allowedCandidate = {
    url: "https://example.com/games/TestGame/images/a.png?v=1",
    contentType: "image/png",
    resourceType: "image",
    frameUrl: "https://example.com/games/TestGame/index.html",
    fromMainFrame: true,
  };
  const cdnCandidate = {
    url: "https://cdn.example.com/assets/TestGame/hero.webp?ver=2",
    contentType: "image/webp",
    resourceType: "image",
    frameUrl: "https://example.com/games/TestGame/index.html",
    fromMainFrame: true,
  };
  const blockedCandidate = {
    url: "https://ads.example.com/banner.png",
    contentType: "image/png",
    resourceType: "image",
    frameUrl: "https://ads.example.com/frame.html",
    fromMainFrame: false,
  };

  assert(isStrictAllowedImage(allowedCandidate, gameConfig, commonOptions.blockDomains), "strict filter failed: allowed");
  assert(!isStrictAllowedImage(cdnCandidate, gameConfig, commonOptions.blockDomains), "strict filter failed: cdn");
  assert(classifyImageCandidate(blockedCandidate, gameConfig, commonOptions).category === "blocked", "classify failed: blocked");
  assert(classifyImageCandidate(cdnCandidate, gameConfig, commonOptions).category === "cdnCandidate", "classify failed: cdnCandidate");

  const allowedLocalPath = getLocalFilePath(allowedCandidate.url, "allowed", gameConfig);
  assert(allowedLocalPath.endsWith(path.join("TestGame", "images", "a.png")), "local path failed: allowed");

  const cdnLocalPath = getLocalFilePath(cdnCandidate.url, "cdnCandidate", gameConfig);
  assert(cdnLocalPath.includes(path.join("TestGame", "__cdn__", "cdn.example.com")), "local path failed: cdn");

  const tmpOutput = path.join(os.tmpdir(), `game-image-downloader-self-check-${Date.now()}`);
  const dummyResult = {
    gameConfig: {
      ...gameConfig,
      outputDir: tmpOutput,
    },
    options: commonOptions,
    resources: [
      createResourceRecord(allowedCandidate, gameConfig, commonOptions),
      createResourceRecord(cdnCandidate, gameConfig, commonOptions),
      createResourceRecord(blockedCandidate, gameConfig, commonOptions),
    ],
  };
  dummyResult.summary = summarizeResources(dummyResult.resources);

  const reportPaths = await writeReport(dummyResult);
  assert(fs.existsSync(reportPaths.reportPath), "writeReport failed: report.json");
  assert(fs.existsSync(reportPaths.candidatesPath), "writeReport failed: candidates.txt");

  return {
    ok: true,
    reportPaths,
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Argument error: ${error.message}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  let chromium;
  let devices;
  try {
    ({ chromium, devices } = require("playwright"));
  } catch (error) {
    console.error(`Unable to load playwright: ${error.message}`);
    console.error("Run npm install first, or ensure playwright is resolvable in the current environment.");
    process.exitCode = 1;
    return;
  }

  const browser = await launchBrowser(chromium, options);
  const results = [];

  try {
    for (const pageUrl of options.urls) {
      const gameConfig = inferGameConfigFromUrl(pageUrl, options.outDir);
      console.log(`Starting crawl: ${gameConfig.pageUrl}`);
      const gameResult = await crawlGameImages(browser, gameConfig, options, devices);
      const reportPaths = await writeReport(gameResult);
      printGameSummary(gameResult, reportPaths);
      results.push(gameResult);
    }
  } finally {
    await browser.close();
  }

  printFinalSummary(results, options.outDir);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Execution failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  BLOCKED_KEYWORDS,
  DEFAULT_MODE,
  DEFAULT_OUT_DIR,
  DEFAULT_URLS,
  DEFAULT_WAIT_MS,
  DEFAULT_MOBILE_DEVICE,
  DEFAULT_AUTO_START_DELAY_MS,
  attemptAutoStart,
  buildContextOptions,
  classifyImageCandidate,
  collectDomImageUrls,
  crawlGameImages,
  downloadFile,
  getBasePathFromPageUrl,
  getGameOutputName,
  getLocalFilePath,
  getRelativeAssetPath,
  inferGameConfigFromUrl,
  isBlockedUrl,
  isImageResource,
  isStrictAllowedImage,
  launchBrowser,
  main,
  normalizeUrlList,
  parseArgs,
  printBrowserLaunchGuidance,
  resolveMobileDeviceName,
  runSelfChecks,
  sanitizePathSegment,
  scoreCandidateImage,
  shouldDownloadCategory,
  writeReport,
};
