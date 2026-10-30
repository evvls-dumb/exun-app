import { useMemo } from 'react'
import {
  analysisDigest,
  analyzeACH,
  assessInvestigation,
  caseTimeline,
  DEFAULT_HYPOTHESES,
  strongestLever,
  type Hypothesis
} from '@shared/evidence'
import { useCases } from './caseStore'

const TODAY = () => new Date().toISOString().slice(0, 10)

/** Everything derived from one investigation's evidence. Used by the case view and by Home, so both always
 *  show the same numbers for the same case. */
export function useCaseAssessment(investigationId: string | null) {
  const cases = useCases()
  const inv = cases.store.investigations.find((i) => i.id === investigationId) ?? null
  const evidence = useMemo(() => cases.store.evidence.filter((e) => e.investigationId === investigationId), [cases.store.evidence, investigationId])
  const context = useMemo(() => ({ incident: inv?.incident ?? null }), [inv?.incident])
  const assessment = useMemo(() => assessInvestigation(evidence, TODAY(), context), [evidence, context])
  const lever = useMemo(() => strongestLever(evidence, TODAY(), context), [evidence, context])
  const hypotheses: readonly Hypothesis[] = inv?.hypotheses ?? DEFAULT_HYPOTHESES
  const ach = useMemo(() => analyzeACH(hypotheses, evidence), [hypotheses, evidence])
  const timeline = useMemo(() => caseTimeline(evidence), [evidence])
  const digest = useMemo(() => analysisDigest(evidence, inv?.incident ?? null), [evidence, inv?.incident])
  const analysed = !!inv?.analysis
  const stale = !!inv?.analysis && inv.analysis.digest !== digest
  const counts = useMemo(
    () => ({
      verified: evidence.filter((e) => e.verification?.state === 'verified').length,
      claims: evidence.filter((e) => e.verification?.state === 'unchecked').length,
      broken: evidence.filter((e) => e.verification?.state === 'failed').length
    }),
    [evidence]
  )
  return { inv, evidence, assessment, lever, hypotheses, ach, timeline, digest, analysed, stale, counts }
}
