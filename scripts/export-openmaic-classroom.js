const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

function stripHtml(html = '') {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getFontSizeFromHtml(html = '', fallback = 18) {
  const m = html.match(/font-size\s*:\s*(\d+)px/i);
  if (!m) return fallback;
  const px = Number(m[1]);
  return Math.max(10, Math.round(px * 0.75));
}

function getColorFromHtml(html = '', fallback = '111111') {
  const m = html.match(/color\s*:\s*(#[0-9a-fA-F]{6})/i);
  return m ? m[1].replace('#', '') : fallback;
}

async function main() {
  const classroomId = process.argv[2] || 's2X7lWZZTI';
  const outDir = process.argv[3] || path.join(process.cwd(), 'exports');
  const apiUrl = `http://127.0.0.1:3000/api/classroom?id=${encodeURIComponent(classroomId)}`;

  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} when fetching classroom`);
  const data = await res.json();
  const classroom = data.classroom;
  if (!classroom || !Array.isArray(classroom.scenes)) {
    throw new Error('Invalid classroom payload');
  }

  fs.mkdirSync(outDir, { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = '阿乐';
  pptx.company = 'OpenClaw';
  pptx.subject = classroom.stage?.name || classroomId;
  pptx.title = classroom.stage?.name || classroomId;
  pptx.lang = 'zh-CN';

  for (const scene of classroom.scenes.sort((a, b) => (a.order || 0) - (b.order || 0))) {
    const slide = pptx.addSlide();
    const canvas = scene?.content?.canvas;
    const viewportW = Number(canvas?.viewportSize || 1000);
    const viewportH = Math.round(viewportW * Number(canvas?.viewportRatio || 0.5625));
    const xRatio = 13.333 / viewportW;
    const yRatio = 7.5 / viewportH;

    const bg = canvas?.background?.color || canvas?.theme?.backgroundColor || '#FFFFFF';
    slide.background = { color: String(bg).replace('#', '') };

    const elements = Array.isArray(canvas?.elements) ? canvas.elements.slice() : [];
    elements.sort((a, b) => (a.top - b.top) || (a.left - b.left));

    for (const el of elements) {
      if (el.type === 'shape') {
        const fill = String(el.fill || '').replace('#', '') || 'FFFFFF';
        slide.addShape('rect', {
          x: Number(el.left || 0) * xRatio,
          y: Number(el.top || 0) * yRatio,
          w: Number(el.width || 10) * xRatio,
          h: Number(el.height || 10) * yRatio,
          line: { color: fill, transparency: 100 },
          fill: { color: fill, transparency: 0 },
        });
      } else if (el.type === 'text') {
        const text = stripHtml(el.content || '');
        if (!text) continue;
        slide.addText(text, {
          x: Number(el.left || 0) * xRatio,
          y: Number(el.top || 0) * yRatio,
          w: Number(el.width || 100) * xRatio,
          h: Number(el.height || 30) * yRatio,
          fontFace: el.defaultFontName || 'Microsoft YaHei',
          fontSize: getFontSizeFromHtml(el.content || '', 18),
          color: getColorFromHtml(el.content || '', String(el.defaultColor || '#111111').replace('#', '')),
          margin: 0.03,
          valign: 'mid',
          fit: 'shrink',
          bold: /<strong>/i.test(el.content || ''),
          breakLine: false,
        });
      }
    }
  }

  const safeName = String(classroom.stage?.name || classroomId).replace(/[\\/:*?"<>|]/g, '_');
  const outFile = path.join(outDir, `${safeName}.pptx`);
  await pptx.writeFile({ fileName: outFile });
  console.log(JSON.stringify({ success: true, classroomId, outFile }, null, 2));
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
