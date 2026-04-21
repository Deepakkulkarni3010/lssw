// Use playwright-extra with stealth plugin to bypass LinkedIn bot detection
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext, Page } from 'playwright';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { redisClient, keys } from '../../redis/client';
import { CandidateCard, SearchParams, SearchResult } from '../../types';

// Register stealth plugin once
chromiumExtra.use(StealthPlugin());

// ─── URL Builder ──────────────────────────────────────────────────────────────

function buildLinkedInSearchUrl(params: SearchParams): string {
  const base = 'https://www.linkedin.com/search/results/people/';
  const query = new URLSearchParams();

  // Build keywords: combine customString / keywords, title, location, company
  // into one keyword string so LinkedIn's full-text search handles them.
  // NOTE: LinkedIn's People search URL does NOT support a structured `title`
  // filter via query params — passing title/company/location as plain URL
  // params breaks the search and returns 0 results. Only `keywords` reliably
  // works for filtering in the public search UI.
  const keywordParts: string[] = [];

  if (params.customString) {
    keywordParts.push(params.customString);
  } else if (params.keywords) {
    keywordParts.push(params.keywords);
  }

  if (params.title)    keywordParts.push(`"${params.title}"`);
  if (params.company)  keywordParts.push(`"${params.company}"`);
  if (params.location) keywordParts.push(params.location);
  if (params.school)   keywordParts.push(`"${params.school}"`);

  if (keywordParts.length > 0) {
    query.set('keywords', keywordParts.join(' '));
  }

  // Network (connection degree) — this param does work reliably
  if (params.connectionDegree?.length) {
    query.set('network', JSON.stringify(params.connectionDegree));
  }

  // LinkedIn Premium filters
  if (params.yearsOfExperience) query.set('yearsOfExperience', params.yearsOfExperience);
  if (params.companySize)       query.set('companySize', params.companySize);

  query.set('origin', 'FACETED_SEARCH');
  query.set('sid', `${Date.now()}`);

  return `${base}?${query.toString()}`;
}

// ─── Anti-Detection Helpers ───────────────────────────────────────────────────

async function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise((r) => setTimeout(r, delay));
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── Context Serialization ────────────────────────────────────────────────────

async function saveContext(userId: string, context: BrowserContext): Promise<void> {
  const state = await context.storageState();
  await redisClient.setex(
    keys.browserCtx(userId),
    3600, // 1 hour
    JSON.stringify(state),
  );
}

async function loadContext(browser: Browser, userId: string): Promise<BrowserContext> {
  const stored = await redisClient.get(keys.browserCtx(userId));
  const userAgent = randomUserAgent();

  if (stored) {
    logger.debug('Restoring browser context from Redis', { userId });
    return browser.newContext({
      storageState: JSON.parse(stored),
      userAgent,
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'Europe/Berlin', // EU data residency
      geolocation: { latitude: 52.52, longitude: 13.4 }, // Berlin
      permissions: [],
    });
  }

  logger.debug('Creating new browser context', { userId });
  return browser.newContext({
    userAgent,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    permissions: [],
  });
}

// ─── Result Scraper ───────────────────────────────────────────────────────────

function evalTimeout<T>(ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms));
}

async function scrapeResults(page: Page): Promise<CandidateCard[]> {
  await page.waitForTimeout(1500);

  // Human-like scroll behavior (with catch in case page is gone)
  await page.evaluate(() => { window.scrollBy({ top: 300, behavior: 'smooth' }); }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.scrollBy({ top: 400, behavior: 'smooth' }); }).catch(() => {});
  await page.waitForTimeout(600);

  // Diagnostic with hard 5s timeout — never hang here
  const diagInfo = await Promise.race([
    page.evaluate(() => {
      const profileLinks = document.querySelectorAll('a[href*="/in/"]').length;
      const liItems = document.querySelectorAll('li').length;
      const bodyText = document.body?.innerText?.substring(0, 300) ?? '';
      return {
        currentUrl: window.location.href.substring(0, 120),
        pageTitle: document.title.substring(0, 80),
        profileLinks,
        liItems,
        bodyText,
      };
    }),
    evalTimeout(5000, { currentUrl: 'timeout', pageTitle: 'timeout', profileLinks: 0, liItems: 0, bodyText: '' }),
  ]);
  logger.info('Scraper diagnostic', diagInfo);

  // If LinkedIn served "No results found" page, bail early
  if (
    diagInfo.bodyText.toLowerCase().includes('no results found') ||
    diagInfo.bodyText.toLowerCase().includes('try removing filters')
  ) {
    logger.warn('LinkedIn served empty-results page (bot detection likely)', {
      url: diagInfo.currentUrl,
    });
    return [];
  }

  // Main extraction with hard 15s timeout — walk from profile links upward
  let candidates: CandidateCard[] = [];
  try {
    candidates = await Promise.race([
      page.evaluate((): any[] => {
        const cards: any[] = [];
        const seen = new Set<string>();

        // Primary strategy: walk from <a href="/in/..."> links upward to find the card container
        const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'));
        for (const link of allLinks) {
          try {
            // Normalize profile URL (strip query params)
            const href = link.href || '';
            const profileUrl = href.split('?')[0].split('#')[0];
            if (!profileUrl || !profileUrl.includes('/in/') || seen.has(profileUrl)) continue;
            seen.add(profileUrl);

            // Walk up the DOM to find the <li> card container (max 8 levels)
            let container: Element | null = link;
            for (let i = 0; i < 8; i++) {
              if (!container?.parentElement) break;
              container = container.parentElement;
              if (container.tagName === 'LI') break;
            }
            if (!container) continue;

            // Name: look for aria-hidden span in/near the link, or data-anonymize
            const nameEl = (
              link.querySelector('span[aria-hidden="true"]') ||
              link.querySelector('span') ||
              container.querySelector('[data-anonymize="person-name"]') ||
              container.querySelector('.entity-result__title-text span[aria-hidden]') ||
              container.querySelector('span.entity-result__title-text a span')
            );
            const name = (nameEl?.textContent ?? link.textContent ?? '').trim();
            if (!name || name === 'LinkedIn Member' || name.length < 2) continue;

            // Title / company
            const titleEl = (
              container.querySelector('.entity-result__primary-subtitle') ||
              container.querySelector('[data-anonymize="job-title"]')
            );
            const titleText = (titleEl?.textContent ?? '').trim();
            const atIdx = titleText.lastIndexOf(' at ');
            const title   = atIdx > -1 ? titleText.substring(0, atIdx).trim() : titleText;
            const company = atIdx > -1 ? titleText.substring(atIdx + 4).trim() : '';

            // Location
            const locationEl = (
              container.querySelector('.entity-result__secondary-subtitle') ||
              container.querySelector('[data-anonymize="location"]')
            );
            const location = (locationEl?.textContent ?? '').trim();

            // Headline
            const headlineEl = (
              container.querySelector('.entity-result__summary') ||
              container.querySelector('.entity-result__summary--2-lines') ||
              container.querySelector('[data-anonymize="headline"]')
            );
            const headline = (headlineEl?.textContent ?? '').trim();

            // Profile pic
            const picEl = (
              container.querySelector('img.presence-entity__image') ||
              container.querySelector('img.EntityPhoto-circle-3') ||
              container.querySelector('img[data-ghost-classes]') ||
              container.querySelector('img')
            ) as HTMLImageElement | null;
            const profilePicUrl = picEl?.src ?? '';

            // Connection degree
            const degreeEl = (
              container.querySelector('.dist-value') ||
              container.querySelector('[class*="dist-value"]') ||
              container.querySelector('[aria-label*="degree"]')
            );
            const degreeText = (degreeEl?.textContent ?? '').trim();
            let connectionDegree: string = 'Out of Network';
            if (degreeText.includes('1st') || degreeText.includes('1°')) connectionDegree = '1st';
            else if (degreeText.includes('2nd') || degreeText.includes('2°')) connectionDegree = '2nd';
            else if (degreeText.includes('3rd') || degreeText.includes('3°')) connectionDegree = '3rd';

            // Open to Work
            const openBadge = container.querySelector(
              '[data-test-is-open-to-work], .open-to-work-badge, [aria-label*="Open to work"], [aria-label*="open to work"], .pv-member-badges__badge--opentowork'
            );
            const isOpenToWork = !!openBadge ||
              headline.toLowerCase().includes('#opentowork') ||
              headline.toLowerCase().includes('open to work');

            // Mutual connections
            const mutualEl = container.querySelector('.member-insights__container');
            const mutualText = (mutualEl?.textContent ?? '').trim();
            const mutualMatch = mutualText.match(/(\d+)\s*mutual/i);
            const mutualConnections = mutualMatch ? parseInt(mutualMatch[1], 10) : undefined;

            const nameParts = name.split(' ');
            cards.push({
              name,
              firstName: nameParts[0],
              lastName: nameParts.slice(1).join(' '),
              title,
              company,
              location,
              headline,
              profileUrl,
              profilePicUrl,
              connectionDegree,
              isOpenToWork,
              badges: isOpenToWork ? ['Open to Work'] : [],
              mutualConnections,
            });
          } catch {
            // Skip malformed entry
          }
        }
        return cards;
      }),
      evalTimeout(15000, [] as any[]),
    ]);
  } catch (evalErr) {
    logger.warn('page.evaluate threw during scrape', { err: String(evalErr) });
    candidates = [];
  }

  logger.info('Scraper extracted candidates', { count: candidates.length });
  return candidates as CandidateCard[];
}

// ─── Main Adapter ─────────────────────────────────────────────────────────────

export class PlaywrightLinkedInAdapter {
  private browser: Browser | null = null;
  private activeSessions: Map<string, BrowserContext> = new Map();

  async initialize(): Promise<void> {
    logger.info('Initializing Playwright browser (stealth mode)');
    // Cast required: playwright-extra returns a compatible Browser type
    this.browser = await (chromiumExtra as any).launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        // NOTE: intentionally omitting --disable-web-security,
        // --disable-features=IsolateOrigins, --disable-site-isolation-trials
        // as those flags are headless browser fingerprints that LinkedIn detects
      ],
    }) as Browser;
    logger.info('Playwright browser initialized (stealth mode)');
  }

  async shutdown(): Promise<void> {
    for (const ctx of this.activeSessions.values()) {
      await ctx.close().catch(() => {});
    }
    this.activeSessions.clear();
    await this.browser?.close();
    logger.info('Playwright browser shut down');
  }

  private async getContext(userId: string): Promise<BrowserContext> {
    if (!this.browser) throw new Error('Browser not initialized');

    let ctx = this.activeSessions.get(userId);
    if (!ctx || ctx.pages().length === 0) {
      ctx = await loadContext(this.browser, userId);
      this.activeSessions.set(userId, ctx);
    }
    return ctx;
  }

  // ─── Inject LinkedIn session cookies ─────────────────────────────────────

  async injectLinkedInSession(
    userId: string,
    liAt: string,       // li_at cookie (LinkedIn auth)
    jsessionid: string, // JSESSIONID cookie
  ): Promise<void> {
    const ctx = await this.getContext(userId);
    await ctx.addCookies([
      {
        name: 'li_at',
        value: liAt,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      },
      {
        name: 'JSESSIONID',
        value: jsessionid,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true,
      },
    ]);
    await saveContext(userId, ctx);
  }

  // ─── Execute Search ───────────────────────────────────────────────────────

  async executeSearch(
    params: SearchParams,
    userId: string,
    page = 1,
  ): Promise<{ results: CandidateCard[]; hasMore: boolean }> {
    if (!this.browser) throw new Error('Browser not initialized');

    // Check captcha ban
    const banned = await redisClient.get(keys.captchaBan(userId));
    if (banned) {
      throw new Error('CAPTCHA_BANNED');
    }

    const ctx = await this.getContext(userId);
    const browserPage = await ctx.newPage();

    try {
      // Block unnecessary resources to speed up load
      await browserPage.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}', (route) => {
        route.abort();
      });

      const url = buildLinkedInSearchUrl(params);
      const pageUrl = page > 1 ? `${url}&start=${(page - 1) * 10}` : url;

      logger.info('Navigating to LinkedIn search', {
        userId,
        url: pageUrl.substring(0, 100),
      });

      const response = await browserPage.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.playwright.browserTimeoutMs,
      });

      if (!response) throw new Error('LINKEDIN_NO_RESPONSE');

      const finalUrl = browserPage.url();

      // Check if redirected to auth (session expired)
      if (finalUrl.includes('/login') || finalUrl.includes('/checkpoint')) {
        throw new Error('LINKEDIN_SESSION_EXPIRED');
      }

      // Check for CAPTCHA
      const hasCaptcha = await browserPage.$('[data-test-id="challenge-form"], .challenge-page');
      if (hasCaptcha) {
        await redisClient.setex(keys.captchaBan(userId), 1800, '1'); // 30 min ban
        throw new Error('LINKEDIN_CAPTCHA');
      }

      // Wait for results
      await browserPage.waitForSelector(
        '.reusable-search__result-container, .search-results-container',
        { timeout: config.playwright.browserTimeoutMs },
      ).catch(() => {
        logger.warn('Results container not found, page may be empty');
      });

      await randomDelay(
        config.playwright.navDelayMinMs,
        config.playwright.navDelayMaxMs,
      );

      const results = await scrapeResults(browserPage);

      // Check for more pages
      const hasMore = await browserPage.$('.artdeco-pagination__button--next:not([disabled])') !== null;

      // Save updated session state
      await saveContext(userId, ctx);

      logger.info('Search completed', { userId, resultCount: results.length });

      return { results, hasMore };

    } finally {
      await browserPage.close();
    }
  }

  // ─── Clear user session ───────────────────────────────────────────────────

  async clearUserSession(userId: string): Promise<void> {
    const ctx = this.activeSessions.get(userId);
    if (ctx) {
      await ctx.close().catch(() => {});
      this.activeSessions.delete(userId);
    }
    await redisClient.del(keys.browserCtx(userId));
  }
}

// Singleton
export const linkedInAdapter = new PlaywrightLinkedInAdapter();
