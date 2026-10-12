import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately fixed for this experiment, including Denver's UTC-06 offset.
const DATE = '2026-09-30';
const START = Date.parse('2026-09-30T00:00:00-06:00');
const END = Date.parse('2026-10-01T00:00:00-06:00');
const SEED = START + (END - START) / 2;
const GAP_MS = 5000;
const MAX_REQUESTS = 40;
const MAX_SCROLLS = 30;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.env.OUTPUT_DIR || path.join(root, 'openmhz-browser-results'));
const manifest = path.join(root, `public/records/openmhz/openmhz-afpd-car-to-car-${DATE}/calls.json`);
const pageUrl = `https://openmhz.com/system/dcfems?filter-type=talkgroup&filter-code=6001&time=${SEED}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const calls = new Map();
const batches = [];
const issues = [];
const pending = new Set();
let failure;
let requestCount = 0;
let lastRequestAt = 0;
let requestQueue = Promise.resolve();
let blockedAudioRequests = 0;
let browser;
let page;
let comparison;
let closing = false;
const startedAt = new Date().toISOString();
await mkdir(output, { recursive: true });

function isCallList(url) {
  const parsed = new URL(url);
  return parsed.hostname.endsWith('.openmhz.com') && /^\/dcfems\/calls(?:\/|$)/.test(parsed.pathname);
}
function fail(message) { failure ||= message; }
function bounds() {
  const times = [...calls.values()].map(call => Date.parse(call.time));
  return { oldest: Math.min(...times), newest: Math.max(...times) };
}
function check() { if (failure) throw new Error(failure); }
async function checkPage() {
  const title = await page.title();
  const text = await page.locator('body').innerText();
  if (/just a moment|verify you are human|checking your browser|automated traffic|access denied/i.test(`${title}\n${text}`)) {
    fail('The site presented a verification or access-denied page; stopped without attempting to bypass it.');
  }
  check();
}
async function waitUntil(predicate, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    check();
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the page to load another call-list batch.');
    await sleep(250);
  }
  check();
}

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ timezoneId: 'America/Denver', viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  page.setDefaultTimeout(15000);

  // Let the ordinary website construct every request. Only delay its list
  // requests; do not synthesize API requests, import cookies, or spoof headers.
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.resourceType() === 'media' || /\.(m4a|mp3|wav|aac|ogg)(?:[?#]|$)/i.test(request.url())) {
      blockedAudioRequests++;
      return route.abort();
    }
    if (!isCallList(request.url())) return route.continue();
    const next = requestQueue.then(async () => {
      if (failure || closing) return route.abort();
      if (requestCount >= MAX_REQUESTS) {
        fail(`Stopped at the ${MAX_REQUESTS}-request limit.`);
        return route.abort();
      }
      await sleep(Math.max(0, GAP_MS - (Date.now() - lastRequestAt)));
      if (failure || closing) return route.abort();
      lastRequestAt = Date.now();
      requestCount++;
      console.log(`Allowing page call-list request ${requestCount} at ${new Date(lastRequestAt).toISOString()}`);
      await route.continue();
    });
    requestQueue = next.catch(error => fail(error.message));
    await requestQueue;
  });

  page.on('response', response => {
    if (closing) return;
    if (!isCallList(response.url())) return;
    const task = (async () => {
      const entry = { url: response.url(), status: response.status(), receivedAt: new Date().toISOString() };
      batches.push(entry);
      if (!response.ok()) {
        fail(`Call-list response returned HTTP ${response.status()}; stopped without retries.`);
        return;
      }
      const data = await response.json();
      if (!Array.isArray(data.calls)) throw new Error('Unexpected call-list response shape.');
      entry.count = data.calls.length;
      for (const call of data.calls) {
        if (Number(call.talkgroupNum) !== 6001) throw new Error(`Unexpected talkgroup: ${call.talkgroupNum}`);
        if (!call._id || !Number.isFinite(Date.parse(call.time)) || !call.url) throw new Error('Call missing ID, time, or URL.');
        const media = new URL(call.url);
        if (media.protocol !== 'https:' || !media.hostname.endsWith('.openmhz.com')) throw new Error('Unexpected audio URL host/protocol.');
        calls.set(call._id, { id: call._id, time: call.time, talkgroup: 6001, seconds: call.len, url: call.url });
      }
      console.log(`Observed ${entry.count} calls; ${calls.size} unique calls across browser-loaded pages.`);
    })().catch(error => fail(`Unable to read browser response: ${error.message}`));
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  page.on('requestfailed', request => {
    if (closing) return;
    if (isCallList(request.url())) {
      issues.push({ url: request.url(), error: request.failure()?.errorText });
      fail(`The browser's call-list request failed: ${request.failure()?.errorText}`);
    }
  });
  page.on('pageerror', error => issues.push({ pageError: error.message }));

  const navigation = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (navigation && !navigation.ok()) throw new Error(`Page navigation returned HTTP ${navigation.status()}.`);
  await checkPage();
  await waitUntil(() => calls.size > 0);
  await page.locator('#calls tbody tr[data-callid]').first().waitFor();
  const autoplay = page.locator('.button-item.active').filter({ hasText: 'Autoplay' });
  if (await autoplay.count()) await autoplay.click();

  // Newest calls are at the top. Moving away, then to the edge, activates the
  // site's own intersection-observer pagination. Stop only after crossing each
  // Denver midnight; stagnation is failure, never proof of completeness.
  for (const direction of ['older', 'newer']) {
    let completed = false;
    for (let i = 0; i < MAX_SCROLLS; i++) {
      await checkPage();
      const before = bounds();
      if (direction === 'older' ? before.oldest < START : before.newest >= END) {
        completed = true;
        break;
      }
      const oldSize = calls.size;
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
      await sleep(300);
      await page.evaluate(direction => window.scrollTo(0, direction === 'older' ? document.documentElement.scrollHeight : 0), direction);
      await waitUntil(() => calls.size > oldSize);
      await sleep(GAP_MS);
    }
    if (!completed) {
      const current = bounds();
      completed = direction === 'older' ? current.oldest < START : current.newest >= END;
    }
    if (!completed) throw new Error(`Did not reach the ${direction} date boundary within ${MAX_SCROLLS} scrolls.`);
  }
  await Promise.all([...pending]);
  check();
  const selected = [...calls.values()].filter(call => Date.parse(call.time) >= START && Date.parse(call.time) < END);
  const archived = JSON.parse(await readFile(manifest, 'utf8'));
  const expected = new Set(archived.calls.map(call => call.id));
  const found = new Set(selected.map(call => call.id));
  comparison = {
    expected: expected.size, found: found.size,
    missing: [...expected].filter(id => !found.has(id)),
    additional: [...found].filter(id => !expected.has(id)),
    urlMismatches: selected.filter(call => {
      const old = archived.calls.find(row => row.id === call.id);
      return old && old.media_url !== call.url;
    }).map(call => call.id),
  };
  if (comparison.missing.length || comparison.additional.length || comparison.urlMismatches.length) {
    throw new Error('Browser inventory differs from the existing archive; inspect comparison in summary.json.');
  }
} catch (error) {
  fail(error.message);
  console.error(failure);
} finally {
  closing = true;
  if (page) {
    await page.screenshot({ path: path.join(output, 'page.png') }).catch(() => {});
    await writeFile(path.join(output, 'page.html'), await page.content().catch(() => '')).catch(() => {});
  }
  if (browser) await browser.close();
  await Promise.allSettled([...pending]);
  const selected = [...calls.values()].filter(call => Date.parse(call.time) >= START && Date.parse(call.time) < END).sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.id.localeCompare(b.id));
  const observed = bounds();
  const summary = {
    date: DATE, timezone: 'America/Denver', system: 'dcfems', talkgroup: 6001,
    pageUrl, startedAt, finishedAt: new Date().toISOString(),
    status: failure ? 'failed' : 'passed', error: failure || null,
    count: selected.length, requestCount, minimumRequestGapMs: GAP_MS,
    olderBoundaryReached: observed.oldest < START,
    newerBoundaryReached: observed.newest >= END,
    blockedAudioRequests, audioDownloaded: false, comparison, issues,
  };
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  await writeFile(path.join(output, 'calls.json'), JSON.stringify({ date: DATE, timezone: 'America/Denver', calls: selected }, null, 2) + '\n');
  await writeFile(path.join(output, 'urls.txt'), selected.map(call => call.url).join('\n') + '\n');
  await writeFile(path.join(output, 'browser-batches.json'), JSON.stringify(batches, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## OpenMHz browser URL test\n\n- Date: ${DATE} (America/Denver)\n- Talkgroup: 6001\n- Result: **${summary.status}**\n- URLs: ${selected.length}\n- Both date boundaries reached: ${summary.olderBoundaryReached && summary.newerBoundaryReached}\n- Page call-list requests: ${requestCount}, spaced at least five seconds apart\n- Audio downloaded: no\n${failure ? `- Error: ${failure}\n` : '- Archived IDs and URLs match exactly.\n'}\nSee the uploaded artifact for URLs, metadata, screenshot, and diagnostics.\n`);
  }
}
if (failure) process.exitCode = 1;
