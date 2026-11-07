// Challenge 28: stablecoin treasury risk monitor.
// Deterministic peg-deviation and issuer-concentration scoring, plus a replay of a past depeg against a stated policy.
// All arithmetic is BigInt: token units carry six decimals, prices six decimals, USD values are integer cents.
import {minor,amount,divideRound} from './finance.js';

const PRICE_SCALE=6,UNIT_SCALE=6;
const TO_CENTS=10n**BigInt(PRICE_SCALE+UNIT_SCALE-2); // units(1e-6) × price(1e-6) → cents(1e-2)
const UNITS_TO_CENTS=10n**BigInt(UNIT_SCALE-2);

export const defaultPolicy={pegWarningBps:50,pegCriticalBps:200,maxIssuerShareBps:5000,rebalanceSellBps:5000};
const pct=bps=>(bps/100).toFixed(2)+'%';
export const describePolicy=p=>`Team assumption for the demo: warn at ${pct(p.pegWarningBps)} off peg either way, act at ${pct(p.pegCriticalBps)}, cap any single issuer at ${pct(p.maxIssuerShareBps)} of the treasury. On a critical breach below $1.00, sell ${pct(p.rebalanceSellBps)} of that asset into the best-pegged healthy asset from a different issuer, or hold USD cash if none qualifies. Assets trading above $1.00 are flagged, never sold. Not regulatory guidance.`;

// Signed basis points away from $1.00, half-away-from-zero rounding.
export function pegDeviationBps(price){const p=minor(price,{scale:PRICE_SCALE});return Number(divideRound((p-1_000_000n)*10_000n,1_000_000n));}

function checkPolicy(policy){
 for(const k of ['pegWarningBps','pegCriticalBps','maxIssuerShareBps','rebalanceSellBps']){const v=policy[k];if(!Number.isInteger(v)||v<0||v>10000)throw Error(`Policy ${k} must be an integer between 0 and 10000 basis points`);}
 if(policy.pegWarningBps>policy.pegCriticalBps)throw Error('Warning threshold cannot exceed critical threshold');
 return policy;
}
function checkHoldings(holdings){
 if(!Array.isArray(holdings)||!holdings.length)throw Error('At least one holding required');
 const seen=new Set();
 return holdings.map((h,i)=>{
  if(!h||typeof h.asset!=='string'||!/^[A-Z0-9]{2,10}$/.test(h.asset))throw Error(`Holding ${i+1}: asset symbol required (2–10 upper-case characters)`);
  if(typeof h.issuer!=='string'||!h.issuer.trim())throw Error(`Holding ${i+1}: issuer required`);
  if(seen.has(h.asset))throw Error(`Holding ${i+1}: repeated asset ${h.asset}`);seen.add(h.asset);
  let units;try{units=minor(h.units,{scale:UNIT_SCALE});}catch{throw Error(`Holding ${i+1}: units must be a non-negative decimal with at most six places`);}
  return {asset:h.asset,issuer:h.issuer.trim(),units};
 });
}
function priceOf(prices,asset){
 const p=prices?.[asset];if(!p||typeof p.price!=='string')throw Error(`No price supplied for ${asset}`);
 let micro;try{micro=minor(p.price,{scale:PRICE_SCALE});}catch{throw Error(`Invalid price for ${asset}`);}
 return {micro,text:p.price,source:p.source||'unspecified',retrieved:p.retrieved||null};
}
const levelOf=(absBps,policy)=>absBps>=policy.pegCriticalBps?'critical':absBps>=policy.pegWarningBps?'warning':'ok';
const mergePolicy=p=>{const m=checkPolicy({...defaultPolicy,...p});return {...m,note:describePolicy(m)};};

export function treasuryRisk({holdings,prices,policy={},asOf='unspecified'}){
 policy=mergePolicy(policy);const rows=checkHoldings(holdings);
 let total=0n,par=0n;
 const valued=rows.map(h=>{const p=priceOf(prices,h.asset);const value=divideRound(h.units*p.micro,TO_CENTS);const atPar=divideRound(h.units,UNITS_TO_CENTS);total+=value;par+=atPar;const deviationBps=pegDeviationBps(p.text);return {...h,price:p,value,atPar,deviationBps,level:levelOf(Math.abs(deviationBps),policy)};});
 if(total<=0n)throw Error('Treasury value must be positive');
 const shareBps=v=>Number(divideRound(v*10_000n,total));
 const byIssuer=new Map();for(const v of valued)byIssuer.set(v.issuer,(byIssuer.get(v.issuer)||0n)+v.value);
 const issuers=[...byIssuer].map(([issuer,value])=>({issuer,value:amount(value),shareBps:shareBps(value)})).sort((a,b)=>b.shareBps-a.shareBps);
 const hhi=Math.round(issuers.reduce((s,r)=>s+r.shareBps*r.shareBps,0)/10000); // issuer share in percent, squared and summed: 10000 = one issuer
 const alerts=[];
 for(const v of valued){
  if(v.level==='ok')continue;
  const dir=v.deviationBps<0?'below':'above';const critical=v.level==='critical';
  alerts.push({severity:critical?'high':'medium',rule:'peg_deviation',asset:v.asset,message:`${v.asset} is ${Math.abs(v.deviationBps)} bps ${dir} $1.00 at ${v.price.text}. Marked value USD ${amount(v.value)} versus USD ${amount(v.atPar)} at par. ${critical?(v.deviationBps<0?'Policy action threshold reached.':'Action threshold reached above par; policy flags but does not sell premium assets.'):'Watch threshold reached; no action required.'}`,evidence:{price:v.price.text,source:v.price.source,retrieved:v.price.retrieved,thresholdBps:critical?policy.pegCriticalBps:policy.pegWarningBps},method:'deterministic'});
 }
 for(const r of issuers){
  if(r.shareBps<=policy.maxIssuerShareBps)continue;
  alerts.push({severity:'medium',rule:'issuer_concentration',issuer:r.issuer,message:`${r.issuer} backs ${pct(r.shareBps)} of the treasury, above the ${pct(policy.maxIssuerShareBps)} cap. A freeze or failure at this issuer would touch USD ${r.value}.`,evidence:{shareBps:r.shareBps,capBps:policy.maxIssuerShareBps},method:'deterministic'});
 }
 alerts.sort((a,b)=>(a.severity==='high'?0:1)-(b.severity==='high'?0:1));
 return {
  asOf,currency:'USD',headline:headline(alerts,policy),totalValue:amount(total),parValue:amount(par),markVersusPar:amount(total-par),
  holdings:valued.map(v=>({asset:v.asset,issuer:v.issuer,units:amount(v.units,UNIT_SCALE),price:v.price.text,priceSource:v.price.source,priceRetrieved:v.price.retrieved,value:amount(v.value),atPar:amount(v.atPar),shareBps:shareBps(v.value),deviationBps:v.deviationBps,level:v.level})),
  issuers,
  concentration:{hhi,effectiveIssuers:hhi?Math.round(1_000_000/hhi)/100:null,largestIssuer:issuers[0]?.issuer??null,largestShareBps:issuers[0]?.shareBps??null,capBps:policy.maxIssuerShareBps},
  alerts,policy,
  assumptions:'Units six decimals, prices six decimals, values rounded half away from zero to USD cents. Peg deviation reflects the supplied price snapshot only. Herfindahl index uses issuer share in percent squared (10000 = a single issuer).'
 };
}

// One-line status for the top of the page, derived only from the alert list.
export function headline(alerts,policy){
 const issue=a=>a.rule==='peg_deviation'?`${a.asset} is ${Math.abs(a.evidence.price?pegDeviationBps(a.evidence.price):0)} bps ${a.message.includes(' below ')?'below':'above'} $1.00`:`${a.issuer} is ${pct(a.evidence.shareBps)} of the treasury, over the ${pct(a.evidence.capBps)} cap`;
 if(!alerts.length)return {status:'ok',text:`All clear. Every coin is within ${pct(policy.pegWarningBps)} of $1.00 and no issuer is over the ${pct(policy.maxIssuerShareBps)} cap.`};
 const high=alerts.filter(a=>a.severity==='high');
 if(high.length)return {status:'critical',text:`Act now. ${high.map(issue).join('; ')}. Policy action threshold reached.`};
 return {status:'warning',text:`Watch. ${alerts.map(issue).join('; ')}.`};
}

const worst=risk=>risk.holdings.reduce((w,h)=>!w||Math.abs(h.deviationBps)>Math.abs(w.deviationBps)?h:w,null);
const toRows=list=>list.map(h=>({asset:h.asset,issuer:h.issuer,units:amount(h.units,UNIT_SCALE)}));

// Replay a dated price series against the policy. The "hold" path never trades; the "policy" path sells a critical asset per the rule.
export function replayDepeg({holdings,series,policy={}}){
 policy=mergePolicy(policy);
 if(!series||!Array.isArray(series.dates)||!series.dates.length||!series.prices)throw Error('Price series with dates and prices required');
 const dayPrices=d=>Object.fromEntries(Object.entries(series.prices).map(([asset,byDate])=>{const p=byDate?.[d];if(typeof p!=='string')throw Error(`No ${asset} price for ${d}`);return [asset,{price:p,source:series.source,retrieved:series.retrieved}];}));
 const hold=checkHoldings(holdings);const live=hold.map(h=>({...h}));let cash=0n,shortfall=0n;const actions=[],days=[];
 for(const date of series.dates){
  const prices=dayPrices(date);
  const holdRisk=treasuryRisk({holdings:toRows(hold),prices,policy,asOf:date});
  const before=treasuryRisk({holdings:toRows(live),prices,policy,asOf:date});
  const todays=[];
  for(const row of before.holdings){
   if(row.level!=='critical'||row.deviationBps>=0)continue; // sell only when below peg; a premium is flagged, not dumped
   const src=live.find(h=>h.asset===row.asset);const sellUnits=divideRound(src.units*BigInt(policy.rebalanceSellBps),10_000n);if(sellUnits<=0n)continue;
   const price=minor(row.price,{scale:PRICE_SCALE});const proceeds=divideRound(sellUnits*price,TO_CENTS);const parOfSold=divideRound(sellUnits,UNITS_TO_CENTS);
   const target=before.holdings.filter(t=>t.level==='ok'&&t.issuer!==row.issuer).sort((a,b)=>Math.abs(a.deviationBps)-Math.abs(b.deviationBps))[0];
   src.units-=sellUnits;let bought;
   if(target){const tp=minor(target.price,{scale:PRICE_SCALE});const units=divideRound(proceeds*TO_CENTS,tp);live.find(h=>h.asset===target.asset).units+=units;bought={asset:target.asset,units:amount(units,UNIT_SCALE),price:target.price};}
   else{cash+=proceeds;bought={asset:'USD cash',units:amount(proceeds),price:'1.000000'};}
   shortfall+=parOfSold-proceeds;
   todays.push({date,rule:'critical_peg_rebalance',sold:{asset:row.asset,units:amount(sellUnits,UNIT_SCALE),price:row.price,proceeds:amount(proceeds),shortfallVersusPar:amount(parOfSold-proceeds)},bought});
  }
  actions.push(...todays);
  const after=treasuryRisk({holdings:toRows(live),prices,policy,asOf:date});
  const policyValue=minor(after.totalValue)+cash;
  const w=worst(holdRisk);
  days.push({date,hold:{value:holdRisk.totalValue,worstAsset:w.asset,worstBps:w.deviationBps,level:w.level},policy:{value:amount(policyValue),cash:amount(cash),actions:todays.length,alerts:after.alerts.length}});
 }
 const last=days[days.length-1];const diff=minor(last.policy.value)-minor(last.hold.value);
 const summary=actions.length
  ?`Over ${days.length} days the policy triggered ${actions.length} sale${actions.length===1?'':'s'} and ended USD ${amount(diff<0n?-diff:diff)} ${diff<0n?'behind':'ahead of'} simply holding. Selling below par locked in USD ${amount(shortfall)} of shortfall that holding would have recovered by ${last.date}.`
  :`Over ${days.length} days no asset crossed the ${pct(policy.pegCriticalBps)} action threshold, so the policy path matches holding exactly.`;
 return {label:series.label||'replay',source:series.source,retrieved:series.retrieved,days,actions,result:{holdFinal:last.hold.value,policyFinal:last.policy.value,policyMinusHold:amount(diff),realizedShortfallVersusPar:amount(shortfall),finalHoldings:toRows(live),cash:amount(cash)},summary,policy,assumptions:'Daily 00:00 UTC snapshot prices; a rule that fires is executed at that snapshot with no slippage, fees or settlement delay. Only assets below $1.00 are sold. Hold path never trades. Values are mark-to-market in USD cents.'};
}

// Plain-English readout built from computed numbers only. No model generates figures.
export function narrative(risk,replay){
 const lines=[];
 lines.push(risk.headline.text);
 lines.push(`As of ${risk.asOf}, the treasury is worth USD ${risk.totalValue} at market against USD ${risk.parValue} at par (${risk.markVersusPar} difference).`);
 const c=risk.concentration;lines.push(`${c.largestIssuer} is the largest issuer at ${pct(c.largestShareBps)}; the Herfindahl score is ${c.hhi} (${c.effectiveIssuers} effective issuers).`);
 if(!risk.alerts.length)lines.push('No peg or concentration alerts under the stated policy.');
 for(const a of risk.alerts)lines.push(`${a.severity.toUpperCase()}: ${a.message}`);
 if(replay)lines.push(`Replay of ${replay.label}: ${replay.summary}`);
 return lines;
}
