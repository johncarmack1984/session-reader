import { renderMarkdown } from './utils.ts';

export interface MemoryFrontmatter {
  name?: string;
  description?: string;
  metadata?: {
    type?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ParsedMemory {
  frontmatter: MemoryFrontmatter;
  body: string;
}

export function parseMemory(text: string): ParsedMemory {
  const fm: MemoryFrontmatter = {};
  let body = text;

  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      const yaml = text.slice(4, end).trim();
      body = text.slice(end + 4).trim();
      for (const line of yaml.split('\n')) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const key = line.slice(0, colon).trim();
        const val = line.slice(colon + 1).trim();
        if (key === 'metadata') {
          fm.metadata = {};
          continue;
        }
        if (line.startsWith('  ') && fm.metadata) {
          const innerKey = key;
          fm.metadata[innerKey] = val;
        } else {
          fm[key] = val;
        }
      }
    }
  }

  return { frontmatter: fm, body };
}

export function renderMemory(parsed: ParsedMemory, container: HTMLElement): void {
  container.innerHTML = '';

  const fm = parsed.frontmatter;
  if (fm.name || fm.description || fm.metadata?.type) {
    const header = document.createElement('div');
    header.className = 'memory-header';

    if (fm.name) {
      const name = document.createElement('h2');
      name.className = 'memory-name';
      name.textContent = fm.name as string;
      header.appendChild(name);
    }

    const tags = document.createElement('div');
    tags.className = 'memory-tags';
    if (fm.metadata?.type) {
      const tag = document.createElement('span');
      tag.className = 'memory-tag memory-tag--type';
      tag.textContent = fm.metadata.type as string;
      tags.appendChild(tag);
    }
    if (tags.children.length > 0) header.appendChild(tags);

    if (fm.description) {
      const desc = document.createElement('p');
      desc.className = 'memory-description';
      desc.textContent = fm.description as string;
      header.appendChild(desc);
    }

    container.appendChild(header);
  }

  const bodyEl = document.createElement('div');
  bodyEl.className = 'memory-body entry__content';
  bodyEl.innerHTML = renderMarkdown(parsed.body);
  container.appendChild(bodyEl);
}
