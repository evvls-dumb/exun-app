// Renders an investigation into a self-contained HTML document for the PDF pipeline (reports/pdf.ts).
// This is the report an agent sends on, so it is a clean printed document (light, A4) rather than the
// dark console, but every figure in it is the one the assessment produced, nothing invented.
import {
  EVIDENCE_TYPE_LABELS,
  type AchResult,
  type Assessment,
  type Grade
} from './evidence'

function esc(value: string): string {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

const GRADE_COLOR: Record<Grade, string> = {
  A: '#1f8a4c',
  B: '#4f9a2f',
  C: '#b8860b',
  D: '#c76a1f',
  E: '#c23b3b',
  F: '#a52020'
}

const VERDICT_PHRASE: Record<Assessment['verdict'], string> = {
  supported: 'Hypothesis supported',
  refuted: 'Hypothesis refuted',
  leaning: 'Leaning, not yet conclusive',
  inconclusive: 'Inconclusive'
}

export interface CaseReportInput {
  investigation: { title: string; hypothesis: string; lead: string }
  assessment: Assessment
  ach: AchResult
  reportBody: string
  chainHead: string | null
  today?: string
}

export function buildCaseReportHtml(input: CaseReportInput): string {
  const { investigation, assessment, ach } = input
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const pct = assessment.estimate === null ? 'n/a' : `${Math.round(assessment.estimate * 100)}%`

  const evidenceRows = assessment.graded
    .map(
      (e) => `<tr>
        <td><span class="g" style="background:${GRADE_COLOR[e.grade]}">${e.grade}</span></td>
        <td>${esc(e.title)}</td>
        <td class="mut">${esc(EVIDENCE_TYPE_LABELS[e.type])}</td>
        <td class="mut">${esc(e.agentId)}</td>
        <td class="mut">${e.factors.sealed ? 'sealed' : 'unsealed'}</td>
        <td class="mut">${esc(e.stance)}</td>
      </tr>`
    )
    .join('')

  const hypothesisRows = ach.hypotheses
    .map(
      (h) => `<tr>
        <td>${h.rank}</td>
        <td>${esc(h.label)}</td>
        <td class="num">${Math.round(h.likelihood * 100)}%</td>
        <td class="num mut">${h.inconsistency}</td>
      </tr>`
    )
    .join('')

  const discrepancies = assessment.discrepancies.length
    ? `<ul>${assessment.discrepancies.map((d) => `<li><b>[${esc(d.severity)}] ${esc(d.title)}.</b> ${esc(d.detail)}</li>`).join('')}</ul>`
    : '<p class="mut">None found.</p>'

  const steps = assessment.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')
  const body = input.reportBody.trim()
    ? `<h2>Analyst narrative</h2><p class="narrative">${esc(input.reportBody).replace(/\n/g, '<br>')}</p>`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.5 'Segoe UI', system-ui, sans-serif; color: #1a1d22; margin: 0; }
  h1 { font-size: 19pt; margin: 0 0 2px; }
  h2 { font-size: 12pt; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d7dbe0; text-transform: uppercase; letter-spacing: .06em; color: #3a3f47; }
  .eyebrow { font: 8.5pt ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; color: #8a6d1f; }
  .mut { color: #6a7078; }
  .verdict { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-top: 14px; padding: 14px 16px; background: #f4f6f8; border: 1px solid #e2e6ea; border-radius: 8px; }
  .verdict .v { font-size: 15pt; font-weight: 600; }
  .verdict .p { font: 600 26pt ui-monospace, monospace; text-align: right; line-height: 1; }
  .verdict .c { font: 8.5pt ui-monospace, monospace; text-transform: uppercase; letter-spacing: .06em; color: #6a7078; text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th { text-align: left; font: 8.5pt ui-monospace, monospace; letter-spacing: .05em; text-transform: uppercase; color: #6a7078; border-bottom: 1px solid #d7dbe0; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #eceef1; vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .g { display: inline-block; min-width: 20px; padding: 1px 5px; border-radius: 4px; color: #fff; font-weight: 700; text-align: center; font-size: 9.5pt; }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 3px 0; }
  .narrative { white-space: pre-wrap; }
  .foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #d7dbe0; font: 8pt ui-monospace, monospace; color: #8a9099; }
  </style></head><body>
    <div class="eyebrow">Janus · Extradigital Exceptions &amp; Unknowns · Sealed evidence</div>
    <h1>${esc(investigation.title)}</h1>
    <div class="mut">Lead agent ${esc(investigation.lead)} · prepared ${esc(today)}</div>
    ${investigation.hypothesis ? `<p>Hypothesis under test: ${esc(investigation.hypothesis)}</p>` : ''}
    <div class="verdict">
      <div><div class="eyebrow">Verdict</div><div class="v">${esc(VERDICT_PHRASE[assessment.verdict])}</div></div>
      <div><div class="p">${pct}</div><div class="c">confidence · ${esc(assessment.confidenceLabel)}</div></div>
    </div>
    <h2>Competing hypotheses</h2>
    <table><thead><tr><th>#</th><th>Hypothesis</th><th class="num">Likelihood</th><th class="num">Inconsistency</th></tr></thead><tbody>${hypothesisRows}</tbody></table>
    <h2>Evidence (${assessment.graded.length})</h2>
    <table><thead><tr><th></th><th>Item</th><th>Type</th><th>Agent</th><th>Seal</th><th>Bears</th></tr></thead><tbody>${evidenceRows}</tbody></table>
    <h2>Discrepancies</h2>
    ${discrepancies}
    <h2>Recommended next steps</h2>
    <ol>${steps}</ol>
    ${body}
    <div class="foot">Derived from the sealed evidence on file.${input.chainHead ? ` Case log head ${esc(input.chainHead.slice(0, 24))}…` : ''} Re-derivable from the case file.</div>
  </body></html>`
}
