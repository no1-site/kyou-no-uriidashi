import test from 'node:test';
import assert from 'node:assert/strict';
import { yahooInterval, createYahooTransport, retryAfterSeconds } from '../lib/yahoo-rate-limit.mjs';
import { runDryRunSequence } from '../lib/dry-run-sequence.mjs';

for (const value of ['0','1100','1999','2000','2199','NaN','Infinity','2147483648','-1']) {
  test(`Yahoo rejects unsafe interval setting ${value} before sending`,()=>assert.throws(()=>yahooInterval(value),/at least 2200ms/));
}
test('Yahoo default and configured interval cannot go below 2200ms',()=>{
  assert.equal(yahooInterval(),2200);assert.equal(yahooInterval(''),2200);assert.equal(yahooInterval('2200'),2200);assert.equal(yahooInterval('3000'),3000);
});
test('100 sequential Yahoo requests remain below 30 per sliding minute; early wakeups cannot shorten spacing',async()=>{
  let time=0;const starts=[];let result;
  const request=createYahooTransport({now:()=>time,sleep:async ms=>{time+=Math.min(ms,1100);},fetcher:async()=>{starts.push(time);time+=50;return new Response('{}');},report:m=>{result=m;}});
  for(let i=0;i<100;i++)await request('not-logged');
  for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=2200);
  for(const start of starts)assert.ok(starts.filter(t=>t>=start&&t<start+60000).length<=30);
  assert.equal(result.requests,100);assert.equal(result.averageIntervalMs,2250);assert.equal(result.minimumIntervalMs,2250);assert.equal(result.rateLimited,0);
  assert.equal(result.elapsedSeconds,(starts.at(-1)+50)/1000);
});
test('Yahoo transport forbids overlapping calls and records only normalized Retry-After, with no retry',async()=>{
  let release;let calls=0;let metrics;
  const request=createYahooTransport({fetcher:()=>{calls++;return new Promise(done=>{release=done;});},report:m=>{metrics=m;}});
  const first=request('private-url');await assert.rejects(request('private-url'),/Parallel/);
  release(new Response('',{status:429,headers:{'Retry-After':'65'}}));await first;
  assert.equal(calls,1);assert.equal(metrics.rateLimited,1);assert.equal(metrics.retryAfterSeconds,65);
  assert.doesNotMatch(JSON.stringify(metrics),/private|https|appid/);
  assert.equal(retryAfterSeconds('https://secret.invalid'),null);assert.equal(retryAfterSeconds('not-a-header'),null);
  assert.equal(retryAfterSeconds('Wed, 01 Jan 2025 00:01:05 GMT',Date.parse('2025-01-01T00:00:00Z')),65);
});
const success=()=>({ok:true,metrics:{apiErrors:0,rateLimited:0},yahooTiming:{rateLimited:0}});
test('20 → 65 seconds → 50 → 65 seconds → 100 is sequential with mandatory cooldown',async()=>{
  let time=0;const starts=[];
  const result=await runDryRunSequence({now:()=>time,sleep:async ms=>{assert.ok(ms<=30000);time+=ms/2; if(ms<1)time+=1;},
    run:async target=>{starts.push([target,time]);time+=123;return success();}});
  assert.equal(result.ok,true);assert.deepEqual(starts.map(p=>p[0]),[20,50,100]);
  assert.equal(result.cooldownsMilliseconds.length,2);assert.ok(result.cooldownsMilliseconds.every(ms=>ms>=65000));
  assert.ok(starts[1][1]-starts[0][1]-123>=65000);assert.ok(starts[2][1]-starts[1][1]-123>=65000);
});
for(const bad of [{ok:false},{...success(),metrics:{apiErrors:1,rateLimited:0}}, {...success(),metrics:{apiErrors:1,rateLimited:1}}, {...success(),metrics:{apiErrors:0,rateLimited:0,budgetExceeded:true}}]) {
  test(`sequence stops before next stage on ${JSON.stringify(bad)}`,async()=>{
    const starts=[];const result=await runDryRunSequence({run:async target=>{starts.push(target);return bad;},sleep:()=>assert.fail('must stop without cooldown or retry')});
    assert.equal(result.ok,false);assert.deepEqual(starts,[20]);
  });
}
test('50-stage failure prevents the 100 stage',async()=>{
  let time=0;const targets=[];
  const result=await runDryRunSequence({now:()=>time,sleep:async ms=>{time+=ms;},run:async target=>{targets.push(target);return target===20?success():{ok:false};}});
  assert.equal(result.ok,false);assert.deepEqual(targets,[20,50]);assert.equal(time,65000);
});
