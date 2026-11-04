// Attach to the Pi's existing Chromium profile unless explicitly asked to launch.
const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
async function openSession(chromium, args, zone) {
  const attached = !args['launch-browser'];
  if (attached && (args.proxy || args['executable-path'] || args['ignore-https-errors'])) {
    throw Error('--proxy, --executable-path and --ignore-https-errors require --launch-browser; attached Chromium uses its existing settings');
  }
  let browser, page;
  try {
    if (attached) {
      const endpoint = String(args['cdp-url'] || DEFAULT_CDP_URL);
      try { browser = await chromium.connectOverCDP(endpoint); }
      catch (e) { throw Error(`Cannot attach to Chromium at ${endpoint}. Start Chromium with --remote-debugging-port=9222 and a separate --user-data-dir, or use --launch-browser. ${e.message}`); }
    } else {
      if (args['cdp-url']) throw Error('Use either --cdp-url or --launch-browser');
      browser = await chromium.launch({headless:!args.headed,...(args.proxy?{proxy:{server:String(args.proxy)}}:{}),...(args['executable-path']?{executablePath:String(args['executable-path'])}:{})});
    }
    const context = attached ? browser.contexts()[0] : await browser.newContext({ignoreHTTPSErrors:!!args['ignore-https-errors'],timezoneId:zone,viewport:{width:1280,height:800}});
    if (!context) throw Error('Attached Chromium has no existing browser context');
    page = await context.newPage();
    return {page, attached, visible:attached || !!args.headed,
      async close() {
        // Never close the shared context. CDP browser.close() disconnects the client.
        try { if (!page.isClosed()) await page.close(); }
        finally { await browser.close(); }
      },
    };
  } catch (e) { if (browser) await browser.close(); throw e; }
}
module.exports = {DEFAULT_CDP_URL, openSession};
