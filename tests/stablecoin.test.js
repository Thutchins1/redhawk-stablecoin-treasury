import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {pegDeviationBps,treasuryRisk,replayDepeg,narrative,defaultPolicy} from '../lib/stablecoin.js';
import {minor} from '../lib/finance.js';
import {createServer} from '../server.js';
const load=async n=>JSON.parse(await fs.readFile(new URL(`../data/${n}.json`,import.meta.url),'utf8'));

test('peg deviation in basis points is signed and rounded half away from zero',()=>{
 assert.equal(pegDeviationBps('1.000000'),0);assert.equal(pegDeviationBps('0.990000'),-100);assert.equal(pegDeviationBps('1.020000'),200);
 assert.equal(pegDeviationBps('0.960264'),-397);assert.equal(pegDeviationBps('0.999950'),-1);assert.equal(pegDeviationBps('0.999949'),-1);assert.equal(pegDeviationBps('0.999951'),0);
 assert.throws(()=>pegDeviationBps('1.0000001'));assert.throws(()=>pegDeviationBps('abc'));
});

test('valid input: fixture treasury scores concentration and peg state with evidence',async()=>{
 const t=await load('stablecoin_treasury'),px=await load('stablecoin_prices');
 const r=treasuryRisk({holdings:t.holdings,prices:px.current.prices,policy:t.policy,asOf:px.current.retrieved});
 assert.equal(r.parValue,'250000.00');
 // Every holding value sums to the total, to the cent.
 assert.equal(r.holdings.reduce((s,h)=>s+minor(h.value),0n),minor(r.totalValue));
 assert.equal(r.holdings.reduce((s,h)=>s+h.shareBps,0)>=9998,true);
 assert.equal(r.concentration.largestIssuer,'Circle');assert.ok(r.concentration.largestShareBps>5000);
 assert.equal(r.alerts.filter(a=>a.rule==='issuer_concentration').length,1);
 assert.equal(r.alerts.filter(a=>a.rule==='peg_deviation').length,0,'current prices are within 50 bps');
 for(const h of r.holdings){assert.equal(h.level,'ok');assert.match(h.priceSource,/CoinGecko/);}
});

test('missing or invalid input is rejected, not guessed',async()=>{
 const t=await load('stablecoin_treasury'),px=await load('stablecoin_prices');
 assert.throws(()=>treasuryRisk({holdings:t.holdings,prices:{USDC:px.current.prices.USDC}}),/No price supplied for USDT/);
 assert.throws(()=>treasuryRisk({holdings:[],prices:px.current.prices}),/At least one holding/);
 assert.throws(()=>treasuryRisk({holdings:[{asset:'USDC',issuer:'Circle',units:'1.0000001'}],prices:px.current.prices}),/six places/);
 assert.throws(()=>treasuryRisk({holdings:[{asset:'USDC',issuer:'Circle',units:'1'},{asset:'USDC',issuer:'Circle',units:'1'}],prices:px.current.prices}),/repeated asset/);
 assert.throws(()=>treasuryRisk({holdings:t.holdings,prices:px.current.prices,policy:{pegWarningBps:300,pegCriticalBps:200}}),/Warning threshold/);
 assert.throws(()=>treasuryRisk({holdings:t.holdings,prices:px.current.prices,policy:{maxIssuerShareBps:1.5}}),/basis points/);
 assert.throws(()=>replayDepeg({holdings:t.holdings,series:{dates:['2023-03-09'],prices:{USDC:{}}}}),/No USDC price for 2023-03-09/);
});

test('thresholds are inclusive and alerts carry the triggering price',()=>{
 const holdings=[{asset:'AAA',issuer:'A',units:'100.000000'},{asset:'BBB',issuer:'B',units:'100.000000'}];
 const r=treasuryRisk({holdings,prices:{AAA:{price:'0.995000',source:'test'},BBB:{price:'0.980000',source:'test'}},policy:{pegWarningBps:50,pegCriticalBps:200}});
 assert.deepEqual(r.holdings.map(h=>h.level),['warning','critical']);
 assert.equal(r.alerts[0].severity,'high');assert.equal(r.alerts[0].asset,'BBB');assert.equal(r.alerts[0].evidence.price,'0.980000');
 assert.ok(r.concentration.hhi>=5000&&r.concentration.hhi<=5010,'two near-equal issuers score close to 5000');
});

test('March 2023 replay: policy sells at the bottom and ends behind holding; values reconcile',async()=>{
 const t=await load('stablecoin_treasury'),px=await load('stablecoin_prices');
 const r=replayDepeg({holdings:t.holdings,series:px.march2023,policy:t.policy});
 assert.equal(r.days.length,6);
 // No action before the critical day; both paths identical.
 for(const d of r.days.slice(0,3))assert.equal(d.hold.value,d.policy.value);
 assert.equal(r.actions.length,2);assert.ok(r.actions.every(a=>a.date==='2023-03-12'));
 assert.deepEqual(r.actions.map(a=>a.sold.asset).sort(),['DAI','USDC']);assert.ok(r.actions.every(a=>a.bought.asset==='USDT'));
 // Policy locked in a shortfall that holding recovered.
 assert.ok(minor(r.result.policyFinal)<minor(r.result.holdFinal));
 assert.equal(minor(r.result.policyMinusHold,{signed:true}),minor(r.result.policyFinal)-minor(r.result.holdFinal));
 assert.ok(minor(r.result.realizedShortfallVersusPar)>0n);
 // Hold path on the last day equals a direct valuation at that day's prices.
 const direct=treasuryRisk({holdings:t.holdings,prices:Object.fromEntries(Object.entries(px.march2023.prices).map(([a,s])=>[a,{price:s['2023-03-14']}])),policy:t.policy});
 assert.equal(r.days[5].hold.value,direct.totalValue);
 // Unit conservation on the sold assets: remaining = original − sold.
 const usdc=r.result.finalHoldings.find(h=>h.asset==='USDC');const sold=r.actions.find(a=>a.sold.asset==='USDC').sold.units;
 assert.equal(minor(usdc.units,{scale:6}),minor('150000.000000',{scale:6})-minor(sold,{scale:6}));
 assert.match(r.summary,/behind/);
});

test('an asset trading above par is flagged critical but never sold',()=>{
 const series={dates:['d1'],prices:{AAA:{d1:'1.030000'},BBB:{d1:'1.000000'}}};
 const holdings=[{asset:'AAA',issuer:'A',units:'10.000000'},{asset:'BBB',issuer:'B',units:'10.000000'}];
 const risk=treasuryRisk({holdings,prices:{AAA:{price:'1.030000'},BBB:{price:'1.000000'}}});
 assert.equal(risk.holdings[0].level,'critical');assert.match(risk.alerts[0].message,/does not sell premium/);
 const r=replayDepeg({holdings,series});assert.equal(r.actions.length,0);assert.equal(r.result.policyMinusHold,'0.00');
 assert.match(risk.policy.note,/act at 2\.00%/);assert.match(treasuryRisk({holdings,prices:{AAA:{price:'1.000000'},BBB:{price:'1.000000'}},policy:{pegCriticalBps:100}}).policy.note,/act at 1\.00%/);
});

test('replay with no breach matches holding exactly',()=>{
 const series={dates:['d1','d2'],prices:{AAA:{d1:'1.000000',d2:'0.999000'}}};
 const r=replayDepeg({holdings:[{asset:'AAA',issuer:'A',units:'10.000000'}],series});
 assert.equal(r.actions.length,0);assert.equal(r.result.policyMinusHold,'0.00');assert.match(r.summary,/matches holding exactly/);
});

test('narrative is built only from computed fields',async()=>{
 const t=await load('stablecoin_treasury'),px=await load('stablecoin_prices');
 const risk=treasuryRisk({holdings:t.holdings,prices:px.current.prices,policy:t.policy,asOf:'2026-11-06'});
 const lines=narrative(risk,replayDepeg({holdings:t.holdings,series:px.march2023,policy:t.policy}));
 assert.ok(lines[0].includes(risk.totalValue));assert.ok(lines.some(l=>l.startsWith('MEDIUM: Circle')));assert.ok(lines.at(-1).startsWith('Replay of'));
});

test('treasury API routes serve fixture, accept custom policy and reject bad input',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const risk=await (await fetch(base+'/api/treasury')).json();assert.equal(risk.parValue,'250000.00');assert.equal(risk.policy.pegCriticalBps,defaultPolicy.pegCriticalBps);
  const replay=await (await fetch(base+'/api/treasury/replay')).json();assert.equal(replay.actions.length,2);
  const custom=await fetch(base+'/api/treasury',{method:'POST',body:JSON.stringify({holdings:[{asset:'USDC',issuer:'Circle',units:'10.000000'}],policy:{maxIssuerShareBps:10000}})});assert.equal(custom.status,200);assert.equal((await custom.json()).alerts.length,0);
  const bad=await fetch(base+'/api/treasury',{method:'POST',body:JSON.stringify({holdings:[{asset:'XYZ',issuer:'Nobody',units:'1'}]})});assert.equal(bad.status,400);assert.match((await bad.json()).error,/No price supplied for XYZ/);
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);
  const explain=await (await fetch(base+'/api/treasury/explain',{method:'POST',body:'{}'})).json();assert.ok(Array.isArray(explain.lines)&&explain.lines.length>=3);assert.equal(explain.method,'deterministic template');
 }finally{await new Promise(r=>server.close(r));}
});
