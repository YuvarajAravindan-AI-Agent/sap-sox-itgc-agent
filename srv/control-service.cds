using { sox } from '../db/schema';

@path: '/controls'
service ControlService {

  // The control library: what exists, what can be run, and the pass rule of each.
  @requires: 'agent'
  function listControls() returns LargeString;

  // Runs one control over its full population, in code. referenceDate (yyyy-mm-dd) defaults to today (UTC).
  // The answer is a result and a list of exceptions. It is never a statement that the control is effective.
  @requires: 'agent'
  function runControl(controlId : String, referenceDate : String) returns LargeString;

  @requires: 'auditor'
  function verifyAuditChain() returns LargeString;

  @requires: 'auditor'
  function exportAudit(fromSeq : Integer, limit : Integer) returns LargeString;

  @readonly @restrict: [{ grant: 'READ', to: 'auditor' }]
  entity AuditLog as projection on sox.AuditLog;
}
