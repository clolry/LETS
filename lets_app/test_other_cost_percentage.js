/**
 * Automated Verification Script for the configurable "other costs" gross-up.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * The gross-up percentage lives in the `other_cost_percentage` Script Property
 * (Props.js:117). Before this change the CLIENT hardcoded 15 in three places
 * and never read that property:
 *
 *   travelCostService.html:246      percentage = 15
 *   travelCostService.html:291      parseFloat(...) || 15
 *   travelRequestState.html:584     otherPercentage: 15
 *
 * So setting the property to 30 moved the server's recalculation at submission
 * while the form kept displaying 15%. That divergence is worse than a wrong
 * constant: the submitter approves one estimate and a different number is
 * stored. Costs.js:675 prefers `traveler.otherPercentage` when the row carries
 * one, so the stale client value silently won on every request.
 *
 * Section 6 is the most important here. It pins rule C-07 — a submitted row
 * keeps the rate in force when it was submitted, so a stored 15% must survive
 * even when the current configuration says 30%. Reopening an old request must
 * not restate its cost under today's rate.
 *
 * HOW IT LOADS THE CLIENT CODE
 * ----------------------------
 * These are Apps Script HTML includes, not modules. The <script> body is
 * extracted and evaluated in a vm context where `window` IS the global object,
 * which is what a browser does and what the IIFEs assume. google.script.run is
 * stubbed so the RPC path, the dedupe-by-promise and the failure handler all
 * execute for real.
 *
 * Run: node lets_app/test_other_cost_percentage.js
 */

// Harness: extract the TravelCostService IIFE and exercise the new config path
const fs=require('fs'),vm=require('vm');
function jsOf(p){const s=fs.readFileSync(p,'utf8');return (s.match(/<script[^>]*>([\s\S]*?)<\/script>/)||[])[1]||'';}
const utils=jsOf('lets_app/client/shared/travelUtils.html');
const cost=jsOf('lets_app/client/shared/travelCostService.html');

function build(rpc){
  const sandbox={console:{log(){},warn(){},error(){}},Promise,parseFloat,parseInt,isNaN,Math,JSON,Object,Array,String,Number,Date};
  sandbox.window=sandbox;              // browser: window IS the global
  sandbox.globalThis=sandbox;
  sandbox.google = rpc ? {script:{run:rpc}} : undefined;
  const ctx=vm.createContext(sandbox);
  vm.runInContext(utils,ctx,{filename:'travelUtils'});
  vm.runInContext(cost,ctx,{filename:'travelCostService'});
  return {ctx,sandbox};
}
function svc(ctx){return vm.runInContext('window.TravelCostService',ctx);}
function cfg(ctx){return vm.runInContext('window.TravelUtils.TRAVEL_CONFIG',ctx);}

let fails=0;
function ok(name,cond,extra){ if(cond){console.log('  PASS',name);} else {console.log('  FAIL',name,extra||'');fails++;} }

console.log('1. fallback before load');
{
  const {ctx}=build(null);
  ok('TRAVEL_CONFIG fallback is 30', cfg(ctx).OTHER_COST_PERCENTAGE_FALLBACK===30, cfg(ctx).OTHER_COST_PERCENTAGE_FALLBACK);
  ok('getOtherCostPercentage()===30', svc(ctx).getOtherCostPercentage()===30, svc(ctx).getOtherCostPercentage());
  ok('isCostConfigLoaded()===false', svc(ctx).isCostConfigLoaded()===false);
}

console.log('2. loads configured value');
(async()=>{
  const rpc={withSuccessHandler(f){this._s=f;return this;},withFailureHandler(f){this._f=f;return this;},
    getCostConfigForClient(){this._s({otherCostPercentage:30});},getMileageRatesForClient(){this._s({private:0.7,gov:0.22});}};
  const {ctx}=build(rpc);
  await svc(ctx).loadCostConfig();
  ok('percentage is 30 after load', svc(ctx).getOtherCostPercentage()===30, svc(ctx).getOtherCostPercentage());
  ok('isCostConfigLoaded()===true', svc(ctx).isCostConfigLoaded()===true);

  console.log('3. a different configured value is honoured');
  const rpc2={withSuccessHandler(f){this._s=f;return this;},withFailureHandler(f){this._f=f;return this;},
    getCostConfigForClient(){this._s({otherCostPercentage:22});}};
  const b2=build(rpc2);
  await svc(b2.ctx).loadCostConfig();
  ok('percentage is 22', svc(b2.ctx).getOtherCostPercentage()===22, svc(b2.ctx).getOtherCostPercentage());

  console.log('4. calculateOtherCosts uses config when no arg');
  const s=svc(ctx);
  ok('1000 base @30% = 300', Math.abs(s.calculateOtherCosts(1000,0,0)-300)<1e-9, s.calculateOtherCosts(1000,0,0));
  ok('explicit 15 still honoured', Math.abs(s.calculateOtherCosts(1000,0,0,15)-150)<1e-9);
  ok('null pct falls back to config', Math.abs(s.calculateOtherCosts(1000,0,0,null)-300)<1e-9);
  ok('base sums all three', Math.abs(s.calculateOtherCosts(100,200,700)-300)<1e-9);

  console.log('5. RPC failure degrades to fallback, not 0%');
  const rpc3={withSuccessHandler(f){this._s=f;return this;},withFailureHandler(f){this._f=f;return this;},
    getCostConfigForClient(){this._f(new Error('boom'));}};
  const b3=build(rpc3);
  await svc(b3.ctx).loadCostConfig();
  ok('still 30 after failure', svc(b3.ctx).getOtherCostPercentage()===30, svc(b3.ctx).getOtherCostPercentage());
  ok('no 0% gross-up', svc(b3.ctx).calculateOtherCosts(1000,0,0)===300);

  console.log('6. traveler row rate wins (rule C-07)');
  const t={transportMode:'air',ticketCost:1000,legCosts:{},otherPercentage:15};
  const r=s.calculateTravelerTotals(t,[]);
  ok('stored 15% preserved', r.otherPercentage===15 && Math.abs(r.otherTotal-150)<1e-9, JSON.stringify(r));
  const t2={transportMode:'air',ticketCost:1000,legCosts:{}};
  const r2=s.calculateTravelerTotals(t2,[]);
  ok('absent -> config 30%', r2.otherPercentage===30 && Math.abs(r2.otherTotal-300)<1e-9, JSON.stringify(r2));
  // The old `|| 15` would turn a legitimate 0 into 15; isNaN check keeps 0.
  const t3={transportMode:'air',ticketCost:1000,legCosts:{},otherPercentage:0};
  const r3=s.calculateTravelerTotals(t3,[]);
  ok('explicit 0 not coerced to 15', r3.otherPercentage===0 && r3.otherTotal===0, JSON.stringify(r3));

  console.log('7. dedupes concurrent loads');
  let calls=0;
  const rpc4={withSuccessHandler(f){this._s=f;return this;},withFailureHandler(f){this._f=f;return this;},
    getCostConfigForClient(){calls++;this._s({otherCostPercentage:30});}};
  const b4=build(rpc4);
  await Promise.all([svc(b4.ctx).loadCostConfig(),svc(b4.ctx).loadCostConfig(),svc(b4.ctx).loadCostConfig()]);
  ok('single RPC for 3 calls', calls===1, 'calls='+calls);

  console.log('8. negative control (the suite must be able to fail)');
  // Re-evaluate the service with the configured read patched out, and confirm
  // section 2 would have failed. A test that cannot fail is not a test.
  const brokenCost = cost.replace(
    'if (otherCostPercentage !== null) return otherCostPercentage;',
    'if (false) return otherCostPercentage;');
  if (brokenCost === cost) { ok('negative control patched the source', false); }
  else {
    const rpc5={withSuccessHandler(f){this._s=f;return this;},withFailureHandler(f){this._f=f;return this;},
      getCostConfigForClient(){this._s({otherCostPercentage:22});}};
    const sb={console:{log(){},warn(){},error(){}},Promise,parseFloat,parseInt,isNaN,Math,JSON,Object,Array,String,Number,Date};
    sb.window=sb; sb.globalThis=sb; sb.google={script:{run:rpc5}};
    const c5=vm.createContext(sb);
    vm.runInContext(utils,c5); vm.runInContext(brokenCost,c5);
    await svc(c5).loadCostConfig();
    ok('ignoring the loaded value yields 30, not 22',
       svc(c5).getOtherCostPercentage()===30, svc(c5).getOtherCostPercentage());
  }

  console.log(fails===0?'\nALL ASSERTIONS PASSED!':'\n'+fails+' FAILURE(S)');
  process.exit(fails?1:0);
})();
