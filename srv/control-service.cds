using { sox } from '../db/schema';

@path: '/controls'
service ControlService {

  // The control library: what exists, what can be run, and the pass rule of each.
  @requires: 'agent'
  function listControls() returns LargeString;

  // Runs one control over its full population, in code. referenceDate (yyyy-mm-dd) defaults to today (UTC). Period controls test
  // periodStart..periodEnd, default the last calendar quarter that ended before referenceDate. ITGC-AC-01 tests the state on referenceDate.
  // The answer is a result and a list of exceptions. It is never a statement that the control is effective.
  @requires: 'agent'
  function runControl(controlId : String, referenceDate : String, periodStart : String, periodEnd : String) returns LargeString;

  // A named control owner concludes on one run. Separate scope; the agent cannot call it. The signer is the authenticated user.
  @requires: 'controlOwner'
  function signOffControl(runSeq : Integer, conclusion : String, exceptionsReviewed : Boolean, comment : String) returns LargeString;

  // The evidence pack for one run (JSON Lines): the chained audit rows up to the run (and its sign-off), the result, the sign-off and the
  // narrative. Verify it offline with tools/verify-pack.js.
  @requires: 'auditor'
  function exportEvidence(runSeq : Integer) returns LargeString;

  @requires: 'auditor'
  function verifyAuditChain() returns LargeString;

  @requires: 'auditor'
  function exportAudit(fromSeq : Integer, limit : Integer) returns LargeString;

  @readonly @restrict: [{ grant: 'READ', to: 'auditor' }]
  entity AuditLog as projection on sox.AuditLog;

  @readonly @restrict: [{ grant: 'READ', to: ['auditor', 'controlOwner'] }]
  entity Signoffs as projection on sox.Signoffs;
}
