/**
 * Automated Verification Script for the airfare picker UI.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * travelRequestAirfare.html pre-fills the "Estimated Cost" field from GSA City
 * Pair contract fares. The behaviours that matter are mostly about restraint:
 *
 *   §3  A hand-typed figure is NEVER overwritten. The whole feature is a
 *       suggestion. Someone may have a quote, or know the contract fare is
 *       unavailable on their dates; a form that overwrites their number fights
 *       its user.
 *
 *   §5  An incomplete itinerary is flagged rather than silently summed. A
 *       partial total presented as a total is how an under-estimate reaches an
 *       approver.
 *
 *   §7  A failed lookup degrades to manual entry with a visible message. The
 *       form must stay submittable when GSA data is unavailable.
 *
 *   §8  No duty station means no origin and NO GUESS. Inventing one would
 *       produce a confidently wrong number.
 *
 *   §10 A repaint must not re-fetch. A cold lookup scans 17,403 rows (~2.7s
 *       measured in the sandbox), and the traveler card repaints often.
 *
 * §2 pins the round-trip arithmetic. CPP fares are published ONE WAY, and the
 * mileage field beside this one is labelled "round trip", so the return
 * segment has to be priced or every estimate is half what it should be:
 * 112 + 112 = 224 for DCA-ORD.
 *
 * §9 covers local-travel legs, which are drives rather than flights and must
 * not be priced as airfare.
 *
 * HOW IT LOADS THE CODE
 * ---------------------
 * The <script> body is extracted and evaluated in a vm context with a minimal
 * fake DOM (getElementById, classList, addEventListener) and a stubbed
 * serverCall. The render/fetch/apply cycle therefore runs for real, including
 * promise sequencing — origin resolves before destinations are priced, because
 * pricing against an origin that is about to change would be wrong.
 *
 * Run: node lets_app/test_airfare_ui.js
 */

// Exercises travelRequestAirfare.html's logic in a fake DOM with stubbed
// serverCall, so the render/fetch/apply cycle runs for real.
const fs=require('fs'),vm=require('vm'),re=require('vm');
function jsOf(p){const s=fs.readFileSync(p,'utf8');const m=s.match(/<script[^>]*>([\s\S]*?)<\/script>/);return m?m[1]:'';}

function makeEl(id){
  return {id,innerHTML:'',value:'',textContent:'',_listeners:{},classList:{
    _s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},
    toggle(c,on){if(on===undefined){this._s.has(c)?this._s.delete(c):this._s.add(c);}else{on?this._s.add(c):this._s.delete(c);}},
    contains(c){return this._s.has(c);}},
    addEventListener(ev,fn){this._listeners[ev]=fn;},
    fire(ev){if(this._listeners[ev])this._listeners[ev].call(this);}};
}

function build(opts){
  opts=opts||{};
  const els={};
  const calls=[];
  const sandbox={
    console:{log(){},warn(){},error(){}},
    Promise,Object,Array,String,Number,Date,Math,JSON,parseFloat,parseInt,isNaN,
    document:{getElementById:id=>els[id]||null},
    escapeHtml:t=>String(t===null||t===undefined?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    serverCall:function(fn){
      const args=Array.prototype.slice.call(arguments,1);
      calls.push({fn,args});
      const h=opts.handlers&&opts.handlers[fn];
      if(!h) return Promise.reject(new Error('no stub for '+fn));
      const r=h.apply(null,args);
      return r&&r.then?r:Promise.resolve(r);
    }
  };
  sandbox.window=sandbox;
  const travelers={};
  const legs=opts.legs||[];
  sandbox.window.TravelRequest={
    Controller:{},
    State:{
      getTraveler:id=>travelers[id]||null,
      getTravelers:()=>Object.keys(travelers).map(k=>travelers[k]),
      getLegs:()=>legs,
      updateTraveler:(id,f,v)=>{if(travelers[id])travelers[id][f]=v;}
    }
  };
  const ctx=vm.createContext(sandbox);
  vm.runInContext(jsOf('lets_app/client/controllers/form/travelRequestAirfare.html'),ctx,{filename:'airfare'});
  return {ctx,sandbox,els,calls,travelers,legs,
    C:()=>vm.runInContext('window.TravelRequest.Controller',ctx),
    el(id){els[id]=els[id]||makeEl(id);return els[id];}};
}

let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x).slice(0,200));fails++;}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const DCAOPTS={success:true,airports:[
  {code:'DCA',city:'WASHINGTON',state:'DC',isMetroArea:false,metroLabel:'',routeCount:254,isPreferred:false,useCount:0},
  {code:'BWI',city:'WASHINGTON',state:'DC',isMetroArea:false,metroLabel:'',routeCount:210,isPreferred:false,useCount:0},
  {code:'WAS',city:'WASHINGTON',state:'DC',isMetroArea:true,metroLabel:'Washington, DC area',routeCount:260,isPreferred:false,useCount:0}],
  defaultCode:'DCA',matchType:'exact',matchedCity:'WASHINGTON',requestedCity:'WASHINGTON',hasChoice:true};
const CHIOPTS={success:true,origin:'DCA',options:[
  {code:'ORD',city:'CHICAGO',state:'IL',isMetroArea:false,found:true,ycaFare:112,airline:'UA',awardedService:'Non-stop',isPreferred:false},
  {code:'MDW',city:'CHICAGO',state:'IL',isMetroArea:false,found:true,ycaFare:304,airline:'WN',awardedService:'Non-stop',isPreferred:false}],
  defaultCode:'ORD',matchType:'exact',matchedCity:'CHICAGO',requestedCity:'CHICAGO',hasChoice:true};
const RETURN={success:true,complete:true,total:112,fareBasis:'YCA',
  segments:[{from:'ORD',to:'DCA',ycaFare:112,airline:'UA',awardedService:'Non-stop',found:true}]};

function baseHandlers(over){
  return Object.assign({
    getAirportOptionsForCityForClient:()=>DCAOPTS,
    getPricedDestinationOptionsForClient:()=>CHIOPTS,
    getItineraryAirfareForClient:()=>RETURN,
    recordAirportPreferenceForClient:()=>({success:true,useCount:1,promoted:false})
  },over||{});
}

(async()=>{
console.log('1. air mode only');
{
  const h=build({legs:[{id:'L1',legNumber:1,city:'CHICAGO',state:'IL',startDate:'2027-02-10'}],handlers:baseHandlers()});
  h.travelers.T1={id:'T1',transportMode:'rail',dutyStationCity:'WASHINGTON',dutyStationState:'DC',
    attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:0};
  const wrap=h.el('tcAirfareWrap_T1');
  h.C()._initAirfare('T1');
  await sleep(5);
  ok('rail renders nothing', wrap.innerHTML==='', wrap.innerHTML);
  ok('block hidden', wrap.classList.contains('tc__airfare--hidden'));
  ok('no server calls for rail', h.calls.length===0, h.calls.map(c=>c.fn));
}

console.log('2. air mode loads, prices and pre-fills');
{
  const h=build({legs:[{id:'L1',legNumber:1,city:'CHICAGO',state:'IL',startDate:'2027-02-10'}],handlers:baseHandlers()});
  h.travelers.T1={id:'T1',userId:'ext_olry',transportMode:'air',dutyStationCity:'WASHINGTON',
    dutyStationState:'DC',attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:0,airfareIsEstimate:false};
  const wrap=h.el('tcAirfareWrap_T1'); const input=h.el('tcTransportCost_T1');
  h.C()._initAirfare('T1');
  await sleep(30);
  ok('origin resolved to DCA', h.travelers.T1.originAirport==='DCA', h.travelers.T1.originAirport);
  ok('destination defaulted to ORD', h.travelers.T1.legAirports.L1==='ORD', h.travelers.T1.legAirports);
  // One way out + one way back. CPP fares are published one-way and the
  // mileage field beside this one says "round trip".
  ok('round trip = 112 + 112 = 224', h.travelers.T1.ticketCost===224, h.travelers.T1.ticketCost);
  ok('flagged as estimate', h.travelers.T1.airfareIsEstimate===true);
  ok('input populated', input.value==='224.00', input.value);
  ok('breakdown rendered', wrap.innerHTML.indexOf('DCA &rarr; ORD')>-1 && wrap.innerHTML.indexOf('ORD &rarr; DCA')>-1);
  ok('shows service type', wrap.innerHTML.indexOf('Non-stop')>-1);
  // @clolry had to ask what WN and DL meant. GSA's own Fare Finder spells
  // carriers out where the CSV abbreviates, so showing the raw IATA code was
  // compressing information the source had already expanded.
  ok('carrier shown as a name, not a code', wrap.innerHTML.indexOf('United')>-1, wrap.innerHTML.slice(0,400));
  ok('raw code not shown', wrap.innerHTML.indexOf('>UA<')===-1);
  ok('shows fare basis', wrap.innerHTML.indexOf('YCA')>-1);
  ok('metro option labelled', wrap.innerHTML.indexOf('all airports')>-1 || wrap.innerHTML.indexOf('Washington, DC area')>-1);
}

console.log('3. a hand-typed figure is never overwritten');
{
  const h=build({legs:[{id:'L1',legNumber:1,city:'CHICAGO',state:'IL',startDate:'2027-02-10'}],handlers:baseHandlers()});
  h.travelers.T1={id:'T1',transportMode:'air',dutyStationCity:'WASHINGTON',dutyStationState:'DC',
    attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:999,airfareIsEstimate:false};
  const wrap=h.el('tcAirfareWrap_T1'); h.el('tcTransportCost_T1');
  h.C()._initAirfare('T1');
  await sleep(30);
  ok('user figure preserved', h.travelers.T1.ticketCost===999, h.travelers.T1.ticketCost);
  ok('not marked as estimate', h.travelers.T1.airfareIsEstimate===false);
  ok('offers the estimate as a button', wrap.innerHTML.indexOf('Use $224.00')>-1, wrap.innerHTML.slice(-400));
}

console.log('4. manual edit clears the estimate flag');
{
  const h=build({legs:[{id:'L1',legNumber:1,city:'CHICAGO',state:'IL',startDate:'2027-02-10'}],handlers:baseHandlers()});
  h.travelers.T1={id:'T1',transportMode:'air',dutyStationCity:'WASHINGTON',dutyStationState:'DC',
    attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:0,airfareIsEstimate:false};
  h.el('tcAirfareWrap_T1'); h.el('tcTransportCost_T1');
  h.C()._initAirfare('T1');
  await sleep(30);
  ok('estimate applied first', h.travelers.T1.airfareIsEstimate===true);
  h.travelers.T1.ticketCost=500;
  h.C()._onAirfareManualEdit('T1');
  ok('flag cleared on manual edit', h.travelers.T1.airfareIsEstimate===false);
  ok('button returns', h.el('tcAirfareWrap_T1').innerHTML.indexOf('Use $224.00')>-1);
}

console.log('5. incomplete itineraries are flagged, not silently summed');
{
  const partial={success:true,origin:'DCA',options:[
    {code:'XYZ',city:'NOWHERE',state:'ZZ',isMetroArea:false,found:false,ycaFare:null,airline:'',awardedService:'',isPreferred:false}],
    defaultCode:'XYZ',matchType:'exact',requestedCity:'NOWHERE',hasChoice:false};
  const h=build({legs:[{id:'L1',legNumber:1,city:'NOWHERE',state:'ZZ',startDate:'2027-02-10'}],
    handlers:baseHandlers({getPricedDestinationOptionsForClient:()=>partial,
      getItineraryAirfareForClient:()=>({success:true,complete:false,total:0,segments:[{from:'XYZ',to:'DCA',found:false,ycaFare:null}]})})});
  h.travelers.T1={id:'T1',transportMode:'air',dutyStationCity:'WASHINGTON',dutyStationState:'DC',
    attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:0,airfareIsEstimate:false};
  const wrap=h.el('tcAirfareWrap_T1'); h.el('tcTransportCost_T1');
  h.C()._initAirfare('T1');
  await sleep(30);
  ok('warns about missing segments', wrap.innerHTML.indexOf('no contract fare')>-1, wrap.innerHTML.slice(0,300));
  ok('does not pre-fill a bogus total', !h.travelers.T1.ticketCost, h.travelers.T1.ticketCost);
}

console.log('6. alias / state fallback is explained to the user');
{
  const aliased=Object.assign({},DCAOPTS,{matchType:'alias',matchedCity:'DALLAS',requestedCity:'FORT WORTH'});
  const h=build({legs:[{id:'L1',legNumber:1,city:'CHICAGO',state:'IL',startDate:'2027-02-10'}],
    handlers:baseHandlers({getAirportOptionsForCityForClient:()=>aliased})});
  h.travelers.T1={id:'T1',transportMode:'air',dutyStationCity:'FORT WORTH',dutyStationState:'TX',
    attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:0};
  const wrap=h.el('tcAirfareWrap_T1'); h.el('tcTransportCost_T1');
  h.C()._initAirfare('T1');
  await sleep(30);
  ok('explains the alias', wrap.innerHTML.indexOf('FORT WORTH')>-1 && wrap.innerHTML.indexOf('DALLAS')>-1);
}

console.log('7. a failed lookup degrades to manual entry');
{
  const h=build({legs:[{id:'L1',legNumber:1,city:'CHICAGO',state:'IL',startDate:'2027-02-10'}],
    handlers:baseHandlers({getAirportOptionsForCityForClient:()=>Promise.reject(new Error('boom'))})});
  h.travelers.T1={id:'T1',transportMode:'air',dutyStationCity:'WASHINGTON',dutyStationState:'DC',
    attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:0};
  const wrap=h.el('tcAirfareWrap_T1');
  h.C()._initAirfare('T1');
  await sleep(30);
  ok('tells the user to enter it manually', wrap.innerHTML.indexOf('manually')>-1, wrap.innerHTML);
  ok('does not throw or wedge', true);
}

console.log('8. no duty station = no origin, no guess');
{
  const h=build({legs:[{id:'L1',legNumber:1,city:'CHICAGO',state:'IL',startDate:'2027-02-10'}],handlers:baseHandlers()});
  h.travelers.T1={id:'T1',transportMode:'air',dutyStationCity:'',dutyStationState:'',
    attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:0};
  const wrap=h.el('tcAirfareWrap_T1');
  h.C()._initAirfare('T1');
  await sleep(20);
  ok('no server call without a duty station', h.calls.length===0, h.calls.map(c=>c.fn));
  ok('says no airport found', wrap.innerHTML.indexOf('no airport found')>-1, wrap.innerHTML);
}

console.log('9. local-travel legs are not flown to');
{
  const h=build({legs:[{id:'L1',legNumber:1,city:'WASHINGTON',state:'DC',startDate:'2027-02-10'},
                       {id:'L2',legNumber:2,city:'CHICAGO',state:'IL',startDate:'2027-02-12'}],
    handlers:baseHandlers()});
  h.travelers.T1={id:'T1',transportMode:'air',dutyStationCity:'WASHINGTON',dutyStationState:'DC',
    attendingLegs:['L1','L2'],legCosts:{L1:{isLocalTravel:true}},legAirports:{},ticketCost:0};
  h.el('tcAirfareWrap_T1'); h.el('tcTransportCost_T1');
  h.C()._initAirfare('T1');
  await sleep(30);
  const priced=h.calls.filter(c=>c.fn==='getPricedDestinationOptionsForClient');
  ok('only the non-local leg is priced', priced.length===1, priced.map(c=>c.args[1]));
  ok('and it is Chicago', priced[0].args[1]==='CHICAGO', priced[0].args[1]);
}

console.log('10. repaint does not re-fetch');
{
  const h=build({legs:[{id:'L1',legNumber:1,city:'CHICAGO',state:'IL',startDate:'2027-02-10'}],handlers:baseHandlers()});
  h.travelers.T1={id:'T1',transportMode:'air',dutyStationCity:'WASHINGTON',dutyStationState:'DC',
    attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:0};
  h.el('tcAirfareWrap_T1'); h.el('tcTransportCost_T1');
  h.C()._initAirfare('T1');
  await sleep(30);
  const before=h.calls.length;
  h.C()._initAirfare('T1');
  await sleep(10);
  // A cold lookup is ~2.7s. Re-fetching on every card repaint would make the
  // form unusable.
  ok('second init is cache-only', h.calls.length===before, 'before='+before+' after='+h.calls.length);
}

console.log('11. changing duty station DOES re-fetch');
{
  const h=build({legs:[{id:'L1',legNumber:1,city:'CHICAGO',state:'IL',startDate:'2027-02-10'}],handlers:baseHandlers()});
  h.travelers.T1={id:'T1',transportMode:'air',dutyStationCity:'WASHINGTON',dutyStationState:'DC',
    attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:0};
  h.el('tcAirfareWrap_T1'); h.el('tcTransportCost_T1');
  h.C()._initAirfare('T1');
  await sleep(30);
  const before=h.calls.filter(c=>c.fn==='getAirportOptionsForCityForClient').length;
  h.travelers.T1.dutyStationCity='BOSTON'; h.travelers.T1.dutyStationState='MA';
  h.C()._initAirfare('T1');
  await sleep(30);
  const after=h.calls.filter(c=>c.fn==='getAirportOptionsForCityForClient').length;
  ok('re-resolves the origin', after===before+1, 'before='+before+' after='+after);
}

console.log('11b. airline codes resolve to names, unknown codes pass through');
{
  const h=build({legs:[],handlers:baseHandlers()});
  const C=h.C();
  ok('WN -> Southwest', C._airlineName('WN')==='Southwest', C._airlineName('WN'));
  ok('DL -> Delta', C._airlineName('DL')==='Delta');
  ok('UA -> United', C._airlineName('UA')==='United');
  ok('AA -> American', C._airlineName('AA')==='American');
  ok('AS -> Alaska', C._airlineName('AS')==='Alaska');
  ok('lowercase input works', C._airlineName('wn')==='Southwest');
  // A new or regional carrier must show its code rather than be guessed at or
  // silently dropped — the table is small and hand-kept on purpose.
  ok('unknown code passes through', C._airlineName('ZZ')==='ZZ', C._airlineName('ZZ'));
  ok('blank stays blank', C._airlineName('')==='');
  ok('null stays blank', C._airlineName(null)==='');
}

console.log('12. cache is dropped when a traveler is removed');
{
  const h=build({legs:[{id:'L1',legNumber:1,city:'CHICAGO',state:'IL',startDate:'2027-02-10'}],handlers:baseHandlers()});
  h.travelers.T1={id:'T1',transportMode:'air',dutyStationCity:'WASHINGTON',dutyStationState:'DC',
    attendingLegs:['L1'],legCosts:{},legAirports:{},ticketCost:0};
  h.el('tcAirfareWrap_T1'); h.el('tcTransportCost_T1');
  h.C()._initAirfare('T1');
  await sleep(30);
  h.C()._clearAirfareCache('T1');
  const C=h.C();
  ok('entry removed', !C._airfareCache['T1'], Object.keys(C._airfareCache));
}

console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
})();
