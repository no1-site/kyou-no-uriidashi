import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { allocateCategories, validateCatalog, collectCatalog, catalogIdentity, mergeConfirmedCatalog } from "../lib/product-catalog.mjs";
import { createBudgetedFetch } from "../lib/api-budget.mjs";
import { buildComparison } from "../lib/rakuten-comparison.mjs";
import { finalizeProducts, validatePublication } from "../lib/publication.mjs";
import { collectStagedProducts } from "../lib/staged-collection.mjs";
import { runDryRun } from "../lib/dry-run.mjs";
import { canRankPriceOffers, includedOffers, postageLabel, shippingPolicyVersion } from "../../shipping-policy.mjs";
const config = JSON.parse(await readFile(new URL("../../config/tracking.json", import.meta.url)));
const names = config.categories.map(c => c.category);
function jan(i) {
  const body = String(490000000000 + i);
  const sum = [...body].reduce((n,d,i)=>n+Number(d)*(i%2?3:1),0);
  return body + (10-sum%10)%10;
}
function entry(i, category = names[0]) { return { jan: jan(i), name: `製品${i}`, brand: "", model: "", capacity: "", count: "", category, enabled: true }; }
function catalog100() { let i=0; return { version:1, products: allocateCategories(config,100).flatMap(c => Array.from({length:c.quota},()=>entry(i++,c.category))) }; }
function comparison(identity) {
  return buildComparison(identity,["one","two"].map((shop,i)=>({shopCode:shop,shopName:shop,itemCode:shop+identity.jan,itemName:identity.name,itemCaption:`JAN: ${identity.jan}`,itemPrice:800+i*100,taxFlag:0,availability:1,postageFlag:0,itemUrl:`https://example.com/${shop}`}))).product;
}

test("category distribution and 20/50/100 allocation are exact and configurable", () => {
  assert.deepEqual(allocateCategories(config,100).map(c=>c.quota),[35,15,20,10,10,10]);
  assert.deepEqual(allocateCategories(config,20).map(c=>c.quota),[7,3,4,2,2,2]);
  assert.deepEqual(allocateCategories(config,50).map(c=>c.quota),[18,7,10,5,5,5]);
  const alternative=structuredClone(config); alternative.categories[0].weight=50;
  assert.notEqual(allocateCategories(alternative,100)[0].quota,35);
  assert.throws(()=>allocateCategories(config,101));
});
test("catalog rejects same JAN within and across categories, prices and malformed JAN",()=>{
  for(const category of names.slice(0,2)) assert.throws(()=>validateCatalog({version:1,products:[entry(1),entry(1,category)]},names));
  for(const change of [{jan:'123'},{price:100},{clientId:'never-allowed'},{enabled:'yes'}]) assert.throws(()=>validateCatalog({version:1,products:[{...entry(1),...change}]},names));
});
test("catalog rejects ISBN books and obvious food keyword collisions",()=>{
  const book={jan:"9784010942000",name:"IELTSブリティッシュ・カウンシル公認 本番形式問題3回分",brand:"旺文社",model:"",capacity:"",count:"",category:"日用品",enabled:true};
  assert.throws(()=>validateCatalog({version:1,products:[book]},names));
  const beautyAsFood={jan:"4901696541845",name:"ロゼット 洗顔パスタ 海泥スムース(120g)",brand:"ロゼット",model:"",capacity:"",count:"",category:"食品",enabled:true};
  assert.throws(()=>validateCatalog({version:1,products:[beautyAsFood]},names));
  const coffeeSpoon={jan:"4901601531404",name:"ベニス インスタントコーヒースプーン FA0280(1コ入)",brand:"ベニス",model:"",capacity:"",count:"",category:"食品",enabled:true};
  assert.throws(()=>validateCatalog({version:1,products:[coffeeSpoon]},names));
  const pastaStrainer={jan:"0026102078211",name:"Arc international 18－8木柄新型スパゲティーてぼ",brand:"Arcoroc",model:"RIS1101",capacity:"",count:"",category:"食品",enabled:true};
  assert.throws(()=>validateCatalog({version:1,products:[pastaStrainer]},names));
  const vacuumFreeBag={jan:"4901983802758",name:"KP掃除機のいらないふとん圧縮パック Mサイズ(1枚入)",brand:"東和産業",model:"",capacity:"",count:"",category:"家電",enabled:true};
  assert.throws(()=>validateCatalog({version:1,products:[vacuumFreeBag]},names));
  const soupSolidifier={jan:"4971902927060",name:"残った麺スープ 固めてポン カップ麺の残り汁の凝固剤(11g*12包入)",brand:"紀陽除虫菊",model:"",capacity:"",count:"",category:"食品",enabled:true};
  assert.throws(()=>validateCatalog({version:1,products:[soupSolidifier]},names));
});
for(const target of [20,50,100]) test(`tracks ${target} fixed products without discovery and validates publication`, async()=>{
  const result=await collectCatalog({catalog:catalog100(),config,target,compare:async p=>comparison(p),discover:()=>assert.fail('fixed catalog must be preferred')});
  assert.equal(result.products.length,target);
  assert.equal(new Set(result.products.map(p=>p.product_code)).size,target);
  const finalized=finalizeProducts(result.products);
  assert.equal(validatePublication(finalized,finalized),true);
  assert.equal(finalized[0].collection_summary.shipping_included_compared,target);
  const corrupted=structuredClone(finalized); corrupted.at(-1).offers[0].price=0;
  assert.throws(()=>validatePublication(corrupted));
});
test("stockout is omitted, retained for tracking, and only shortages discover; cross-category discovery deduplicates",async()=>{
  const catalog=catalog100(); const missing=catalog.products[0]; const events=[];
  const replacement=entry(200,missing.category);
  const result=await collectCatalog({catalog,config,target:100,
    compare:async p=>{events.push('track');return p.jan===missing.jan?null:comparison(p);},
    discover:async p=>{events.push('discover');assert.equal(p.category,missing.category);return [catalogIdentity(missing),catalogIdentity(replacement),catalogIdentity(replacement)];}});
  assert.equal(events.indexOf('discover'),100);
  assert.equal(result.products.length,100);
  assert.ok(!result.products.some(p=>p.product_code===missing.jan));
  const retained=mergeConfirmedCatalog(catalog,finalizeProducts(result.products),names);
  assert.ok(retained.products.some(p=>p.jan===missing.jan));
  assert.ok(retained.products.some(p=>p.jan===replacement.jan));
  const across=await collectCatalog({catalog:{version:1,products:[]},config,target:20,compare:async p=>comparison(p),discover:async p=>[catalogIdentity(entry(500,p.category))]});
  assert.equal(across.products.length,1);
});
test("disabled entries stay disabled and are not rediscovered; unit fields join identity", async()=>{
  const disabled={...entry(1),enabled:false};
  const result=await collectCatalog({catalog:{version:1,products:[disabled]},config,target:20,compare:()=>assert.fail('disabled'),discover:async()=>[catalogIdentity(disabled)]});
  assert.equal(result.products.length,0);
  const identity=catalogIdentity({...entry(2),capacity:'500ml',count:'10枚',model:'ABC123'});
  assert.match(identity.name,/500ml 10枚/);assert.equal(identity.model,'ABC123');
});
test("API request and wall-clock budgets stop BEFORE an excess request and record 429/errors without URL",async()=>{
  const dir=await mkdtemp(join(tmpdir(),'budget-'));const path=join(dir,'metrics.json');
  const initial={rakuten:0,yahoo:0,apiErrors:0,rateLimited:0,deadline:100000,limits:{rakuten:1,yahoo:1}};
  await writeFile(path,JSON.stringify(initial));let calls=0;
  const fetcher=createBudgetedFetch('rakuten',{COLLECTION_METRICS_PATH:path},async()=>{calls++;return new Response('',{status:429});},()=>0);
  await fetcher('https://example.com/?secret=DO-NOT-STORE');await assert.rejects(fetcher('secret'));
  assert.equal(calls,1);
  let state=JSON.parse(await readFile(path));assert.equal(state.rateLimited,1);assert.equal(state.apiErrors,1);assert.equal(state.budgetExceeded,true);
  assert.doesNotMatch(await readFile(path,'utf8'),/secret|DO-NOT-STORE/);
  await writeFile(path,JSON.stringify({...initial,deadline:16000}));await assert.rejects(fetcher('secret'));assert.equal(calls,1);
});
test("scaled staged pipeline persists confirmed identities only in staged history after validation and skips Keepa",async()=>{
  const dir=await mkdtemp(join(tmpdir(),'catalog-stage-'));const historyPath=join(dir,'live-history.json');await writeFile(historyPath,'{"products":{}}');
  const staging=join(dir,'stage');await mkdir(staging);const stages=[];
  const source=finalizeProducts(catalog100().products.map(p=>comparison(catalogIdentity(p))));
  const result=await collectStagedProducts({staging,historyPath,previous:[],environment:{TARGET_PRODUCT_COUNT:'100',YAHOO_CLIENT_ID:'test',KEEPA_API_KEY:'must-skip'},runStage:async(name,env)=>{
    stages.push(name);assert.equal(env.KEEPA_API_KEY,'');assert.ok(Number(env.RAKUTEN_REQUEST_INTERVAL_MS)>=1200);
    if(name==='rakuten'){await writeFile(env.RAKUTEN_OUTPUT_PATH,JSON.stringify(source));await writeFile(env.RAKUTEN_HISTORY_PATH,'{"products":{}}');}
  }});
  assert.deepEqual(stages,['rakuten','yahoo']);assert.equal(result.products.length,100);
  assert.ok(JSON.parse(result.historyBytes).confirmed_catalog.products.length>=100);
  assert.equal(await readFile(historyPath,'utf8'),'{"products":{}}');
});
test("100-target dry-run API failure never writes production or proposal; metrics survive cleanup",async()=>{
  const dir=await mkdtemp(join(tmpdir(),'catalog-dry-'));const historyPath=join(dir,'history.json');
  await writeFile(join(dir,'products.json'),'[]');await writeFile(historyPath,'{"products":{}}');
  const result=await runDryRun({repositoryPath:dir,historyPath,environment:{TARGET_PRODUCT_COUNT:'100',RAKUTEN_APPLICATION_ID:'dummy',RAKUTEN_ACCESS_KEY:'dummy',YAHOO_CLIENT_ID:'dummy'},runStage:async(name,env)=>{
    if(name==='rakuten'){
      await writeFile(env.RAKUTEN_OUTPUT_PATH,JSON.stringify(finalizeProducts(catalog100().products.map(p=>comparison(catalogIdentity(p))))));
      await writeFile(env.RAKUTEN_HISTORY_PATH,'{"products":{}}');
    }else throw Object.assign(new Error('private-url-must-not-escape'),{dryRunCode:'yahoo'});
  }});
  assert.equal(result.ok,false);assert.equal(result.errorCode,'yahoo');assert.equal(result.target,100);
  assert.equal(await readFile(join(dir,'products.json'),'utf8'),'[]');assert.equal(await readFile(historyPath,'utf8'),'{"products":{}}');
  await assert.rejects(readFile(join(dir,'.local/catalog-proposal-100.json')),{code:'ENOENT'});
});
test("100-product UI renders first 20, load-more to 100, category resets and keeps shipping/link details",async()=>{
  let click;
  const nodes=new Map(['#dealGrid','#signalScore','#signalLabel','#signalText','#dealHeading','#updated'].map(id=>[id,{textContent:'',innerHTML:'',addEventListener(){}}]));
  nodes.set('.load-more',{addEventListener:(event,fn)=>{click=fn;}});
  const context=vm.createContext({URL,console,canRankPriceOffers,includedOffers,postageLabel,shippingPolicyVersion,document:{querySelector:id=>nodes.get(id),querySelectorAll:()=>[]},window:{}});
  const source=(await readFile(new URL('../../app.js',import.meta.url),'utf8')).replace(/^import .*shipping-policy.*;\s*\n/m,'').replace(/loadDeals\(\);\s*$/,'');
  vm.runInContext(source,context);context.products=catalog100().products.map(p=>comparison(catalogIdentity(p)));
  vm.runInContext("deals=products;render('all')",context);
  const count=()=> (nodes.get('#dealGrid').innerHTML.match(/<article class="deal">/g)||[]).length;
  assert.equal(count(),20);
  for(const expected of [40,60,80,100]){click();assert.equal(count(),expected);}
  assert.doesNotMatch(nodes.get('#dealGrid').innerHTML,/class="load-more"/);
  vm.runInContext("render('食品')",context);assert.equal(count(),20);click();assert.equal(count(),25);
  assert.match(nodes.get('#dealGrid').innerHTML,/送料込み表示|offer-table/);
  assert.match(nodes.get('#dealGrid').innerHTML,/Amazonで価格を確認/);
});
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('100-product real fetch scripts integrate Yahoo, metrics and validation offline',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fetch-100-'));
  const plan=join(dir,'plan.json');const productsPath=join(dir,'products.json');const historyPath=join(dir,'history.json');const metricPath=join(dir,'metrics.json');
  await writeFile(plan,JSON.stringify({config,catalog:catalog100(),target:100}));
  await writeFile(metricPath,JSON.stringify({rakuten:0,yahoo:0,attempted:0,apiErrors:0,rateLimited:0,deadline:Date.now()+60000,limits:{rakuten:100,yahoo:100}}));
  const env={...process.env,RAKUTEN_APPLICATION_ID:'test',RAKUTEN_ACCESS_KEY:'test',YAHOO_CLIENT_ID:'test',KEEPA_API_KEY:'',RAKUTEN_AFFILIATE_ID:'',YAHOO_AFFILIATE_ID:'',
    TRACKING_PLAN_PATH:plan,COLLECTION_METRICS_PATH:metricPath,RAKUTEN_OUTPUT_PATH:productsPath,YAHOO_PRODUCTS_PATH:productsPath,RAKUTEN_HISTORY_PATH:historyPath,
    RAKUTEN_REQUEST_INTERVAL_MS:'0',YAHOO_REQUEST_INTERVAL_MS:'2200',MOCK_UPDATE_FAILURE:'',MOCK_SCENARIO:''};
  for(const stage of ['rakuten','yahoo']){
    const result=spawnSync(process.execPath,['--import',new URL('./fixtures/mock-marketplaces.mjs',import.meta.url).href,fileURLToPath(new URL(`../fetch-${stage}.mjs`,import.meta.url))],{env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
  const products=finalizeProducts(JSON.parse(await readFile(productsPath)));
  assert.equal(products.length,100);assert.equal(validatePublication(products),true);
  const metrics=JSON.parse(await readFile(metricPath));assert.equal(metrics.rakuten,100);assert.equal(metrics.yahoo,100);assert.equal(metrics.attempted,100);
  assert.equal(products[0].collection_summary.yahoo.matched_products,100);
});
