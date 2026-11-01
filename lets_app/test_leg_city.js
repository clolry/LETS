/**
 * Automated Verification Script for leg city capture.
 *
 * THE BUG
 * -------
 * leg.city was only ever written from inside _setupLegCityAutocomplete, and
 * that function is called only on the SUCCESS branch of the GSA city lookup.
 *
 * So when the lookup failed, the placeholder changed to "Type any city..." —
 * actively inviting manual entry — and nothing captured what was typed. The
 * user saw a field that accepted their text and a Continue button that refused
 * to proceed, reporting "Please complete all destination details (city and
 * dates)".
 *
 * @clolry hit exactly this before GSA_PERDIEM_API_KEY was configured. Setting
 * the key fixes the success path but NOT the bug: any GSA outage, quota
 * exhaustion, or a state returning no cities reproduces it identically.
 *
 * Sections 1 and 2 cover the failing and throwing lookups. Section 3 covers
 * the success path, because the GSA list does not contain every city and a
 * traveller going somewhere unlisted must still be able to type it. Section 4
 * covers a null Awesomplete instance — the binding previously lived inside
 * `if (awInstance)`, so a failed construction silently removed the only way to
 * enter a city.
 *
 * Section 6 is a structural assertion rather than a behavioural one: it reads
 * the source and checks the binding call sits OUTSIDE the conditional. Worth
 * noting the first version of that check sliced past the block's closing brace
 * and matched the unconditional call that follows, so it could never fail —
 * fixed, and the whole suite was then confirmed to fail when the original bug
 * is reintroduced.
 *
 * Run: node lets_app/test_leg_city.js
 */

// leg.city must be captured whether or not the GSA city lookup succeeds.
const fs=require('fs'),vm=require('vm');
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x).slice(0,200));fails++;}};

function build(opts){
  opts=opts||{};
  const legs=[{id:'L1',legNumber:1,city:'',state:'IL',country:'United States'}];
  const els={};
  function el(id){
    if(els[id]) return els[id];
    els[id]={id,value:'',placeholder:'',_l:{},_letsManualEntryBound:undefined,
      classList:{_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},
        contains(c){return this._s.has(c);},toggle(){}},
      addEventListener(ev,fn){ this._l[ev]=(this._l[ev]||[]).concat(fn); },
      fire(ev){ (this._l[ev]||[]).forEach(f=>f.call(this)); },
      listenerCount(ev){ return (this._l[ev]||[]).length; }};
    return els[id];
  }
  const sb={console:{log(){},warn(){},error(){}},Promise,Object,Array,String,Number,Math,JSON,
    parseFloat,parseInt,isNaN,setTimeout,
    document:{getElementById:id=>els[id]||null,querySelector:()=>null,createElement:()=>({style:{},classList:{add(){}}})},
    TravelLocationService:{
      loadCities:()=>Promise.resolve(opts.lookup||{success:false,cities:[]}),
      setupCityAutocomplete:()=>opts.awInstance===undefined?{destroy(){}}:opts.awInstance
    }};
  sb.window=sb;
  const recheck=[];
  sb.window.TravelRequest={
    Controller:{ _autocompleteInstances:{},
      _updateItinerarySummary(){}, _floatAwesomplete(){},
      _recheckLocalTravelForAllTravelers(){ recheck.push(1); } },
    State:{ getLegs:()=>legs,
      updateLeg:(id,f,v)=>{ const l=legs.find(x=>x.id===id); if(l) l[f]=v; } }
  };
  const ctx=vm.createContext(sb);
  const src=fs.readFileSync('lets_app/client/controllers/form/travelRequestItinerary.html','utf8');
  const blocks=src.match(/<script[^>]*>([\s\S]*?)<\/script>/g).map(b=>b.replace(/<\/?script[^>]*>/g,''));
  // Only the Controller method definitions are needed; the file's IIFE wiring
  // pulls in far more of the page than this behaviour requires.
  const wanted=blocks.join('\n');
  const i=wanted.indexOf('Controller._loadLegCities =');
  const j=wanted.indexOf('Controller._resetLegCityAutocomplete =');
  vm.runInContext('var Controller = window.TravelRequest.Controller;',ctx);
  vm.runInContext(wanted.slice(i,j),ctx);
  return {ctx,el,legs,recheck,
    C:()=>vm.runInContext('Controller',ctx),
    run:e=>vm.runInContext(e,ctx)};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
console.log('1. lookup FAILS — a typed city is still captured');
{
  // THE BUG. leg.city was only written from inside the success branch, so a
  // failed lookup left a field that accepted text and a Continue button that
  // refused to proceed: "Please complete all destination details".
  const h=build({lookup:{success:false,cities:[]}});
  const input=h.el('legCity_L1'); h.el('legCityLoading_L1');
  await h.run("Controller._loadLegCities('L1',{country:'United States',state:'IL'})");
  await sleep(5);
  ok('placeholder invites manual entry', input.placeholder==='Type any city...', input.placeholder);
  ok('blur handler attached', input.listenerCount('blur')===1, input.listenerCount('blur'));
  input.value='Peoria';
  input.fire('blur');
  ok('typed city written to state', h.legs[0].city==='Peoria', h.legs[0]);
  ok('local-travel re-evaluated', h.recheck.length===1, h.recheck.length);
}

console.log('2. lookup THROWS — same guarantee');
{
  const h=build();
  h.run("TravelLocationService.loadCities = function(){ return Promise.reject(new Error('network')); };");
  const input=h.el('legCity_L1');
  await h.run("Controller._loadLegCities('L1',{country:'United States',state:'IL'})");
  await sleep(5);
  ok('blur handler still attached', input.listenerCount('blur')===1, input.listenerCount('blur'));
  input.value='Rockford';
  input.fire('blur');
  ok('typed city written', h.legs[0].city==='Rockford', h.legs[0]);
}

console.log('3. lookup SUCCEEDS — manual entry still works');
{
  // The GSA list does not contain every city. A traveller going somewhere
  // unlisted must still be able to type it.
  const h=build({lookup:{success:true,cities:['CHICAGO','SPRINGFIELD'],source:'GSA'}});
  const input=h.el('legCity_L1');
  await h.run("Controller._loadLegCities('L1',{country:'United States',state:'IL'})");
  await sleep(5);
  ok('blur handler attached on the success path too', input.listenerCount('blur')===1,
     input.listenerCount('blur'));
  input.value='Galena';
  input.fire('blur');
  ok('unlisted city accepted', h.legs[0].city==='Galena', h.legs[0]);
}

console.log('4. a failed Awesomplete construction does not remove manual entry');
{
  // Previously the blur binding lived inside `if (awInstance)`, so a null
  // instance silently removed the only way to enter a city.
  const h=build({lookup:{success:true,cities:['CHICAGO'],source:'GSA'},awInstance:null});
  const input=h.el('legCity_L1');
  await h.run("Controller._loadLegCities('L1',{country:'United States',state:'IL'})");
  await sleep(5);
  ok('still bound', input.listenerCount('blur')===1, input.listenerCount('blur'));
  input.value='Moline';
  input.fire('blur');
  ok('city captured', h.legs[0].city==='Moline', h.legs[0]);
}

console.log('5. binding is idempotent and does not clobber');
{
  const h=build({lookup:{success:true,cities:['CHICAGO'],source:'GSA'}});
  const input=h.el('legCity_L1');
  await h.run("Controller._loadLegCities('L1',{country:'United States',state:'IL'})");
  await sleep(5);
  // Both the success path and a re-init call _bindLegCityManualEntry.
  h.run("Controller._bindLegCityManualEntry('L1')");
  h.run("Controller._bindLegCityManualEntry('L1')");
  ok('exactly one listener', input.listenerCount('blur')===1, input.listenerCount('blur'));
  input.value='Aurora';
  input.fire('blur');
  ok('written once', h.legs[0].city==='Aurora');
  ok('one recheck, not three', h.recheck.length===1, h.recheck.length);

  // Blurring an empty field must not erase a chosen city.
  input.value='   ';
  input.fire('blur');
  ok('blank blur does not clear the city', h.legs[0].city==='Aurora', h.legs[0]);

  // Re-blurring an unchanged value must not re-trigger downstream work.
  const before=h.recheck.length;
  input.value='Aurora';
  input.fire('blur');
  ok('unchanged value is a no-op', h.recheck.length===before, h.recheck.length);
}

console.log('6. the binding is not conditional on the lookup result');
{
  const src=fs.readFileSync('lets_app/client/controllers/form/travelRequestItinerary.html','utf8');
  const i=src.indexOf('Controller._setupLegCityAutocomplete =');
  const body=src.slice(i, src.indexOf('Controller._resetLegCityAutocomplete ='));
  // The call must sit OUTSIDE the `if (awInstance)` block.
  // Slice from `if (awInstance) {` to its CLOSING brace, not to the end of the
  // function — the previous form ran past the block and matched the
  // unconditional call that follows it, so the check could never fail.
  const openAt=body.indexOf('if (awInstance) {');
  const closeAt=body.indexOf('\n    }', openAt);
  const awBlock=body.slice(openAt, closeAt);
  ok('manual-entry binding is outside if(awInstance)',
     awBlock.indexOf('_bindLegCityManualEntry')===-1, awBlock.slice(-120));
  ok('and is called unconditionally', /this\._bindLegCityManualEntry\(legId\);/.test(body));
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
})();
