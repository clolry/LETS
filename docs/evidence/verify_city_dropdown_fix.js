/**
 * Verifies the itinerary city-dropdown change by EXECUTING the two pieces
 * of client logic that were rewritten, against the real source.
 *
 * No browser, no network. Awesomplete is stubbed so the shapes passed to
 * it can be asserted — the point is to prove the input VALUE stays a bare
 * city name while the rate text is display-only.
 */
const fs=require('fs'), path=require('path');
const APP='/Users/ozelkirkland/Documents/Projects/LETS/lets_app';
const html=fs.readFileSync(path.join(APP,'client/shared/travelLocationService.html'),'utf8');
const js=/<script>([\s\S]*)<\/script>/.exec(html)[1];

// --- minimal DOM + Awesomplete stubs
const listeners={};
function makeEl(){return{
  value:'', placeholder:'', _lastCommittedState:undefined,
  addEventListener(ev,fn){(listeners[ev]=listeners[ev]||[]).push(fn);},
  ul:{childNodes:[],hasAttribute:()=>false},
};}
let lastAwesompleteConfig=null;
global.window={Awesomplete:function(input,cfg){lastAwesompleteConfig=cfg;this.input=input;this.ul={childNodes:[],hasAttribute:()=>false};this.evaluate=()=>{};this.open=()=>{};this.destroy=()=>{};}};
// setupStateAutocomplete guards on window.TravelUtils (not the bare global),
// so the stub must live there too or the function returns null and every
// state assertion below vacuously "passes" by doing nothing.

global.Awesomplete=global.window.Awesomplete;
global.document={createElement:(t)=>({tagName:t,className:'',innerHTML:'',textContent:'',children:[],setAttribute(){},appendChild(c){this.children.push(c);}})};
global.google={script:{run:{}}};
global.TravelUtils={
  US_STATES:[{abbr:'VA',name:'Virginia'},{abbr:'CA',name:'California'},{abbr:'HI',name:'Hawaii'}],
  isValidState:a=>['VA','CA','HI'].includes(String(a).toUpperCase()),
  isOCONUS:a=>['AK','HI','PR','VI','GU','AS','MP'].includes(String(a).toUpperCase()),
};
global.window.TravelUtils=global.TravelUtils;
global.console=console;
const mod=new Function('window','document','google','TravelUtils','Awesomplete',
  js.replace(/window\.TravelLocationService\s*=/, 'return'));
const TLS=mod(global.window,global.document,global.google,global.TravelUtils,global.Awesomplete);

let fails=0;
const ok=(name,cond,detail)=>{ if(!cond)fails++; console.log((cond?'  PASS  ':'!!FAIL  ')+name+(detail?'\n          '+detail:'')); };

console.log('\n[1] processCityList accepts BOTH shapes, always emits objects');
const fromStrings=TLS.processCityList(['Richmond','Tampa / St. Petersburg','Other locations','']);
ok('plain strings -> objects', fromStrings.every(c=>typeof c==='object'&&c.city));
ok('compound name split into two', fromStrings.filter(c=>/Tampa|Petersburg/.test(c.city)).length===2);
ok('"Other locations" excluded', !fromStrings.some(c=>/other/i.test(c.city)));
ok('alphabetical', JSON.stringify(fromStrings.map(c=>c.city))===JSON.stringify(fromStrings.map(c=>c.city).slice().sort((a,b)=>a.localeCompare(b))),
   JSON.stringify(fromStrings.map(c=>c.city)));

const fromObjects=TLS.processCityList([
  {city:'Richmond',mie:68,lodgingLow:107,lodgingHigh:131,county:'Richmond City',isStandard:false},
  {city:'Tampa / St. Petersburg',mie:80,lodgingLow:150,lodgingHigh:220},
]);
ok('rate fields preserved', fromObjects.find(c=>c.city==='Richmond').mie===68);
ok('compound halves inherit the same rates',
   fromObjects.filter(c=>c.mie===80).length===2,
   JSON.stringify(fromObjects.map(c=>c.city+':'+c.mie)));

console.log('\n[2] formatCityRateHint');
ok('range + M&IE', TLS.formatCityRateHint({lodgingLow:107,lodgingHigh:131,mie:68})==='$107-131 lodging \u00b7 $68 M&IE',
   TLS.formatCityRateHint({lodgingLow:107,lodgingHigh:131,mie:68}));
ok('flat rate collapses to one figure', TLS.formatCityRateHint({lodgingLow:96,lodgingHigh:96,mie:59})==='$96 lodging \u00b7 $59 M&IE');
ok('no rates -> empty string (DoD/DOS rows stay plain)', TLS.formatCityRateHint({city:'Tokyo'})==='');
ok('mie 0 is omitted, not shown as $0', TLS.formatCityRateHint({mie:0})==='');

console.log('\n[3] setupCityAutocomplete: input VALUE is the bare city name');
const inp=makeEl();
TLS.setupCityAutocomplete(inp, fromObjects, {});
const cfg=lastAwesompleteConfig;
ok('list entries carry label+value+hint', cfg.list.every(i=>i.label&&i.value&&'hint' in i));
ok('value === city name, no rate text', cfg.list.every(i=>!/\$/.test(i.value)),
   JSON.stringify(cfg.list.map(i=>i.value)));
const fakeInstance={input:{value:''}};
cfg.replace.call(fakeInstance,{label:'Richmond',value:'Richmond'});
ok('replace() writes only the city name', fakeInstance.input.value==='Richmond', 'got: '+fakeInstance.input.value);
const li=cfg.item({label:'Richmond',value:'Richmond'},'rich');
ok('rendered row has a name span', li.children.length>=1);
ok('rendered row has a rate span when rates exist', li.children.length===2);
ok('rate span uses textContent (not innerHTML)', li.children[1] && li.children[1].textContent.includes('$107-131'));
const liNoRate=cfg.item({label:'Nowhere',value:'Nowhere'},'');
ok('row without rates omits the rate span', liNoRate.children.length===1);

console.log('\n[4] THE BUG: state commits on blur, so cities load when TYPED');
let committed=[];
const st=makeEl();
Object.keys(listeners).forEach(k=>delete listeners[k]);
const stInstance=TLS.setupStateAutocomplete(st,{onSelect:v=>committed.push(v),showFullName:true});
ok('setupStateAutocomplete returned an instance (guard satisfied)', !!stInstance,
   'null means the function bailed and the assertions below prove nothing');
st.value='va';
(listeners['blur']||[]).forEach(fn=>fn.call(st));
ok('typing "va" + blur commits "VA"', committed.length===1&&committed[0]==='VA', 'committed: '+JSON.stringify(committed));
ok('input normalized to uppercase', st.value==='VA');
(listeners['blur']||[]).forEach(fn=>fn.call(st));
ok('second blur does NOT re-fire (no duplicate city load)', committed.length===1, 'committed: '+JSON.stringify(committed));
committed=[]; st._lastCommittedState=undefined; st.value='California';
(listeners['blur']||[]).forEach(fn=>fn.call(st));
ok('full state name resolves to abbreviation', committed[0]==='CA'&&st.value==='CA', 'committed: '+JSON.stringify(committed)+' value: '+st.value);
committed=[]; st._lastCommittedState=undefined; st.value='Zzz';
(listeners['blur']||[]).forEach(fn=>fn.call(st));
ok('non-state commits nothing', committed.length===0, 'committed: '+JSON.stringify(committed));

console.log('\n'+'='.repeat(66));
console.log(fails===0?'ALL CHECKS PASSED':fails+' CHECK(S) FAILED');
process.exit(fails?1:0);
