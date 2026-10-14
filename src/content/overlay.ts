import type { Segment } from '../shared/types';

const STYLE = `
  .frame {
    position: fixed;
    pointer-events: none;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .caption {
    position: absolute;
    left: 50%;
    bottom: 12%;
    transform: translateX(-50%);
    max-width: 90%;
    width: max-content;
    padding: 0.25em 0.6em;
    border-radius: 0.3em;
    background: rgba(8, 8, 8, 0.78);
    color: #fff;
    line-height: 1.35;
    text-align: center;
    pointer-events: auto;
    user-select: text;
    cursor: text;
  }
  .caption:empty { display: none; }
  .w { transition: color 80ms; }
  .w.tentative { color: rgba(255, 255, 255, 0.6); }
  .w.active { color: #ffd54a; }
  .status {
    position: absolute;
    top: 12px;
    left: 12px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(8, 8, 8, 0.78);
    color: #fff;
    font-size: 13px;
  }
  .status:empty { display: none; }
  .status.error {
    background: rgba(160, 20, 20, 0.92);
    max-width: 70%;
    border-radius: 8px;
  }
`;

/** Caption box drawn over a video element, in a closed shadow root so page CSS can't touch it. */
export class Overlay {
  private readonly host: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly caption: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private renderedKey = '';
  private layoutKey = '';
  private statusTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly video: HTMLVideoElement) {
    this.host = document.createElement('div');
    this.host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.frame = document.createElement('div');
    this.frame.className = 'frame';
    this.caption = document.createElement('div');
    this.caption.className = 'caption';
    this.status = document.createElement('div');
    this.status.className = 'status';
    this.frame.append(this.status, this.caption);
    shadow.append(style, this.frame);

    this.mount();
    document.addEventListener('fullscreenchange', this.mount);
  }

  /** In fullscreen only the fullscreen element's subtree is visible, so move there. */
  private readonly mount = () => {
    const fullscreen = document.fullscreenElement;
    const parent = fullscreen?.contains(this.video) ? fullscreen : document.body;
    if (this.host.parentNode !== parent) parent.appendChild(this.host);
  };

  /** Keep the frame on top of the video. Cheap when nothing moved. */
  layout(): void {
    const r = this.video.getBoundingClientRect();
    const key = `${r.left},${r.top},${r.width},${r.height}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    Object.assign(this.frame.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    this.caption.style.fontSize = `${Math.max(16, Math.min(44, r.height * 0.045))}px`;
  }

  showSegment(segment: Segment | undefined, t: number): void {
    const activeIndex = segment?.words?.findIndex((w) => w.start <= t && t < w.end) ?? -1;
    const key = segment ? `${segment.id}|${segment.text}|${segment.final}|${activeIndex}` : '';
    if (key === this.renderedKey) return;
    this.renderedKey = key;

    if (!segment) {
      this.caption.replaceChildren();
      return;
    }
    if (!segment.words?.length) {
      this.caption.textContent = segment.text;
      return;
    }
    const nodes: Node[] = [];
    segment.words.forEach((word, i) => {
      if (i > 0) nodes.push(document.createTextNode(' '));
      const span = document.createElement('span');
      span.className = 'w';
      if (word.tentative) span.classList.add('tentative');
      if (i === activeIndex) span.classList.add('active');
      span.textContent = word.text;
      nodes.push(span);
    });
    this.caption.replaceChildren(...nodes);
  }

  /** Errors stay until cleared; other messages fade after `hideAfterMs`. */
  setStatus(text: string, kind: 'info' | 'error' = 'info', hideAfterMs?: number): void {
    clearTimeout(this.statusTimer);
    this.status.textContent = text;
    this.status.classList.toggle('error', kind === 'error');
    if (hideAfterMs) this.statusTimer = setTimeout(() => (this.status.textContent = ''), hideAfterMs);
  }

  destroy(): void {
    clearTimeout(this.statusTimer);
    document.removeEventListener('fullscreenchange', this.mount);
    this.host.remove();
  }
}
