// Evidence script — re-run with:  node docs/evidence/pass4_request_service_edge_cases.js
// Paths are relative to this file's directory; run from anywhere with:
//   cd docs/evidence && node pass4_request_service_edge_cases.js
const RS = require('../../lets_app/server/40_domain/RequestService.js');
const C  = require('../../lets_app/server/00_config/BudgetConfig.js');
const base = { offices: C.baselineAllocations, setAsides: C.defaultSetAsides, budgetAdjustments: [], approvers: C.defaultApprovers };

console.log('=== RequestService.updateRequestStatus: does it enforce ANY role/permission check? ===');
const st = { ...base, requests: [{requestId:'LETS-2027-001', status:C.requestStatus.SUBMITTED, owningOffice:'OMD', totalEstimatedCost:1000, totalActualCost:0}] };
const r = RS.updateRequestStatus('LETS-2027-001', C.requestStatus.APPROVED, 'anyone@example.com', 'no checks', st);
console.log('status now:', r.request.status, '| actor recorded:', r.auditEntry.actorEmail);
console.log('-> JSDoc says "with role and permission checks". There are none.');

console.log('\n=== can it jump straight to RECONCILED, skipping every stage? ===');
const r2 = RS.updateRequestStatus('LETS-2027-001', C.requestStatus.RECONCILED, 'x@y.gov', '', st);
console.log('status now:', r2.request.status, '-> no transition validation at all');

console.log('\n=== arbitrary status string accepted? ===');
const r3 = RS.updateRequestStatus('LETS-2027-001', 'Totally Made Up', 'x@y.gov', '', st);
console.log('status now:', JSON.stringify(r3.request.status));

console.log('\n=== generateRequestId: collision behaviour ===');
console.log('with 0 existing:', RS.generateRequestId(0));
console.log('with 5 existing:', RS.generateRequestId(5));
console.log('-> count-based. Delete a request, next ID REUSES an existing number.');
const ids = [1,2,3].map(()=>RS.generateRequestId(2));
console.log('three concurrent submits, same count:', ids.join(', '));

console.log('\n=== createTravelRequest: budget gate wiring ===');
const fd = { owningOffice:'OMD', eventName:'Test Summit', travelers:[{travelerName:'A', estAirfare:500, estLodging:600, estMie:200, estOther:100}], submitterEmail:'a@b.gov' };
const out = RS.createTravelRequest(fd, {...base, requests:[]});
console.log('estimated:', out.request.totalEstimatedCost, '| budgetCheckStatus:', out.request.budgetCheckStatus);
console.log('status after gate:', out.request.status);
console.log('approver:', out.assignedApprover.primaryApproverEmail);
console.log('travelerId:', out.travelers[0].travelerId);

console.log('\n=== createTravelRequest: huge request -> flagged? ===');
const out2 = RS.createTravelRequest({...fd, travelers:[{travelerName:'A', estAirfare:999999}]}, {...base, requests:[]});
console.log('status:', out2.request.status, '| budgetCheckStatus:', out2.request.budgetCheckStatus);

console.log('\n=== reconcileRequest: does it validate that travel happened? ===');
const st2 = { ...base, requests: [{requestId:'R1', status:C.requestStatus.SUBMITTED, owningOffice:'OMD', totalEstimatedCost:1000, totalActualCost:0}] };
const rec = RS.reconcileRequest('R1', [{travelerName:'A', estAirfare:100, actAirfare:9999}], st2);
console.log('status:', rec.request.status, '| actual:', rec.request.totalActualCost, '| variance:', rec.variance);
console.log('-> reconciles straight from SUBMITTED; no requirement that status be TRAVEL_COMPLETE.');
console.log('-> ALSO: it OVERWRITES totalEstimatedCost from the submitted actuals payload:', rec.request.totalEstimatedCost);
