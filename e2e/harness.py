"""Drive Firefox with the captions extension loaded (from dist/).

Starts captions on a page, samples what's on screen, and saves screenshots.
Sets debug mode, so the latency readout is printed too.

  e2e/.venv/bin/python e2e/harness.py                      # local test video, test-signal provider
  e2e/.venv/bin/python e2e/harness.py --url URL --provider deepgram --lang en --seconds 30
  e2e/.venv/bin/python e2e/harness.py --provider local-server --lang fr   # start ./server/run.sh first

DEEPGRAM_API_KEY is read from the environment or e2e/.env.
"""
import argparse
import functools
import http.server
import json
import os
import threading
import time

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, '..', 'dist')
SITE = os.path.join(HERE, 'site')
SHOTS = os.path.join(HERE, 'shots')
ADDON_ID = 'captions@zerathul.local'
# Pinned so the harness can open extension pages at a known moz-extension:// URL.
ADDON_UUID = '4b7c2a1e-0d3f-4e5a-9c8b-1f2e3d4c5b6a'
PORT = 8765
LOCAL_URL = f'http://127.0.0.1:{PORT}/index.html'


def load_env():
    path = os.path.join(HERE, '.env')
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            key, sep, value = line.strip().partition('=')
            if sep and not key.startswith('#'):
                os.environ.setdefault(key.strip(), value.strip().strip('"\''))


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=SITE))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def launch(headless=True):
    opts = Options()
    if headless:
        opts.add_argument('-headless')
    opts.enable_bidi = True
    opts.set_preference('media.autoplay.default', 0)
    opts.set_preference('media.autoplay.blocking_policy', 0)
    opts.set_preference('extensions.webextensions.uuids', json.dumps({ADDON_ID: ADDON_UUID}))
    # System access lets toggle() reach the extension's command handler from browser chrome.
    driver = webdriver.Firefox(options=opts, service=Service(service_args=['--allow-system-access']))
    driver.set_window_size(1400, 900)
    logs = []
    driver.script.add_console_message_handler(lambda m: logs.append(f'[console.{m.level}] {m.text}'))
    driver.script.add_javascript_error_handler(lambda m: logs.append(f'[js-error] {m.text}'))
    driver.install_addon(os.path.abspath(DIST), temporary=True)
    return driver, logs


def set_settings(driver, settings):
    """Write extension settings from an extension page, which has storage access."""
    main = driver.current_window_handle
    driver.switch_to.new_window('tab')
    driver.get(f'moz-extension://{ADDON_UUID}/options.html')
    driver.execute_async_script(
        'const [s, done] = arguments; browser.storage.local.set({settings: s}).then(done);', settings)
    driver.close()
    driver.switch_to.window(main)


def toggle(driver):
    """Same as pressing Alt+Shift+C."""
    with driver.context(driver.CONTEXT_CHROME):
        driver.execute_script('''
            const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
            ExtensionParent.GlobalManager.getExtension(arguments[0]).shortcuts.onCommand("toggle-captions");
        ''', ADDON_ID)


def read_state(driver):
    return driver.execute_script('''
        const v = document.querySelector("video");
        const d = document.documentElement.dataset;
        return {t: v ? v.currentTime : null, paused: v ? v.paused : null,
                lag: d.captionsLag || null, text: d.captionsText || ""};
    ''')


def main():
    load_env()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--url', default=LOCAL_URL)
    parser.add_argument('--provider', default='test-signal')
    parser.add_argument('--lang', default='fr')
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--start-at', type=float, help='seek the video here before starting (for YouTube, prefer &t= in the URL)')
    parser.add_argument('--options', default='{}', help='provider options as JSON, e.g. \'{"model":"nova-2"}\'')
    parser.add_argument('--shot-every', type=float, default=5, help='screenshot interval in seconds (0 = none)')
    parser.add_argument('--audio-source', default='auto', choices=['auto', 'page', 'tab', 'system'],
                        help='tab/system record through the companion (run companion/install.sh first)')
    parser.add_argument('--headed', action='store_true')
    args = parser.parse_args()

    provider_options = json.loads(args.options)
    if args.provider == 'deepgram':
        provider_options.setdefault('apiKey', os.environ.get('DEEPGRAM_API_KEY', ''))
        if not provider_options['apiKey']:
            parser.error('set DEEPGRAM_API_KEY (environment or e2e/.env)')

    os.makedirs(SHOTS, exist_ok=True)
    serve()
    driver, logs = launch(headless=not args.headed)
    try:
        set_settings(driver, {'provider': args.provider, 'language': args.lang, 'debug': True,
                              'audioSource': args.audio_source,
                              'providerOptions': {args.provider: provider_options}})
        driver.get(args.url)
        time.sleep(3)
        driver.execute_script('''
            const v = document.querySelector("video");
            if (!v) return;
            if (arguments[0] !== null) v.currentTime = arguments[0];
            v.play().catch(e => console.log("play failed: " + e));
        ''', args.start_at)
        time.sleep(1)
        toggle(driver)

        start = time.time()
        next_shot = args.shot_every
        shots = 0
        last_text = None
        while (elapsed := time.time() - start) < args.seconds:
            state = read_state(driver)
            if state['text'] != last_text:
                last_text = state['text']
                print(f'{elapsed:5.1f}s  t={state["t"]:.1f}  lag={state["lag"]}  | {state["text"]}')
            if args.shot_every and elapsed >= next_shot:
                path = os.path.join(SHOTS, f'shot-{shots}.png')
                driver.save_screenshot(path)
                shots += 1
                next_shot += args.shot_every
            time.sleep(0.2)
        state = read_state(driver)
        print(f'\nfinal median lag: {state["lag"]} s at t={state["t"]:.1f}' + (f', {shots} screenshots in {SHOTS}' if shots else ''))
    finally:
        relevant = [line for line in logs if 'captions' in line.lower()]
        if relevant:
            print('\n'.join(relevant[-30:]))
        driver.quit()


if __name__ == '__main__':
    main()
