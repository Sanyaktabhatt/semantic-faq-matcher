// Builds the project report as report.docx and report.html (printed to PDF by Chrome) from one content model.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, PageBreak, Footer, PageNumber, LevelFormat, TabStopType,
} = require('docx');

const DIR = __dirname;
const SHOTS = path.join(DIR, 'shots');

// ---------------------------------------------------------------- content
const P = (text) => ({ t: 'p', text });
const B = (items) => ({ t: 'bullets', items });
const H1 = (text, newPage = true) => ({ t: 'h1', text, newPage });
const H2 = (text) => ({ t: 'h2', text });
const TABLE = (head, rows, widths) => ({ t: 'table', head, rows, widths });
const CODE = (lines) => ({ t: 'code', lines });
const FIG = (file, caption, intro, maxH) => ({ t: 'fig', file, caption, intro, maxH });

const content = [
  H1('1. Title', false),
  { t: 'lead', text: 'Semantic FAQ Matcher: answering customer-support questions by meaning, not keywords' },
  P('Problem statement 47 (Model Making) asks for a system that matches a user’s question to the most relevant entry in a set of Frequently Asked Questions (FAQs) and returns its answer. The recommended tools are Python and sentence-transformers. The specified steps are: embed the FAQ questions; embed a user query and retrieve the closest FAQ; return the matched answer; handle no-good-match cases; evaluate match accuracy; and present the matcher.'),
  P('This project delivers that as a working web application for an e-commerce customer-support FAQ set. A customer can type a question in their own words, such as “my parcel never showed up”. The system finds the FAQ with the same meaning, returns its answer and explains why it matched. It refuses to answer questions it cannot match confidently.'),

  H1('2. Objective', false),
  P('The main objective is to build and evaluate a semantic FAQ-matching model that returns the correct answer for differently worded questions, rejects questions it cannot answer, and is demonstrated through an interactive application.'),
  H2('Specific objectives'),
  B([
    'Convert every FAQ question, and several alternative phrasings of it, into sentence embeddings using the all-MiniLM-L6-v2 sentence-transformer.',
    'Embed each user query with the same model and retrieve the closest FAQ by cosine similarity, combined with a BM25 keyword score.',
    'Return the stored answer of the matched FAQ verbatim, so the system never invents an answer.',
    'Handle no-good-match cases with a similarity threshold, “Did you mean…” suggestions and an out-of-scope message.',
    'Measure accuracy (top-1, top-3, correct after threshold, rejection rate) on labelled test questions, including an independently written held-out set.',
    'Present the matcher in a web interface with search, explanations, a semantic map, usage insights and an evaluation dashboard.',
  ]),
  H2('Scope'),
  P('The knowledge base has 242 FAQs in 21 categories covering orders, delivery, returns, refunds, payments, accounts, products, support, security, gift cards, membership, warranty, rewards, the mobile app, device setup, installation, pre-orders, subscriptions and accessibility. The system answers in English and runs entirely on a local CPU without any paid API.'),

  H1('3. Design Principles'),
  B([
    'Meaning over keywords. People describe the same problem in different words. Matching uses sentence embeddings, so “is there a larger option of this shirt” finds “Is this product available in another size?” even though the two share no keywords.',
    'Answers come only from the curated dataset. The system retrieves; it does not generate. Every answer is copied verbatim from the FAQ file, so it cannot hallucinate policies or facts.',
    'Fail safely. If the best score is below the threshold (0.45), no answer is forced. The user sees the closest FAQs as suggestions, or an out-of-scope message for unrelated questions.',
    'Explainability. Each answer shows its source FAQ, a confidence level, the phrasing that matched, the shared words and how much of the score came from meaning versus keywords.',
    'Honest measurement. Parameters were chosen on the supplied test sets only. A separate 484-question held-out set, written from the FAQ list alone without seeing the phrasings, is used only to report results.',
    'Lightweight and local. A 22.7-million-parameter model runs on CPU at about 10 ms per question. No GPU, internet service or API key is needed after the first model download.',
    'Modularity. Data loading (repository), matching (matcher), evaluation (evaluator), the REST API and the user interface are separate components with clear interfaces, so each can be changed or tested independently.',
    'Continuous improvement. Confirmed answers teach the matcher new phrasings without retraining. Unanswered questions are logged as knowledge gaps that show which FAQs to add next.',
  ]),
  H2('Why not plain keyword search?'),
  P('On the 484 held-out questions, keyword search alone (BM25) ranks the correct FAQ first 72.3% of the time. Semantic matching alone reaches 86.8%, and the hybrid used in this project reaches 88.0%. Keywords still help slightly as a tie-breaker, which is why they keep a 15% weight.'),

  H1('4. Technical Model Details', false),
  H2('4.1 Technology stack'),
  TABLE(['Component', 'Technology'], [
    ['Model and ranking', 'all-MiniLM-L6-v2 (sentence-transformers, PyTorch); BM25 Okapi (rank_bm25); NumPy, pandas'],
    ['Backend API', 'Python 3, FastAPI, Uvicorn, Pydantic'],
    ['Frontend', 'React 19, TypeScript, Vite, Recharts, Zod'],
    ['Testing', 'Python unittest (22 tests), httpx, end-to-end verification script'],
  ], [2400, 7238]),
  H2('4.2 Embedding model'),
  P('all-MiniLM-L6-v2 is a 6-layer MiniLM transformer with about 22.7 million parameters. It was trained with a contrastive objective on more than one billion sentence pairs. It maps a sentence to a 384-dimensional vector by mean pooling over token embeddings, so sentences with similar meanings get nearby vectors. All vectors are L2-normalised, so cosine similarity is a dot product. The 968 FAQ phrasings form a 968 × 384 matrix that is computed once at startup. Each query needs a single encoding and one matrix–vector product.'),
  H2('4.3 Dataset'),
  TABLE(['Data', 'Size', 'Purpose'], [
    ['FAQ dataset', '242 FAQs, 21 categories', 'Questions and verbatim answers'],
    ['Alternate phrasings', '726 (3 per FAQ); 968 indexed in total', 'Extra wordings of each FAQ for matching'],
    ['Original + additional tests', '20 + 106 labelled', 'Development set: choosing settings'],
    ['Held-out test set', '484 labelled (2 per FAQ)', 'Final reporting only'],
    ['Unrelated questions', '20 + 40', 'Measuring rejection of out-of-scope questions'],
  ], [3000, 2900, 3738]),
  H2('4.4 Matching algorithm'),
  P('For a query q and an FAQ f with phrasings p:'),
  CODE([
    'semantic(q, f) = max over p in f of  cos( embed(q), embed(p) )',
    'bm25(q, f)     = BM25 of q against all phrasings of f as one document',
    'keyword(q, f)  = bm25 / (bm25 + 10)          scaled to [0, 1)',
    'score(q, f)    = 0.85 × semantic + 0.15 × keyword',
    'answer         = top-scoring FAQ if its score ≥ 0.45, otherwise no match',
  ]),
  H2('4.5 Decision rules'),
  TABLE(['Rule', 'Value', 'Effect'], [
    ['Acceptance threshold', 'score ≥ 0.45', 'Answer is returned; otherwise suggestions are shown'],
    ['High confidence', 'score ≥ 0.70', 'Labelled “Strong match”'],
    ['Ambiguity', 'top two within 0.04', 'The second FAQ is shown as “Also close”'],
    ['Out of scope', 'best score < 0.75 × threshold', 'Polite out-of-scope message, no suggestions'],
    ['Category prediction', 'category of top-ranked FAQ', 'Shown with every answer; 94.4% accurate on held-out'],
    ['Learning', 'user confirms an answer', 'Query embedded and added as a new phrasing'],
  ], [2500, 2900, 4238]),
  H2('4.6 Results'),
  TABLE(['Final model (threshold 0.45)', 'Top-1', 'Top-3', 'Correct after threshold'], [
    ['Original test set (20)', '90.0%', '95.0%', '90.0%'],
    ['Additional test set (106)', '90.6%', '97.2%', '90.6%'],
    ['Held-out test set (484)', '88.0%', '97.3%', '85.7%'],
  ], [3638, 1800, 1800, 2400]),
  P('Unrelated questions are rejected 100% of the time on the supplied set (20) and 85.0% on the harder held-out set (40). The methods compare as follows on the same questions:'),
  TABLE(['Method', 'Held-out top-1', 'Held-out top-3', 'Unrelated rejected (60)'], [
    ['Keyword search only (BM25)', '72.3%', '82.9%', 'n/a'],
    ['Semantic only (cosine)', '86.8%', '96.7%', '86.7%'],
    ['Semantic + token overlap', '88.0%', '97.3%', '88.3%'],
    ['Semantic + BM25 (final)', '88.0%', '97.3%', '90.0%'],
  ], [3638, 2000, 2000, 2000]),
  P('Compared with the original notebook version (98 FAQs, one phrasing each), top-1 accuracy rose from 73.7% to 90.0% on the original test set and from 81.1% to 90.6% on the additional set.'),

  H1('5. Block Diagram'),
  FIG('block.png', 'Figure 1: Block diagram of the Semantic FAQ Matcher', null, 360),
  B([
    'User: types a question in the browser, optionally limits it to a category, and can give feedback on the answer.',
    'Presentation layer: a React single-page application with six pages (Search, FAQ dataset, Semantic map, Insights, Evaluation, Method).',
    'Application layer: a FastAPI server exposes REST endpoints that validate requests and call the matching engine.',
    'Matching engine: encodes the query, compares it with every phrasing, combines semantic and BM25 scores, ranks the FAQs and decides whether to answer, suggest or reject. Supporting modules predict the category, learn from feedback, log usage and evaluate accuracy.',
    'Data layer: CSV files hold the FAQs, the alternate phrasings, phrasings learned from feedback, and the test sets.',
  ]),

  H1('6. Flowchart'),
  FIG('flow.png', 'Figure 2: Flowchart of answering a question', null, 600),
  P('The question is validated, embedded and scored against every FAQ. A confident match is answered. A near miss gets “Did you mean…” suggestions, and an unrelated question gets an out-of-scope message. When the user confirms an answer or picks a suggestion, their wording is learned as a new phrasing.'),

  H1('7. Screenshots of the Working Model'),
  P('The screenshots below show the working model step by step, in the order a user would use it. Zoom in on the PDF for full detail.'),
  { t: 'grid', items: [
    ['01_api_docs.png', 'Step 1 – Start the model server. FastAPI loads all-MiniLM-L6-v2, embeds the 968 phrasings and builds the BM25 index; its API documentation lists every endpoint.'],
    ['02_search_home.png', 'Step 2 – Open the application. The Search page has a question box, a category selector and example questions.'],
    ['04_answer.png', 'Step 3 – Ask a question. “how do I return a damaged item” is matched to SUP008 “How do I report a damaged item?” as a strong match, with its predicted category.'],
    ['05_match_details.png', 'Step 4 – Match details. The closest phrasing, shared words and the top three candidates, with the meaning (green) and keyword (amber) parts of each score.'],
    ['07_did_you_mean.png', 'Step 5 – Vague question. “question about my stuff” scores 0.37, below the 0.45 threshold, so the three closest FAQs are offered as “Did you mean…”.'],
    ['08_out_of_scope.png', 'Step 6 – Unrelated question. “what is the capital of France” scores 0.18 and is rejected as out of scope.'],
    ['09_category_filter.png', 'Step 7 – Category filter. “when will my parcel arrive” searched only in Payments finds nothing; the predicted category, Delivery, shows where the answer is.'],
    ['10_feedback_learned.png', 'Step 8 – Learning from feedback. Marking the answer helpful saves the user’s wording as a new phrasing of that FAQ, with no retraining.'],
    ['13_semantic_map.png', 'Step 9 – Semantic map. All 242 FAQ embeddings in two dimensions; “the app keeps crashing” lands beside the Mobile App FAQs.'],
    ['14_insights.png', 'Step 10 – Insights. Session statistics, unanswered questions (knowledge gaps) and the most similar FAQ pairs.'],
    ['15_evaluation.png', 'Step 11 – Evaluation. 88.0% top-1 and 97.3% top-3 on the 484 held-out questions; 100% rejection of the supplied unrelated questions.'],
    ['16_compare_methods.png', 'Step 12 – Method comparison. Keyword search only, semantic only and the two hybrids on the same questions, plus category-prediction accuracy.']
  ] },

  H1('8. Conclusion'),
  P('The Semantic FAQ Matcher meets all six steps of problem statement 47. FAQ questions and their alternate phrasings are embedded with a sentence-transformer. Queries are matched by cosine similarity combined with BM25. Answers are returned verbatim, and weak or unrelated matches are rejected with suggestions or an out-of-scope message. Accuracy is measured on 610 labelled and 60 unrelated test questions, and the matcher is presented as a complete web application.'),
  P('The hybrid model ranks the correct FAQ first for 88.0% of independently written held-out questions, and within the top three for 97.3%. That is about 15 points better than keyword search alone. Learning from feedback and knowledge-gap logging let the system improve with use, without retraining.'),
  H2('Limitations and future work'),
  B([
    'English only; a multilingual model (for example paraphrase-multilingual-MiniLM) would support other languages.',
    'The threshold was chosen on test data; it should be re-validated on real user questions.',
    'Very similar FAQs (such as “raise a complaint” and “escalate a complaint”) remain the main source of errors; merging them or adding more distinct phrasings would help.',
    'A cross-encoder re-ranker could improve the ordering of the top candidates at a small cost in speed.',
  ]),
  H2('References'),
  B([
    'N. Reimers and I. Gurevych, “Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks,” EMNLP 2019.',
    'W. Wang et al., “MiniLM: Deep Self-Attention Distillation for Task-Agnostic Compression of Pre-Trained Transformers,” NeurIPS 2020.',
    'S. Robertson and H. Zaragoza, “The Probabilistic Relevance Framework: BM25 and Beyond,” Foundations and Trends in Information Retrieval, 2009.',
    'Sentence Transformers documentation, sbert.net; model card for sentence-transformers/all-MiniLM-L6-v2, huggingface.co.',
    'FastAPI documentation, fastapi.tiangolo.com; React documentation, react.dev.',
  ]),
];

const titlePage = {
  kicker: 'A Project Report on',
  title: 'SEMANTIC FAQ MATCHER',
  subtitle: 'Answering customer-support questions by meaning using sentence-transformers',
  ps: 'Problem Statement 47 · Model Making',
  submittedBy: ['[Student Name] – [Roll Number]', '[Team member name] – [Roll Number]'],
  guide: '[Guide Name], [Designation]',
  dept: '[Department Name]',
  college: '[College / University Name]',
  year: 'Academic Year 2026–27 · November 2026',
};

// ---------------------------------------------------------------- helpers
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const FONT = 'Arial';
const GREEN = '147D58';

// ---------------------------------------------------------------- DOCX
const CONTENT_W = 9638; // A4 (11906) minus 2 × 1134 twips margins
const MAX_IMG_PX = 620;

function docxBlocks() {
  const out = [];
  let first = true;
  for (const b of content) {
    if (b.t === 'h1') {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: b.newPage && !first, children: [new TextRun(b.text)] }));
      first = false;
    } else if (b.t === 'h2') {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.text)] }));
    } else if (b.t === 'lead') {
      out.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: b.text, bold: true, size: 26, color: GREEN, font: FONT })] }));
    } else if (b.t === 'p') {
      out.push(new Paragraph({ style: 'Body', children: [new TextRun(b.text)] }));
    } else if (b.t === 'bullets') {
      for (const item of b.items) {
        const cut = item.indexOf('. ');
        const lead = cut > 0 && cut < 50 ? item.slice(0, cut + 1) : null;
        const children = lead && /^[A-Z][a-z]/.test(item) && !item.startsWith('N. ') && !item.startsWith('W. ') && !item.startsWith('S. ')
          ? [new TextRun({ text: lead + ' ', bold: true }), new TextRun(item.slice(cut + 2))]
          : [new TextRun(item)];
        out.push(new Paragraph({ style: 'Body', numbering: { reference: 'bullets', level: 0 }, spacing: { after: 80 }, children }));
      }
    } else if (b.t === 'code') {
      out.push(new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: 'F2F5F3', color: 'auto' },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: GREEN, space: 8 } },
        spacing: { before: 60, after: 160 }, indent: { left: 200 },
        children: b.lines.flatMap((line, i) => [...(i ? [new TextRun({ break: 1 })] : []), new TextRun({ text: line, font: 'Courier New', size: 18 })]),
      }));
    } else if (b.t === 'table') {
      const border = { style: BorderStyle.SINGLE, size: 4, color: 'C9D3CD' };
      const borders = { top: border, bottom: border, left: border, right: border };
      const cell = (text, i, head) => new TableCell({
        width: { size: b.widths[i], type: WidthType.DXA }, borders,
        shading: head ? { type: ShadingType.CLEAR, fill: 'E3F1E9', color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text, bold: head, size: 20, font: FONT })] })],
      });
      out.push(new Table({
        width: { size: b.widths.reduce((a, c) => a + c, 0), type: WidthType.DXA }, columnWidths: b.widths,
        rows: [new TableRow({ tableHeader: true, children: b.head.map((h, i) => cell(h, i, true)) }),
          ...b.rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) }))],
      }));
      out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    } else if (b.t === 'grid') {
      const colW = Math.floor(CONTENT_W / 2);
      const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
      const borders = { top: none, bottom: none, left: none, right: none };
      const cellFor = ([file, caption]) => {
        const { w, h } = pngSize(path.join(SHOTS, file));
        const width = 300, height = Math.round(300 * h / w);
        return new TableCell({ width: { size: colW, type: WidthType.DXA }, borders, margins: { top: 60, bottom: 120, left: 80, right: 80 }, children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: fs.readFileSync(path.join(SHOTS, file)), transformation: { width, height }, altText: { title: caption, description: caption, name: file } })] }),
          new Paragraph({ style: 'Caption', spacing: { before: 60, after: 60 }, children: [new TextRun({ text: caption, size: 17 })] }),
        ] });
      };
      const rows = [];
      for (let i = 0; i < b.items.length; i += 2) rows.push(new TableRow({ cantSplit: true, children: [cellFor(b.items[i]), b.items[i + 1] ? cellFor(b.items[i + 1]) : new TableCell({ width: { size: colW, type: WidthType.DXA }, borders, children: [new Paragraph('')] })] }));
      out.push(new Table({ width: { size: colW * 2, type: WidthType.DXA }, columnWidths: [colW, colW], rows }));
    } else if (b.t === 'fig') {
      if (b.intro) out.push(new Paragraph({ style: 'Body', keepNext: true, spacing: { before: 160, after: 80 }, children: [new TextRun(b.intro)] }));
      const { w, h } = pngSize(path.join(b.file.includes('.png') && fs.existsSync(path.join(SHOTS, b.file)) ? SHOTS : DIR, b.file));
      let width = MAX_IMG_PX, height = Math.round(width * h / w);
      const maxH = b.maxH ? Math.round(b.maxH * 1.12) : 400;
      if (height > maxH) { height = maxH; width = Math.round(height * w / h); }
      const file = fs.existsSync(path.join(SHOTS, b.file)) ? path.join(SHOTS, b.file) : path.join(DIR, b.file);
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, children: [new ImageRun({ type: 'png', data: fs.readFileSync(file), transformation: { width, height }, altText: { title: b.caption, description: b.caption, name: b.file } })] }));
      out.push(new Paragraph({ style: 'Caption', alignment: AlignmentType.CENTER, children: [new TextRun(b.caption)] }));
    }
  }
  return out;
}

function docxTitle() {
  const t = titlePage;
  const line = (text, opts = {}) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: opts.after ?? 120, before: opts.before ?? 0 }, children: [new TextRun({ text, font: FONT, size: opts.size ?? 24, bold: opts.bold, color: opts.color, italics: opts.italics })] });
  return [
    line(t.kicker, { before: 1200, size: 26, italics: true }),
    line(t.title, { size: 52, bold: true, color: GREEN, after: 200 }),
    line(t.subtitle, { size: 26, after: 360 }),
    line(t.ps, { size: 24, bold: true, after: 900 }),
    line('Submitted by', { size: 22, italics: true, after: 80 }),
    ...t.submittedBy.map(s => line(s, { size: 26, bold: true, after: 60 })),
    line('Under the guidance of', { size: 22, italics: true, before: 500, after: 80 }),
    line(t.guide, { size: 26, bold: true, after: 900 }),
    line(t.dept, { size: 26, after: 60 }),
    line(t.college, { size: 28, bold: true, after: 60 }),
    line(t.year, { size: 22, after: 0 }),
  ];
}

async function buildDocx() {
  const doc = new Document({
    creator: 'Semantic FAQ Matcher project', title: 'Semantic FAQ Matcher – Project Report',
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: '1F3B2D' }, paragraph: { spacing: { before: 120, after: 200 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 25, bold: true, color: GREEN }, paragraph: { spacing: { before: 220, after: 100 }, keepNext: true, outlineLevel: 1 } },
        { id: 'Body', name: 'Body', basedOn: 'Normal', run: { font: FONT, size: 22 }, paragraph: { spacing: { after: 140, line: 300 }, alignment: AlignmentType.JUSTIFIED } },
        { id: 'Caption', name: 'Caption', basedOn: 'Normal', run: { font: FONT, size: 19, italics: true, color: '4F6058' }, paragraph: { spacing: { before: 60, after: 240 } } },
      ],
    },
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } } } }] }] },
    sections: [
      { properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: docxTitle() },
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 }, pageNumbers: { start: 2 } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Semantic FAQ Matcher – Project Report   |   Page ', size: 18, color: '7C8881' }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '7C8881' })] })] }) },
        children: docxBlocks(),
      },
    ],
  });
  fs.writeFileSync(path.join(DIR, 'Semantic_FAQ_Matcher_Report.docx'), await Packer.toBuffer(doc));
}

// ---------------------------------------------------------------- HTML (for PDF)
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function htmlBlocks() {
  let first = true;
  return content.map(b => {
    if (b.t === 'h1') { const cls = b.newPage && !first ? ' class="np"' : ''; first = false; return `<h1${cls}>${esc(b.text)}</h1>`; }
    if (b.t === 'h2') return `<h2>${esc(b.text)}</h2>`;
    if (b.t === 'lead') return `<p class="lead">${esc(b.text)}</p>`;
    if (b.t === 'p') return `<p>${esc(b.text)}</p>`;
    if (b.t === 'bullets') return `<ul>${b.items.map(item => {
      const cut = item.indexOf('. ');
      const isRef = /^[A-Z]\. /.test(item) || item.startsWith('Sentence Transformers') || item.startsWith('FastAPI');
      return cut > 0 && cut < 50 && !isRef && /^[A-Z][a-z]/.test(item) ? `<li><b>${esc(item.slice(0, cut + 1))}</b> ${esc(item.slice(cut + 2))}</li>` : `<li>${esc(item)}</li>`;
    }).join('')}</ul>`;
    if (b.t === 'code') return `<pre>${b.lines.map(esc).join('\n')}</pre>`;
    if (b.t === 'table') {
      const total = b.widths.reduce((a, c) => a + c, 0);
      return `<table><colgroup>${b.widths.map(w => `<col style="width:${(100 * w / total).toFixed(1)}%">`).join('')}</colgroup><thead><tr>${b.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    if (b.t === 'grid') return `<div class="grid">${b.items.map(([file, caption]) => `<figure class="cell"><img src="shots/${file}" alt="${esc(caption)}"><figcaption>${esc(caption)}</figcaption></figure>`).join('')}</div>`;
    if (b.t === 'fig') {
      const src = fs.existsSync(path.join(SHOTS, b.file)) ? `shots/${b.file}` : b.file;
      const maxH = b.maxH ? `max-height:${b.maxH * 0.265}mm;` : 'max-height:100mm;';
      return `<figure>${b.intro ? `<p class="step">${esc(b.intro)}</p>` : ''}<img src="${src}" style="${maxH}" alt="${esc(b.caption)}"><figcaption>${esc(b.caption)}</figcaption></figure>`;
    }
    return '';
  }).join('\n');
}

function buildHtml() {
  const t = titlePage;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Semantic FAQ Matcher – Project Report</title>
<style>
  @page { size: A4; margin: 20mm 20mm 18mm; @bottom-center { content: "Semantic FAQ Matcher – Project Report   |   Page " counter(page); font: 9pt Arial, sans-serif; color: #7c8881; } }
  @page :first { @bottom-center { content: none; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11pt/1.5 Arial, Helvetica, sans-serif; color: #1f2d27; }
  .title-page { height: 255mm; display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 28mm; break-after: page; }
  .title-page .kicker { font-style: italic; font-size: 13pt; }
  .title-page h1.t { font-size: 28pt; color: #147d58; margin: 6mm 0 3mm; letter-spacing: .5pt; }
  .title-page .sub { font-size: 13pt; max-width: 140mm; }
  .title-page .ps { font-weight: 700; margin-top: 8mm; }
  .title-page .label { font-style: italic; font-size: 11pt; margin-top: 22mm; }
  .title-page .name { font-weight: 700; font-size: 13pt; margin-top: 1.5mm; }
  .title-page .bottom { margin-top: auto; }
  .title-page .college { font-weight: 700; font-size: 14pt; }
  h1 { font-size: 16pt; color: #1f3b2d; margin: 0 0 4mm; break-after: avoid; }
  h1.np { break-before: page; }
  h2 { font-size: 12.5pt; color: #147d58; margin: 5mm 0 2mm; break-after: avoid; }
  p { margin: 0 0 3mm; text-align: justify; }
  p.lead { font-weight: 700; font-size: 13pt; color: #147d58; text-align: left; }
  ul { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin-bottom: 1.6mm; text-align: justify; }
  pre { background: #f2f5f3; border-left: 3px solid #147d58; padding: 3mm 4mm; font: 9pt/1.6 "Courier New", monospace; margin: 1mm 0 4mm; white-space: pre-wrap; break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 1mm 0 4mm; font-size: 10pt; break-inside: avoid; }
  th, td { border: 1px solid #c9d3cd; padding: 1.6mm 2.4mm; text-align: left; vertical-align: top; }
  th { background: #e3f1e9; }
  figure { margin: 3mm 0 5mm; text-align: center; break-inside: avoid; }
  figure img { max-width: 100%; border: 1px solid #d5ddd8; }
  figure .step { text-align: justify; margin-bottom: 2mm; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 6mm; }
  .grid figure.cell { margin: 0; break-inside: avoid; }
  .grid figure.cell img { width: 100%; max-height: none; }
  .grid figcaption { text-align: left; font-size: 8.8pt; line-height: 1.4; font-style: normal; color: #33453c; }
  figcaption { font-size: 9.5pt; font-style: italic; color: #4f6058; margin-top: 1.5mm; }
</style></head><body>
<section class="title-page">
  <div class="kicker">${esc(t.kicker)}</div>
  <h1 class="t">${esc(t.title)}</h1>
  <div class="sub">${esc(t.subtitle)}</div>
  <div class="ps">${esc(t.ps)}</div>
  <div class="label">Submitted by</div>
  ${t.submittedBy.map(s => `<div class="name">${esc(s)}</div>`).join('')}
  <div class="label" style="margin-top:12mm">Under the guidance of</div>
  <div class="name">${esc(t.guide)}</div>
  <div class="bottom"><div>${esc(t.dept)}</div><div class="college">${esc(t.college)}</div><div>${esc(t.year)}</div></div>
</section>
${htmlBlocks()}
</body></html>`;
  fs.writeFileSync(path.join(DIR, 'report.html'), html);
}

buildHtml();
buildDocx().then(() => console.log('built report.html and Semantic_FAQ_Matcher_Report.docx'));
